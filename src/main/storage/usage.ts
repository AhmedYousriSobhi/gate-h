import { getCluster } from '../clusters'
import { runOnCluster } from '../scheduler/exec'
import { reuseRecent } from '../scheduler/reuse'
import { STORAGE_PATH_PATTERN, type StorageQuota, type StorageUsage } from '../../shared/types'

// Storage usage for a cluster's configured paths, on request only, over the session the user
// already has open (see ../scheduler/exec.ts). Per path: `df` for the filesystem as a whole, and
// the user's own quota where the filesystem has one Gate-H knows how to read - Lustre (`lfs
// quota`) or GPFS/Spectrum Scale (`mmlsquota -Y`, machine-readable). Anything else gets df only.

const PATH_MARKER = '@@gateh-path@@'
const DF_MARKER = '@@gateh-df@@'
const QUOTA_MARKER = '@@gateh-quota@@'

/** Validated paths go inside double quotes so `$USER`/`$HOME` expand; a leading `~` (which
 *  doesn't expand in quotes) becomes `$HOME`. */
function shellPath(path: string): string {
  if (!STORAGE_PATH_PATTERN.test(path.replace(/\$(USER|HOME)/g, ''))) {
    throw new Error(`Invalid storage path: ${path}`)
  }
  return `"${path.replace(/^~(?=\/|$)/, '$HOME')}"`
}

export function usageCommand(paths: string[]): string {
  return paths
    .map((path) => {
      const p = shellPath(path)
      return [
        `t=$(stat -f -c %T ${p} 2>/dev/null || echo missing)`,
        `echo "${PATH_MARKER}|$t|${path}"`,
        `echo '${DF_MARKER}'`,
        `LC_ALL=C df -Pk ${p} 2>/dev/null | tail -n +2`,
        `echo '${QUOTA_MARKER}'`,
        `case $t in lustre) lfs quota -q -u "$(id -un)" ${p} 2>&1;; ` +
          `gpfs) mmlsquota -u "$(id -un)" -Y --block-size 1K 2>&1;; esac`
      ].join('; ')
    })
    .join('; ')
}

function num(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number(value.replace(/\*$/, ''))
  return Number.isFinite(n) ? n : null
}

/** 0 means "no limit" for both lfs and mmlsquota. */
function limit(value: string | undefined): number | null {
  const n = num(value)
  return n ? n : null
}

/** `lfs quota -q`: filesystem, then used/quota/limit/grace for blocks (KiB) and for files. A long
 *  filesystem name can wrap onto its own line, so this reads whitespace tokens, not lines. A used
 *  value over quota carries a trailing `*`. */
export function parseLfsQuota(text: string): StorageQuota | null {
  const tokens = text.trim().split(/\s+/)
  if (tokens.length < 8) return null
  const [, used, soft, hard, , files, , filesHard] = tokens
  const usedKiB = num(used)
  if (usedKiB === null) return null
  return {
    source: 'lfs',
    usedKiB,
    softKiB: limit(soft),
    hardKiB: limit(hard),
    files: num(files),
    filesHard: limit(filesHard)
  }
}

/** `mmlsquota -Y`: colon-separated, with a HEADER row naming the fields - read by name rather than
 *  position, since the field list varies between releases. The user's own (USR) rows only, one
 *  per filesystem/fileset; they're summed, as quotas on one path's filesystem. */
export function parseMmlsquota(text: string): StorageQuota | null {
  const rows = text.split('\n').filter((line) => line.startsWith('mmlsquota:'))
  const header = rows.find((row) => row.split(':')[2] === 'HEADER')?.split(':')
  if (!header) return null
  const at = (row: string[], name: string): string | undefined => row[header.indexOf(name)]
  const quotas = rows
    .filter((row) => row.split(':')[2] !== 'HEADER')
    .map((row) => row.split(':'))
    .filter((row) => at(row, 'quotaType') === 'USR')
  if (quotas.length === 0) return null
  const first = quotas[0]
  return {
    source: 'mmlsquota',
    usedKiB: quotas.reduce((sum, row) => sum + (num(at(row, 'blockUsage')) ?? 0), 0),
    softKiB: limit(at(first, 'blockQuota')),
    hardKiB: limit(at(first, 'blockLimit')),
    files: quotas.reduce((sum, row) => sum + (num(at(row, 'filesUsage')) ?? 0), 0),
    filesHard: limit(at(first, 'filesLimit'))
  }
}

export function parseUsage(stdout: string): StorageUsage[] {
  return stdout
    .split(`${PATH_MARKER}|`)
    .slice(1)
    .map((block) => {
      const [head, rest = ''] = block.split(`\n${DF_MARKER}\n`)
      const [fsType, ...pathParts] = head.split('|')
      const path = pathParts.join('|').trim()
      const [dfText = '', quotaText = ''] = rest.split(`${QUOTA_MARKER}\n`)
      if (fsType === 'missing') return { path, fsType, error: 'Path not found.' }
      // df -P: Filesystem 1024-blocks Used Available Capacity Mounted-on.
      const df = dfText.trim().split(/\s+/)
      const usage: StorageUsage = { path, fsType }
      if (df.length >= 6) {
        const size = num(df[1])
        const used = num(df[2])
        if (size !== null && used !== null) usage.filesystem = { sizeKiB: size, usedKiB: used }
      }
      const quota =
        fsType === 'lustre'
          ? parseLfsQuota(quotaText)
          : fsType === 'gpfs'
            ? parseMmlsquota(quotaText)
            : null
      if (quota) usage.quota = quota
      else if ((fsType === 'lustre' || fsType === 'gpfs') && quotaText.trim()) {
        usage.error = quotaText.trim().split('\n').pop()
      }
      return usage
    })
}

/** `extraPaths` are the ones the user typed into the Status panel; they add to the configured ones
 *  and are validated by usageCommand the same way. */
export function fetchStorageUsage(
  clusterId: string,
  extraPaths: string[] = []
): Promise<StorageUsage[]> {
  const requested = [...new Set(extraPaths)].sort().join(',')
  return reuseRecent(`${clusterId}:storage:${requested}`, async () => {
    const cluster = getCluster(clusterId)
    if (!cluster) throw new Error('Cluster not found.')
    const paths = [...new Set([...(cluster.storage?.paths ?? []), ...extraPaths])]
    if (paths.length === 0) throw new Error('No storage paths to check.')
    if (!cluster.activeMonitoring) throw new Error('This cluster is in standby.')
    const result = await runOnCluster(cluster, usageCommand(paths))
    return parseUsage(result.stdout)
  })
}

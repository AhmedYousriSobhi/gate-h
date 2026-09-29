// Checks for src/main/storage/usage.ts, run by test-pty-manager.mjs with the cluster store stubbed
// and the command run in a local bash (see the runner's stub-storage-deps plugin) - so the
// generated shell is really executed against this machine's filesystems - plus the lfs quota and
// mmlsquota parsers against recorded output.

import { homedir } from 'os'
import {
  fetchStorageUsage,
  parseLfsQuota,
  parseMmlsquota,
  parseUsage,
  usageCommand
} from '../src/main/storage/usage'

interface Globals {
  __clusters: Record<string, unknown>
  __commands: string[]
}
const g = globalThis as unknown as Globals
g.__commands = []

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

async function main(): Promise<void> {
  console.log('-- command')
  report(
    throws(() => usageCommand(['/scratch/$(rm -rf ~)'])),
    'rejects a path that could run a command'
  )
  report(
    throws(() => usageCommand(['/data"; id; "'])),
    'rejects a path that could end the quoting'
  )
  report(usageCommand(['~/x']).includes('"$HOME/x"'), 'a leading ~ becomes $HOME inside the quotes')
  report(
    usageCommand(['/scratch/$USER']).includes('"/scratch/$USER"'),
    '$USER is kept for the remote shell to expand'
  )

  console.log('-- run locally')
  g.__clusters = {
    c: { id: 'c', activeMonitoring: true, storage: { paths: ['~', '/definitely/missing'] } }
  }
  const usage = await fetchStorageUsage('c')
  const home = usage.find((u) => u.path === '~')
  report(usage.length === 2, 'one entry per configured path', JSON.stringify(usage))
  report(
    Boolean(
      home?.fsType && home.fsType !== 'missing' && home.filesystem && home.filesystem.sizeKiB > 0
    ),
    `df reads ${homedir()}'s filesystem`,
    JSON.stringify(home)
  )
  report(
    usage[1]?.error === 'Path not found.',
    'a missing path is reported, not an error for the rest'
  )
  await fetchStorageUsage('c')
  report(g.__commands.length === 1, 'checking again within 30s reuses the result')

  console.log('-- parsers')
  const lfs = parseLfsQuota(
    '  /lustre/scratch\n                 5242880*  4194304 6291456  6d23h   120000  0  1000000       -\n'
  )
  report(
    lfs?.usedKiB === 5242880 && lfs.softKiB === 4194304 && lfs.hardKiB === 6291456,
    'lfs quota: a wrapped line and an over-quota * still parse',
    JSON.stringify(lfs)
  )
  report(lfs?.files === 120000 && lfs.filesHard === 1000000, 'lfs quota: file counts')
  report(parseLfsQuota('/home 100 0 0 - 5 0 0 -')?.hardKiB === null, 'lfs quota: 0 means no limit')
  const mm = parseMmlsquota(
    [
      'mmlsquota::HEADER:version:reserved:reserved:filesystemName:quotaType:id:name:blockUsage:blockQuota:blockLimit:blockInDoubt:blockGrace:filesUsage:filesQuota:filesLimit:filesInDoubt:filesGrace:remarks:quota:defQuota:fid:filesetname:',
      'mmlsquota::0:1:::gpfs01:USR:1234:me:2097152:10485760:12582912:0:none:4000:0:500000:0:none:e:on:off:::',
      'mmlsquota::0:1:::gpfs01:GRP:500:lab:9999999:0:0:0:none:1:0:0:0:none:e:on:off:::'
    ].join('\n')
  )
  report(
    mm?.usedKiB === 2097152 &&
      mm.softKiB === 10485760 &&
      mm.hardKiB === 12582912 &&
      mm.filesHard === 500000,
    'mmlsquota -Y: read by header name, user rows only',
    JSON.stringify(mm)
  )
  report(parseMmlsquota('mmlsquota: command not found') === null, 'mmlsquota: no header, no quota')
  const lustre = parseUsage(
    '@@gateh-path@@|lustre|/scratch/$USER\n@@gateh-df@@\nfs 100 50 50 50% /scratch\n@@gateh-quota@@\nlfs: failed for /scratch: Permission denied\n'
  )
  report(
    lustre[0]?.error === 'lfs: failed for /scratch: Permission denied' &&
      lustre[0].filesystem?.usedKiB === 50,
    'a failed quota keeps df and shows why'
  )
}

main()
  .catch((err) => {
    console.error(err)
    failures++
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
    process.exit(failures ? 1 : 0)
  })

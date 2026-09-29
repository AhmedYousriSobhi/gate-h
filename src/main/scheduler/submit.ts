import { BrowserWindow, dialog, type WebContents } from 'electron'
import { getCluster } from '../clusters'
import { runOnCluster } from './exec'
import { classifyFailure } from './slurm'

// The only scheduler commands that change anything: submitting a batch script and cancelling a
// job. Both need the user to confirm in a native dialog shown from here, the main process, so
// no renderer bug can skip the confirmation - the renderer's own preview is for reading the
// script, not for agreeing to run it.

export const SUBMIT_COMMAND = 'LC_ALL=C sbatch --parsable'
const MAX_SCRIPT_BYTES = 256 * 1024

/** `scancel` scoped to the SSH user, so it can only ever cancel their own jobs. */
export function cancelCommand(jobId: string): string {
  if (!/^\d+(_\d+)?$/.test(jobId)) throw new Error(`Invalid job id: ${jobId}`)
  return `LC_ALL=C scancel --user="$(id -un)" ${jobId}`
}

/** `sbatch --parsable` prints `jobid` or `jobid;cluster`. */
export function parseSubmitted(stdout: string): string | null {
  const match = /^(\d+)(;\S+)?\s*$/m.exec(stdout.trim())
  return match ? match[1] : null
}

async function confirm(
  sender: WebContents,
  message: string,
  detail: string,
  action: string
): Promise<boolean> {
  const window = BrowserWindow.fromWebContents(sender)
  const options = {
    type: 'question' as const,
    buttons: [action, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail
  }
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

function clusterFor(clusterId: string): NonNullable<ReturnType<typeof getCluster>> {
  const cluster = getCluster(clusterId)
  if (!cluster?.scheduler) throw new Error('This cluster has no scheduler configured.')
  if (!cluster.activeMonitoring) throw new Error('This cluster is in standby.')
  return cluster
}

export async function submitScript(
  clusterId: string,
  script: string,
  label: string,
  sender: WebContents
): Promise<string | null> {
  const cluster = clusterFor(clusterId)
  if (!script.trim()) throw new Error('The script is empty.')
  if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) throw new Error('The script is over 256 KiB.')
  const lines = script.split('\n')
  const preview =
    lines.slice(0, 12).join('\n') + (lines.length > 12 ? `\n… ${lines.length - 12} more lines` : '')
  const ok = await confirm(
    sender,
    `Submit "${label}" to ${cluster.name}?`,
    `Runs ${SUBMIT_COMMAND} as ${cluster.connection.username}, with this script on standard input:\n\n${preview}`,
    'Submit'
  )
  if (!ok) return null
  const result = await runOnCluster(cluster, SUBMIT_COMMAND, script)
  if (result.exitCode !== 0)
    throw new Error(classifyFailure(result.exitCode, result.stderr).message)
  const jobId = parseSubmitted(result.stdout)
  if (!jobId)
    throw new Error(
      `sbatch didn't report a job id: ${result.stdout.trim() || result.stderr.trim()}`
    )
  return jobId
}

export async function cancelJob(
  clusterId: string,
  jobId: string,
  sender: WebContents
): Promise<boolean> {
  const cluster = clusterFor(clusterId)
  const command = cancelCommand(jobId)
  const ok = await confirm(
    sender,
    `Cancel job ${jobId} on ${cluster.name}?`,
    `Runs scancel for ${cluster.connection.username}'s job ${jobId}. It can't be undone.`,
    'Cancel job'
  )
  if (!ok) return false
  const result = await runOnCluster(cluster, command)
  if (result.exitCode !== 0)
    throw new Error(classifyFailure(result.exitCode, result.stderr).message)
  return true
}

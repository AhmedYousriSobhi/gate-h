// Checks for src/shared/templates.ts and src/main/scheduler/submit.ts, run by test-pty-manager.mjs
// with electron's dialog, the cluster store and the command runner stubbed (see the runner's
// stub-submit-deps plugin): placeholders, and that sbatch/scancel run only after the native
// confirmation, with the reviewed script on stdin and scancel scoped to the user.

import { renderTemplate, templatePlaceholders } from '../src/shared/templates'
import {
  cancelCommand,
  cancelJob,
  parseSubmitted,
  submitScript
} from '../src/main/scheduler/submit'

interface Globals {
  __clusters: Record<string, unknown>
  __dialogs: Array<{ message: string; detail?: string }>
  __answer: number
  __runs: Array<{ command: string; stdin?: string }>
  __result: { exitCode: number; stdout: string; stderr: string }
}
const g = globalThis as unknown as Globals
g.__dialogs = []
g.__runs = []
g.__clusters = {
  c: {
    id: 'c',
    name: 'hpc-lab',
    activeMonitoring: true,
    scheduler: {},
    connection: { username: 'me' }
  },
  plain: {
    id: 'plain',
    name: 'plain',
    activeMonitoring: true,
    scheduler: null,
    connection: { username: 'me' }
  }
}

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}
async function rejection(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (err) {
    return (err as Error).message
  }
}
const sender = {} as never

async function main(): Promise<void> {
  console.log('-- templates')
  const body = '#SBATCH -J {{name:job}}\n#SBATCH -N {{ nodes : 2 }}\nsrun {{command}} {{name}}\n'
  const placeholders = templatePlaceholders(body)
  report(
    JSON.stringify(placeholders) ===
      JSON.stringify([
        { name: 'name', defaultValue: 'job' },
        { name: 'nodes', defaultValue: '2' },
        { name: 'command', defaultValue: '' }
      ]),
    'each placeholder once, in order, with its default',
    JSON.stringify(placeholders)
  )
  report(
    renderTemplate(body, { command: 'python a.py', nodes: '' }) ===
      '#SBATCH -J job\n#SBATCH -N 2\nsrun python a.py job\n',
    'fills values, falling back to defaults for empty ones'
  )

  console.log('-- sbatch')
  report(
    parseSubmitted('4242\n') === '4242' && parseSubmitted('4243;cluster2') === '4243',
    'reads the id from --parsable output'
  )
  report(parseSubmitted('sbatch: error: x') === null, 'no id, no guess')
  g.__answer = 1
  g.__result = { exitCode: 0, stdout: '4242\n', stderr: '' }
  const declined = await submitScript('c', '#!/bin/bash\nsrun hostname\n', 'probe', sender)
  report(
    declined === null && g.__runs.length === 0,
    'declining the native confirmation runs nothing'
  )
  report(
    /Submit "probe" to hpc-lab/.test(g.__dialogs[0]?.message ?? '') &&
      /srun hostname/.test(g.__dialogs[0]?.detail ?? ''),
    'the confirmation names the cluster and shows the script'
  )
  g.__answer = 0
  const jobId = await submitScript('c', '#!/bin/bash\nsrun hostname\n', 'probe', sender)
  report(
    jobId === '4242' && g.__runs[0]?.command === 'LC_ALL=C sbatch --parsable',
    'confirmed: sbatch runs and the job id comes back'
  )
  report(
    g.__runs[0]?.stdin === '#!/bin/bash\nsrun hostname\n',
    'the reviewed script is exactly what goes on stdin'
  )
  report(
    /no scheduler/.test((await rejection(submitScript('plain', 'x', 'x', sender))) ?? ''),
    'needs Slurm configured on the cluster'
  )
  report(
    /empty/.test((await rejection(submitScript('c', '  \n', 'x', sender))) ?? ''),
    'refuses an empty script'
  )
  g.__result = {
    exitCode: 1,
    stdout: '',
    stderr: 'sbatch: error: Batch job submission failed: Invalid partition name specified'
  }
  report(
    /Invalid partition/.test((await rejection(submitScript('c', 'x', 'x', sender))) ?? ''),
    "sbatch's own error is shown"
  )

  console.log('-- scancel')
  report(
    cancelCommand('48213_7') === 'LC_ALL=C scancel --user="$(id -un)" 48213_7',
    "scoped to the user's own jobs"
  )
  report((await rejection(cancelJob('c', '1;id', sender))) !== null, 'job id is validated')
  const runs = g.__runs.length
  g.__answer = 1
  report(
    (await cancelJob('c', '48213', sender)) === false && g.__runs.length === runs,
    'declining runs nothing'
  )
  g.__answer = 0
  g.__result = { exitCode: 0, stdout: '', stderr: '' }
  report(
    (await cancelJob('c', '48213', sender)) === true &&
      g.__runs[g.__runs.length - 1].command.includes('scancel'),
    'confirmed: scancel runs'
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

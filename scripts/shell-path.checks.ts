// Checks for src/main/shellPath.ts, run by test-pty-manager.mjs: reading a login shell's PATH
// (with a real bash) and merging it into the app's own.

import { loginShellPath, mergePaths } from '../src/main/shellPath'

let failures = 0
function report(ok: boolean, desc: string, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${desc}${ok || !detail ? '' : `\n        ${detail}`}`)
  if (!ok) failures++
}

const fromBash = loginShellPath('/bin/bash')
report(
  Boolean(fromBash?.split(':').includes('/usr/bin')),
  "reads a login shell's PATH",
  String(fromBash)
)
report(loginShellPath('/definitely/not/a/shell') === null, 'a shell that fails to start gives null')
report(
  mergePaths(
    '/opt/homebrew/bin:/usr/bin',
    '/usr/bin:/bin:',
    null,
    '/usr/local/bin:/opt/homebrew/bin'
  ) === '/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin',
  'keeps the first occurrence of each directory, in order, and drops empty entries'
)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)

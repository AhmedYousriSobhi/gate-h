// Checks for src/main/shellPath.ts, run by test-pty-manager.mjs: reading a login shell's PATH
// (with a real bash) and merging it into the app's own.

import { loginShellPath, loginShellSslCertEnv, mergePaths } from '../src/main/shellPath'

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

process.env.SSL_CERT_FILE = '/tmp/gate-h-test-cert.pem'
const certsFromBash = loginShellSslCertEnv('/bin/bash')
report(
  certsFromBash.file === '/tmp/gate-h-test-cert.pem',
  'reads SSL_CERT_FILE from the login shell',
  String(certsFromBash.file)
)
report(certsFromBash.dir === null, 'an unset SSL_CERT_DIR reads as null, not an empty string')
delete process.env.SSL_CERT_FILE
report(
  loginShellSslCertEnv('/definitely/not/a/shell').file === null,
  'a shell that fails to start gives null for SSL_CERT_FILE too'
)
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

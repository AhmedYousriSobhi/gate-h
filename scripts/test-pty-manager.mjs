#!/usr/bin/env node
// Bundles and runs the headless main-process checks under Electron's own Node
// (ELECTRON_RUN_AS_NODE), so native modules (node-pty) load as the Electron-ABI builds the app
// ships, without a window:
//   - scripts/pty-manager.checks.ts: PtyManager and Teleport PTY sessions (see that file for the
//     optional Teleport lab run);
//   - scripts/teleport-sessions.checks.ts: the Teleport session monitor, against a fake `tsh`, a
//     scratch HOME, and stubbed cluster/notification stores.
//
//   node scripts/test-pty-manager.mjs

import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import electron from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'gate-h-checks-'))

// electron-vite resolves `?asset` imports to the file's path at build time; here the source
// tree's copy is the one to run.
const assetPath = {
  name: 'asset-path',
  setup(b) {
    b.onResolve({ filter: /\?asset/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?.*$/, '')),
      namespace: 'asset-path'
    }))
    b.onLoad({ filter: /.*/, namespace: 'asset-path' }, (args) => ({
      contents: `module.exports = ${JSON.stringify(args.path)}`,
      loader: 'js'
    }))
  }
}

// The session monitor reads clusters from SQLite and writes notifications to it; the checks
// supply both through globals instead.
const stubStores = {
  name: 'stub-stores',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/(clusters|notifications\/store)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub'
    }))
    b.onLoad({ filter: /clusters$/, namespace: 'stub' }, () => ({
      contents: 'module.exports = { listClusters: () => globalThis.__clusters }',
      loader: 'js'
    }))
    b.onLoad({ filter: /store$/, namespace: 'stub' }, () => ({
      contents: 'module.exports = { addNotification: (n) => globalThis.__notifications.push(n) }',
      loader: 'js'
    }))
  }
}

try {
  const home = join(work, 'home')
  const bin = join(work, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'tsh'),
    '#!/usr/bin/env bash\necho "$*" >> "$HOME/tsh-calls"\n' +
      '[[ -f "$HOME/status.json" ]] || { echo "Not logged in." >&2; exit 1; }\ncat "$HOME/status.json"\n'
  )
  chmodSync(join(bin, 'tsh'), 0o755)

  const jobs = [
    { entry: 'pty-manager.checks.ts', plugins: [assetPath], env: {} },
    {
      entry: 'teleport-sessions.checks.ts',
      plugins: [assetPath, stubStores],
      env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }
    }
  ]
  let failed = false
  for (const job of jobs) {
    const outfile = join(work, `${job.entry.replace(/\W/g, '_')}.cjs`)
    await build({
      entryPoints: [join(root, 'scripts', job.entry)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['node-pty', 'electron'],
      nodePaths: [join(root, 'node_modules')],
      logLevel: 'warning',
      plugins: job.plugins
    })
    const { status } = spawnSync(electron, [outfile], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: join(root, 'node_modules'),
        ...job.env
      }
    })
    if (status !== 0) failed = true
    console.log()
  }
  process.exitCode = failed ? 1 : 0
} finally {
  rmSync(work, { recursive: true, force: true })
}

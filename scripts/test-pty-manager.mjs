#!/usr/bin/env node
// Bundles and runs the headless main-process checks under Electron's own Node
// (ELECTRON_RUN_AS_NODE), so native modules (node-pty) load as the Electron-ABI builds the app
// ships, without a window:
//   - scripts/pty-manager.checks.ts: PtyManager and Teleport PTY sessions (see that file for the
//     optional Teleport lab run);
//   - scripts/teleport-sessions.checks.ts: the Teleport session monitor, against a fake `tsh`, a
//     scratch HOME, and stubbed cluster/notification stores.
//   - scripts/slurm.checks.ts: the Slurm command builders and output parsers;
//   - scripts/scheduler-monitor.checks.ts: when the scheduler monitor polls, against a fake
//     command runner and a stubbed cluster store;
//   - scripts/scheduler-exec.checks.ts: the scheduler command runner's limits and queueing,
//     against a fake ssh2 client and a local `bash` standing in for `tsh ssh`;
//   - scripts/storage.checks.ts: the storage usage command, run in a local bash, and the
//     lfs/mmlsquota parsers;
//   - scripts/gpu.checks.ts: hostlist expansion, the nvidia-smi sampler, and the Grafana DCGM
//     query and its response parsing;
//   - scripts/sftp.checks.ts: file listing and transfers over a fake ssh2 SFTP channel;
//   - scripts/submit.checks.ts: template placeholders, and sbatch/scancel only after the native
//     confirmation, with a stubbed dialog, cluster store and command runner;
//   - scripts/shell-path.checks.ts: adopting the login shell's PATH (for macOS GUI launches).
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

// The scheduler monitor reads clusters, runs commands through ./exec (which needs a live SSH
// session) and raises notifications; the checks supply all three through globals instead.
const stubScheduler = {
  name: 'stub-scheduler',
  setup(b) {
    b.onResolve({ filter: /^(\.\.\/clusters|\.\/exec|\.\.\/notifications\/store)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-scheduler'
    }))
    b.onLoad({ filter: /clusters$/, namespace: 'stub-scheduler' }, () => ({
      contents:
        'module.exports = { getCluster: (id) => globalThis.__clusters[id] ?? null, ' +
        'listClusters: () => Object.values(globalThis.__clusters) }',
      loader: 'js'
    }))
    b.onLoad({ filter: /exec$/, namespace: 'stub-scheduler' }, () => ({
      contents:
        'class NoSessionError extends Error {}\n' +
        'module.exports = { NoSessionError, ' +
        'hasLiveConnection: (id) => globalThis.__live.has(id), ' +
        'runOnCluster: (c, cmd) => globalThis.__run(c, cmd, NoSessionError) }',
      loader: 'js'
    }))
    b.onLoad({ filter: /store$/, namespace: 'stub-scheduler' }, () => ({
      contents: 'module.exports = { addNotification: (n) => globalThis.__notifications.push(n) }',
      loader: 'js'
    }))
  }
}

// The command runner looks up live sessions and Teleport state; the checks supply both, and
// run "Teleport" commands with a local bash instead of teleport.sh.
const stubExecDeps = {
  name: 'stub-exec-deps',
  setup(b) {
    b.onResolve(
      { filter: /^\.\.\/(ssh\/manager|teleport\/sessionState|teleport\/session)$/ },
      (args) => ({
        path: args.path,
        namespace: 'stub-exec'
      })
    )
    b.onLoad({ filter: /manager$/, namespace: 'stub-exec' }, () => ({
      contents: 'module.exports = { getLiveClient: (id) => globalThis.__clients[id] ?? null }',
      loader: 'js'
    }))
    b.onLoad({ filter: /sessionState$/, namespace: 'stub-exec' }, () => ({
      contents: 'module.exports = { getTeleportSessions: () => globalThis.__teleport }',
      loader: 'js'
    }))
    b.onLoad({ filter: /session$/, namespace: 'stub-exec' }, () => ({
      contents:
        'module.exports = { EXIT_NO_SESSION: 4, ' +
        "teleportExecCommand: (_c, command) => ({ file: 'bash', args: ['-c', command] }) }",
      loader: 'js'
    }))
  }
}

// Storage usage reads the cluster store and runs its command through the scheduler runner; the
// checks supply clusters through a global and run the command in a local bash.
const stubStorageDeps = {
  name: 'stub-storage-deps',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/(clusters|scheduler\/exec)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-storage'
    }))
    b.onLoad({ filter: /clusters$/, namespace: 'stub-storage' }, () => ({
      contents: 'module.exports = { getCluster: (id) => globalThis.__clusters[id] ?? null }',
      loader: 'js'
    }))
    b.onLoad({ filter: /exec$/, namespace: 'stub-storage' }, () => ({
      contents:
        "const { execFileSync } = require('child_process')\n" +
        'module.exports = { runOnCluster: async (_c, command) => { globalThis.__commands.push(command); ' +
        "return { exitCode: 0, stdout: execFileSync('bash', ['-c', command], { encoding: 'utf8' }), stderr: '' } } }",
      loader: 'js'
    }))
  }
}

// The SFTP module looks up clusters and their live connection; the checks supply both.
const stubSftpDeps = {
  name: 'stub-sftp-deps',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/(clusters|ssh\/manager)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-sftp'
    }))
    b.onLoad({ filter: /clusters$/, namespace: 'stub-sftp' }, () => ({
      contents: 'module.exports = { getCluster: (id) => globalThis.__clusters[id] ?? null }',
      loader: 'js'
    }))
    b.onLoad({ filter: /manager$/, namespace: 'stub-sftp' }, () => ({
      contents: 'module.exports = { getLiveClient: (id) => globalThis.__clients[id] ?? null }',
      loader: 'js'
    }))
  }
}

// Submitting asks for confirmation in a native dialog and runs sbatch/scancel through the
// scheduler runner; the checks stub electron's dialog, the cluster store and the runner.
const stubSubmitDeps = {
  name: 'stub-submit-deps',
  setup(b) {
    b.onResolve({ filter: /^(electron|\.\.\/clusters|\.\/exec)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-submit'
    }))
    b.onLoad({ filter: /electron$/, namespace: 'stub-submit' }, () => ({
      contents:
        'module.exports = { BrowserWindow: { fromWebContents: () => null }, dialog: { ' +
        'showMessageBox: async (o) => { globalThis.__dialogs.push(o); return { response: globalThis.__answer } } } }',
      loader: 'js'
    }))
    b.onLoad({ filter: /clusters$/, namespace: 'stub-submit' }, () => ({
      contents: 'module.exports = { getCluster: (id) => globalThis.__clusters[id] ?? null }',
      loader: 'js'
    }))
    b.onLoad({ filter: /exec$/, namespace: 'stub-submit' }, () => ({
      contents:
        'module.exports = { runOnCluster: async (c, command, stdin) => { ' +
        'globalThis.__runs.push({ command, stdin }); return globalThis.__result } }',
      loader: 'js'
    }))
  }
}

try {
  const home = join(work, 'home')
  const bin = join(work, 'bin')
  mkdirSync(home, { recursive: true })
  // Separate from the session monitor's HOME, whose checks count the fake tsh's calls there.
  const ptyHome = join(work, 'home-pty')
  mkdirSync(ptyHome, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'tsh'),
    '#!/usr/bin/env bash\necho "$*" >> "$HOME/tsh-calls"\n' +
      '[[ -f "$HOME/status.json" ]] || { echo "Not logged in." >&2; exit 1; }\ncat "$HOME/status.json"\n'
  )
  chmodSync(join(bin, 'tsh'), 0o755)

  const jobs = [
    // The fake tsh too (it reports no session), unless it's the optional run against a real
    // Teleport lab, which needs the real one - otherwise the result depends on whether this
    // machine happens to have tsh installed and logged in.
    {
      entry: 'pty-manager.checks.ts',
      plugins: [assetPath],
      env: process.env.TELEPORT_LAB_PROXY
        ? {}
        : { HOME: ptyHome, PATH: `${bin}:${process.env.PATH}` }
    },
    {
      entry: 'teleport-sessions.checks.ts',
      plugins: [assetPath, stubStores],
      env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }
    },
    { entry: 'slurm.checks.ts', plugins: [], env: {} },
    { entry: 'scheduler-monitor.checks.ts', plugins: [stubScheduler], env: {} },
    { entry: 'scheduler-exec.checks.ts', plugins: [stubExecDeps], env: {} },
    { entry: 'storage.checks.ts', plugins: [stubStorageDeps], env: {} },
    { entry: 'gpu.checks.ts', plugins: [], env: {} },
    { entry: 'sftp.checks.ts', plugins: [stubSftpDeps], env: {} },
    { entry: 'submit.checks.ts', plugins: [stubSubmitDeps], env: {} },
    { entry: 'shell-path.checks.ts', plugins: [], env: {} }
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

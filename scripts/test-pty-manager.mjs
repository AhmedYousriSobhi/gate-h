#!/usr/bin/env node
// Bundles scripts/pty-manager.checks.ts and runs it under Electron's own Node
// (ELECTRON_RUN_AS_NODE), so node-pty loads as the Electron-ABI build the app ships, without a
// window. See the checks file for the optional Teleport lab run.
//
//   node scripts/test-pty-manager.mjs

import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import electron from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'gate-h-pty-'))
const outfile = join(outDir, 'checks.cjs')

try {
  await build({
    entryPoints: [join(root, 'scripts/pty-manager.checks.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['node-pty'],
    nodePaths: [join(root, 'node_modules')],
    logLevel: 'warning',
    plugins: [
      {
        // electron-vite resolves `?asset` imports to the file's path at build time; here the
        // source tree's copy is the one to run.
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
    ]
  })
  const result = spawnSync(electron, [outfile], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: join(root, 'node_modules') }
  })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

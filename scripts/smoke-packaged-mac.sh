#!/usr/bin/env bash
# Starts the packaged macOS app's own Electron as Node and loads its native modules from inside
# its asar, the way the app does - catching a module built for the wrong architecture or Electron
# ABI, a broken ad-hoc signature (the binary is killed on Apple Silicon), or node-pty's
# spawn-helper left inside the archive or without its executable bit.
#
#   ./scripts/smoke-packaged-mac.sh        (after npm run build:mac)

set -euo pipefail

app=$(find dist -maxdepth 2 -name 'Gate-H.app' -print -quit)
if [[ -z "$app" ]]; then
  echo "no Gate-H.app under dist/ - run npm run build:mac first" >&2
  exit 1
fi
echo "smoke-testing $app"
codesign --verify --deep --strict "$app"

ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/Gate-H" -e '
  const path = require("path")
  const asar = path.join(path.dirname(process.execPath), "../Resources/app.asar")
  const Database = require(path.join(asar, "node_modules/better-sqlite3"))
  const db = new Database(":memory:")
  if (db.prepare("select 1 as x").get().x !== 1) throw new Error("better-sqlite3 query failed")
  require(path.join(asar, "node_modules/ssh2"))
  const pty = require(path.join(asar, "node_modules/node-pty"))
  const term = pty.spawn("/bin/echo", ["gate-h-pty-ok"], {})
  let out = ""
  term.onData((data) => (out += data))
  term.onExit(({ exitCode }) => {
    if (exitCode !== 0 || !out.includes("gate-h-pty-ok")) {
      console.error("node-pty spawn failed:", exitCode, JSON.stringify(out))
      process.exit(1)
    }
    console.log("better-sqlite3, ssh2 and node-pty load and run in the packaged app")
    process.exit(0)
  })
  setTimeout(() => {
    console.error("node-pty spawn timed out")
    process.exit(1)
  }, 10000)
'

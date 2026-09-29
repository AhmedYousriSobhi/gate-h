#!/usr/bin/env bash
# Builds Gate-H: the Linux AppImage reproducibly inside Docker, or on macOS the dmg + zip natively.
#
# Usage:
#   ./build-desktop.sh
#   ./dist/Gate-H-*.AppImage        (Linux)
#   open dist/*.dmg                 (macOS)
#
# macOS can't use the container: a dmg and its code signature need macOS's own hdiutil and
# codesign, and Docker on a Mac only runs Linux. It builds on the host instead and needs Node.js 20+.
#
# The Docker image (docker/build.Dockerfile) is the build TOOLCHAIN only - a pinned Node version
# plus the native-module and Linux-packaging build deps. The actual repo is bind-mounted in at run
# time, so editing app source never requires rebuilding the image. node_modules and the npm/
# electron-builder download caches live in named Docker volumes (not on the host), so this never
# touches or conflicts with a node_modules you use for local `npm run dev`. The container runs as
# your own user (not root), so dist/ ends up owned by you like any other build output.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_TAG="gateh-builder:latest"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if ! command -v node >/dev/null 2>&1 || (( $(node -p 'process.versions.node.split(".")[0]') < 20 )); then
    echo "error: Node.js 20+ is required (brew install node)" >&2
    exit 1
  fi
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "error: Xcode Command Line Tools are required (xcode-select --install)" >&2
    exit 1
  fi
  cd "$ROOT_DIR"

  # The build downloads Node headers, Electron and native-module prebuilds. Behind a network that
  # re-signs HTTPS with its own certificate Node fails on the first one, minutes in, so check now.
  # Node ignores the macOS keychain unless told otherwise, so retry once with it before giving up.
  tls_ok() {
    node -e '
      const hosts = ["nodejs.org", "github.com", "registry.npmjs.org"]
      let pending = hosts.length
      for (const host of hosts) {
        const req = require("https").request({ host, method: "HEAD", path: "/", timeout: 10000 },
          () => --pending || process.exit(0))
        req.on("error", (e) => { console.error(host + ": " + e.message); process.exit(1) })
        req.on("timeout", () => { console.error(host + ": timed out"); process.exit(1) })
        req.end()
      }
    '
  }
  echo "==> Checking that Node can reach nodejs.org, github.com and npm over HTTPS"
  if ! tls_ok; then
    echo "    Failed. Retrying with the macOS keychain's certificates (NODE_USE_SYSTEM_CA=1)"
    if NODE_USE_SYSTEM_CA=1 tls_ok; then
      export NODE_USE_SYSTEM_CA=1
      echo "    That works, so this build uses it."
    else
      cat >&2 <<'MSG'

error: Node can't make HTTPS connections from this machine (see the host and reason above).
If the reason is a certificate error, your network re-signs HTTPS with its own certificate.
Export your organisation's CA file, then run this again:
  NODE_EXTRA_CA_CERTS=/path/to/ca.pem ./build-desktop.sh
To export the CAs the Mac trusts (works on any Node version), then use that file:
  security find-certificate -a -p /Library/Keychains/System.keychain \
    /System/Library/Keychains/SystemRootCertificates.keychain > ~/macos-ca.pem
  NODE_EXTRA_CA_CERTS=~/macos-ca.pem ./build-desktop.sh
Otherwise check your VPN/proxy, or that Node is 22.15+ / 24 for the keychain option.
MSG
      exit 1
    fi
  fi

  echo "==> Building Gate-H for macOS (npm ci && npm run typecheck && npm run build:mac)"
  # Not `a && b && c` on its own line: set -e ignores a failure that isn't the last in an && list.
  if ! { npm ci && npm run typecheck && npm run build:mac; }; then
    cat >&2 <<'MSG'

error: the build failed - see the log above.
If it says "unable to get local issuer certificate" (or another TLS error), your network re-signs
HTTPS traffic with its own certificate, which Node doesn't trust by default. Either let Node use
the macOS keychain:
  NODE_USE_SYSTEM_CA=1 ./build-desktop.sh        (Node 22.15+ / 24)
or point it at your organisation's CA file:
  NODE_EXTRA_CA_CERTS=/path/to/ca.pem ./build-desktop.sh
MSG
    exit 1
  fi
  echo
  echo "==> Done. Build artifacts:"
  ls -1 dist/*.dmg dist/*.zip 2>/dev/null || echo "(no dmg/zip found under dist/ - check the build log above)"
  echo "First launch: System Settings > Privacy & Security > Open Anyway (the app isn't notarized)."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required but was not found on PATH" >&2
  exit 1
fi

echo "==> Building the build-toolchain image ($IMAGE_TAG)"
docker build -t "$IMAGE_TAG" -f "$ROOT_DIR/docker/build.Dockerfile" "$ROOT_DIR"

echo "==> Building Gate-H inside Docker (npm ci && npm run typecheck && npm run build:linux)"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$ROOT_DIR:/workspace" \
  -v gateh_build_node_modules:/workspace/node_modules \
  -v gateh_build_home:/home/build \
  -w /workspace \
  "$IMAGE_TAG" \
  bash -c "npm ci && npm run typecheck && npm run build:linux"

echo
echo "==> Done. Build artifact:"
ls -1 "$ROOT_DIR"/dist/*.AppImage 2>/dev/null || echo "(no AppImage found under dist/ - check the build log above)"

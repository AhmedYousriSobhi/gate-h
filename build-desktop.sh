#!/usr/bin/env bash
# Builds the Gate-H Linux AppImage reproducibly, inside Docker, instead of relying on whatever
# Node/toolchain happens to be installed locally.
#
# Usage:
#   ./build-desktop.sh
#   ./dist/Gate-H-*.AppImage
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

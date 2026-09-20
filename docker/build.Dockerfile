# Reproducible build environment for packaging H-Gate as a Linux AppImage.
#
# This image intentionally contains no app source - it's the toolchain only (pinned Node version,
# native-module build deps, Linux packaging deps). build-desktop.sh mounts the real repo into it
# at run time and runs the container as the host user, so build output ends up host-owned instead
# of root-owned. Rebuild this image only when the toolchain requirements below change; the app
# source can change freely without needing a rebuild.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    fakeroot \
    libfuse2 \
    && rm -rf /var/lib/apt/lists/*

# node_modules is a named Docker volume (not bind-mounted from the host, so it never touches or
# conflicts with a node_modules used for local `npm run dev`), and /home/build is where the
# container-run user's npm/electron-builder caches live. Both start out root-owned when Docker
# first creates them, so pre-create and open them up here - a fresh named volume inherits an
# image directory's permissions the first time it's mounted, which is what makes this work when
# the container later runs as an arbitrary (non-root, host-matching) UID.
RUN mkdir -p /workspace/node_modules /home/build \
    && chmod -R 777 /workspace/node_modules /home/build

ENV HOME=/home/build
WORKDIR /workspace

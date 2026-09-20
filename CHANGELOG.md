# Changelog

All notable changes to H-Gate are documented in this file, in the order they happened.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### 2026-09-20 — Project kickoff

- Initialized local git repository (`main` branch), configured local git identity
  (`ahmedyousrisobhi` / `ahmedyousrisobhi@gmail.com`).
- Defined the working process: every feature is built on its own `feature/*` branch and merged
  into `main` only once it builds/lints/verifies cleanly.
- Decided on tech stack: **Electron + React + TypeScript** (Vite bundler) for a standalone,
  Linux-first desktop app — chosen over Tauri/Rust and Python/PySide6 for fastest path to a
  working app with mature SSH, terminal, and REST-integration libraries.
- Decided on integration approach: **REST API with API tokens** for both Grafana and Jira,
  rather than embedding Grafana panels via iframe — keeps the app fully self-contained and not
  dependent on a browser runtime or Grafana's public-sharing settings.
- Added `README.md` (project overview, tech stack) and this changelog.
- Kicked off research into prior art (Open OnDemand, ColdFront, XDMoD, Bright Cluster Manager,
  Slurm web UIs, Ganglia, generic SSH managers) and technical building blocks (Node SSH clients,
  embedded terminal libraries, Electron secrets storage, Grafana/Jira REST APIs) — findings
  recorded in `docs/ANALYSIS.md`.

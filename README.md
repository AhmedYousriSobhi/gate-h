<p align="center">
  <img src="docs/assets/banner.svg" alt="Gate-H: one window for every HPC cluster" width="100%">
</p>

<p align="center">
  <a href="https://github.com/AhmedYousriSobhi/gate-h/releases"><img src="https://img.shields.io/github/v/release/AhmedYousriSobhi/gate-h?include_prereleases&color=2f6fed&label=release" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/Linux-AppImage-0a0f1c?logo=linux&logoColor=white" alt="Linux">
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-0a0f1c?logo=apple&logoColor=white" alt="macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7db2ff" alt="MIT"></a>
</p>

<h3 align="center">Your HPC clusters, in one window.<br/>Terminal, Slurm, GPUs, files and tickets, side by side.</h3>

<p align="center">
  <img src="docs/assets/screenshots/slurm-status.png" alt="Gate-H showing Slurm jobs with an expanded job array, live GPU usage and node health" width="820"><br/>
  <sub>Sample data. Jobs, live GPU load and drained nodes, one glance, no <code>squeue</code> typed.</sub>
</p>

## The 15-second version

|  | Before | With Gate-H |
|---|---|---|
| **Terminals** | one per login node, lost when the VPN blips | every cluster in a sidebar, sessions reconnect on their own |
| **"Is it up?"** | ping, ssh, squint | a green or red light per cluster |
| **Jobs** | `squeue -u me` again and again | live queue, job history, cancel and `sbatch` from templates |
| **GPUs** | `nvidia-smi` inside a job | utilization, memory and temperature per GPU |
| **Dashboards** | a Grafana tab for each cluster | the panels you chose, next to the terminal |
| **Bad news** | you find out at 5 pm | one bell: job finished, node down, session dropped |
| **Getting in** | ssh, jump hosts, `az`, `tsh login` | set it up once per cluster; Azure and Teleport log-ins happen in the terminal |

Files move over the connection you already have. Jira tickets are filed from the cluster's own view.

## Try it

**Linux** (needs [Docker](https://docs.docker.com/engine/install/)):

```bash
git clone git@github.com:AhmedYousriSobhi/gate-h.git && cd gate-h
./build-desktop.sh && ./dist/Gate-H-*.AppImage
```

**macOS** (Apple Silicon or Intel; needs Node 22 and `xcode-select --install`):

```bash
git clone git@github.com:AhmedYousriSobhi/gate-h.git && cd gate-h
./build-desktop.sh && open dist/*.dmg
```

Or skip the build and take the `.dmg` from [Releases](https://github.com/AhmedYousriSobhi/gate-h/releases)
(`arm64` is Apple Silicon, `x64` is Intel). The app isn't notarized yet, so the first launch needs
**System Settings → Privacy & Security → Open Anyway**.

Then click **+ Add**, enter the login node, and click the cluster. Full walkthrough for direct,
jump-host, Azure and Teleport access: [docs/GUIDE.md](docs/GUIDE.md).

## Why you can trust it near a real cluster

- **Polite.** Slurm, GPU and file features reuse your open session instead of opening new ones, and
  only poll while you're looking. Reconnects are limited and spaced out, so a down cluster isn't flooded.
- **Private.** No server, no account, no telemetry. Passwords and tokens are encrypted by your
  OS keychain and never handed back to the UI.
- **Careful.** Host keys are remembered and a change raises a warning. Submitting and cancelling
  jobs both ask first.

## More

[Guide](docs/GUIDE.md) (setup, everyday use, troubleshooting) · [Slurm and GPU design](docs/HPC_ORCHESTRATION.md) ·
[Status and known limits](docs/STATUS.md) · [Changelog](CHANGELOG.md) · [Contributing](CLAUDE.md) · [MIT](LICENSE)

<sub>Built with Electron, React and TypeScript. Screenshots use sample data; the HPC features haven't
yet been tried against real Slurm, Lustre, GPFS or DCGM installations, so feedback from real
clusters is welcome.</sub>

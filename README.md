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
  A desktop app, not a website or a service you host. Point it at a login node you can already
  <code>ssh</code> into — and, if your site has them, its Grafana and Jira — and Gate-H remembers
  the connection, watches whether it's up, and gives you a terminal and a live status view side by
  side instead of a pile of terminal windows and browser tabs. It doesn't provision, schedule, or
  administer anything; it only connects to clusters that already exist.
</p>

<p align="center">
  <img src="docs/assets/screenshots/overview-dashboard.png" alt="Gate-H's overview dashboard: a sidebar of clusters with live reachability, and a card per cluster showing status and quick actions" width="820"><br/>
  <sub>Sample data. Every cluster you've added, one glance: up or down, who's configured, what needs attention.</sub>
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

<p align="center">
  <img src="docs/assets/screenshots/split-view.png" alt="Gate-H's split view: a connected terminal on the left, that same cluster's Grafana status on the right" width="820"><br/>
  <sub>Sample data. Terminal and status side by side, resizable, swappable — not a tab you have to click between.</sub>
</p>

**What you need:** an account with SSH access to a cluster's login node — that's the only hard
requirement. Grafana, Jira, an Azure tunnel, and Teleport are each optional, configured per cluster
only if your site actually has them.

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

### Connect your cluster

Click **+ Add**, give it a name, then pick how you reach it:

<details>
<summary><b>🔑 Directly</b> — <code>ssh user@host</code></summary>
<br/>

Host/port of the login node, your username, and how you sign in: key, password, or agent.

→ Full field list: [docs/GUIDE.md](docs/GUIDE.md#-quick-start)
</details>

<details>
<summary><b>🪜 Through a jump host</b> — <code>ssh -J jump user@host</code></summary>
<br/>

Same as **Directly**, then tick **Connect through a jump/bastion host** and add its address,
port, username and auth method.

→ Full field list: [docs/GUIDE.md](docs/GUIDE.md#-quick-start)
</details>

<details>
<summary><b>☁️ Through Azure</b> — Bastion or <code>az ssh vm</code></summary>
<br/>

Needs the Azure CLI (`az`). Tick **Azure tunnel**, pick Bastion or `az ssh vm`, and fill in the
subscription, resource group and target. Gate-H signs you in and opens the tunnel itself.

→ Setup, keeping a tunnel alive, troubleshooting a drop: [docs/AZURE.md](docs/AZURE.md)
</details>

<details>
<summary><b>🛡️ Behind Teleport</b> — <code>tsh login</code> then <code>tsh ssh</code></summary>
<br/>

Needs the Teleport client (`tsh`). Tick **Behind Teleport** and fill in the proxy address, node
name and your login. Log in right in the terminal, the first time it's needed.

→ Setup, session handling, troubleshooting: [docs/TELEPORT.md](docs/TELEPORT.md)
</details>

## Why you can trust it near a real cluster

- **Polite.** Slurm, GPU and file features reuse your open session instead of opening new ones, and
  only poll while you're looking. Reconnects are limited and spaced out, so a down cluster isn't flooded.
- **Private.** No server, no account, no telemetry. Passwords and tokens are encrypted by your
  OS keychain and never handed back to the UI.
- **Careful.** Host keys are remembered and a change raises a warning. Submitting and cancelling
  jobs both ask first.

## Where to go next

| You want to… | Read |
|---|---|
| set up any cluster, or look up a feature or shortcut | [docs/GUIDE.md](docs/GUIDE.md) |
| connect through Azure Bastion/`az ssh vm`, or fix a dropped tunnel | [docs/AZURE.md](docs/AZURE.md) |
| connect through a Teleport proxy, or fix a login/session problem | [docs/TELEPORT.md](docs/TELEPORT.md) |
| keep several clusters' Jira tickets apart in one project | [docs/JIRA_GUIDE.md](docs/JIRA_GUIDE.md) |
| see the Slurm/GPU/file-transfer design, shipped or planned | [docs/HPC_ORCHESTRATION.md](docs/HPC_ORCHESTRATION.md) |
| check what's shipped, how it was verified, and known limits | [docs/STATUS.md](docs/STATUS.md) |
| read the functional spec, or why it's built this way | [SPEC.md](SPEC.md) · [docs/ANALYSIS.md](docs/ANALYSIS.md) |
| see every change, in order | [CHANGELOG.md](CHANGELOG.md) |
| contribute a change | [CLAUDE.md](CLAUDE.md) |

<sub>Built with Electron, React and TypeScript. Screenshots use sample data; the HPC features haven't
yet been tried against real Slurm, Lustre, GPFS or DCGM installations, so feedback from real
clusters is welcome.</sub>

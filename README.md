<p align="center">
  <img src="docs/assets/banner.svg" alt="Gate-H: one window for every HPC cluster" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f6fed" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-7db2ff" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/platform-Linux-0a0f1c?logo=linux&logoColor=white" alt="Platform: Linux">
  <br/>
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron 39">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white" alt="SQLite via better-sqlite3">
</p>

<p align="center">
  <b>A desktop app for running several HPC clusters from one window: SSH, Grafana status, and Jira.</b><br/>
  No server to deploy, no browser tabs, no telemetry.
</p>

---

**Contents:** [Why Gate-H](#why-gate-h) · [Features](#features) · [Preview](#preview) ·
[Quick start](#quick-start) · [Connecting to your clusters](#connecting-to-your-clusters) ·
[Everyday use](#everyday-use) · [Troubleshooting](#troubleshooting) ·
[For developers](#for-developers) · [Documentation](#documentation)

## Why Gate-H

If you look after more than one HPC cluster, you know the routine: a terminal for each login
node, a Grafana tab for each cluster's dashboards, a Jira board somewhere else. Then the VPN
drops, and you have to work out which of those things are still alive.

Gate-H puts all of that in one desktop window. You register each cluster once, with its SSH
access, its Grafana dashboards and its Jira project. After that:

- every cluster sits in a sidebar, with a light showing whether it's reachable,
- clicking a cluster opens its terminal and its status side by side,
- one notification feed tells you when anything changes on any cluster.

It's a single-user app with no server to set up. It's also careful with shared infrastructure:
reconnects are limited and spaced out, so a cluster that's down never gets flooded with
connection attempts. Secrets are encrypted on disk.

## Features

- 🖥️ **All your clusters in one sidebar.** Each has its own SSH settings: password, key or
  agent, with an optional jump host.
- 🟢 **Live reachability.** A light per cluster, checked in the background and re-checked as soon
  as the window regains focus.
- ⌨️ **Built-in terminal.** Host keys are remembered on first use. Dead connections are
  detected, reconnects are limited and spaced out, and the terminal makes it obvious when a
  session isn't live.
- ☁️ **Azure clusters.** For clusters behind Azure Bastion or `az ssh vm`, Gate-H signs in with
  the Azure CLI and opens the tunnel for you.
- 🛡️ **Teleport clusters.** For clusters behind a Teleport proxy, Gate-H checks your `tsh`
  session and connects with `tsh ssh`. If you need to log in, you do it right in the terminal.
- 📊 **Grafana status.** Health checks plus live panels you choose, stacked or side by side.
- 🎫 **Jira, Cloud or Data Center.** List a cluster's issues and file new ones from its view.
- 🧩 **Widgets side by side.** Show, hide, swap, stack and resize the terminal and status views.
  Your layout is remembered.
- 🔔 **One notification feed.** Reachability changes, Jira activity and dropped sessions from
  every cluster. Click one to jump to it.
- 🗂️ **Profiles and an overview.** Group clusters into profiles such as "Work" and "Research".
  The home screen shows every cluster in the current profile.
- ⏸️ **Pin or pause a cluster.** Keep a session alive in the background, or put a cluster in
  standby so it makes no connections at all.

## Preview

<p align="center">
  <img src="docs/assets/screenshots/overview-dashboard.png" alt="Overview dashboard showing every cluster in the active profile" width="720"><br/>
  <sub>The default view: every cluster in the active profile, with reachability, tags,
  integrations, and unread notifications at a glance.</sub>
</p>

<p align="center">
  <img src="docs/assets/screenshots/split-view.png" alt="Terminal and Status shown side by side for a cluster" width="720"><br/>
  <sub>A cluster's Terminal and Status side by side, not tabs - toggle, swap, or stack them from
  the toolbar.</sub>
</p>

<table>
<tr>
<td width="50%" align="center">
  <img src="docs/assets/screenshots/widget-picker.png" alt="Widget picker listing available and planned widgets" width="360"><br/>
  <sub>Toggle widgets on/off; disabled entries preview what's planned next</sub>
</td>
<td width="50%" align="center">
  <img src="docs/assets/screenshots/notifications.png" alt="Notification bell dropdown" width="360"><br/>
  <sub>One bell for reachability, Jira, and session events across every cluster</sub>
</td>
</tr>
<tr>
<td width="50%" align="center">
  <img src="docs/assets/screenshots/add-cluster-form.png" alt="Add cluster form" width="360"><br/>
  <sub>Register a cluster: SSH, optional jump host, Grafana, Jira</sub>
</td>
<td width="50%" align="center">
  <img src="docs/assets/screenshots/profile-switcher.png" alt="Profile switcher dropdown" width="360"><br/>
  <sub>Switch profiles, or add/rename/delete one, from the sidebar</sub>
</td>
</tr>
</table>

### Procedures

<table>
<tr>
<td align="center">
  <b>Add a cluster</b><br/><br/>
  <img src="docs/assets/gifs/add-cluster.gif" alt="Adding a cluster" width="320">
</td>
<td align="center">
  <b>Connect over SSH</b><br/><br/>
  <img src="docs/assets/gifs/ssh-connect.gif" alt="Connecting over SSH" width="320">
</td>
<td align="center">
  <b>Status + file a Jira ticket</b><br/><br/>
  <img src="docs/assets/gifs/cluster-status.gif" alt="Viewing status and filing a Jira ticket" width="320">
</td>
</tr>
</table>

> These were captured by driving the real UI code in a headless browser against sample data (this
> environment can't open an actual Electron window) — see [docs/STATUS.md](docs/STATUS.md) for
> exactly how, and what's still unverified against real infrastructure.


## Quick start

### 1. Install

Gate-H runs on Linux. The simplest way to build it needs only
[Docker](https://docs.docker.com/engine/install/):

```bash
git clone git@github.com:AhmedYousriSobhi/gate-h.git
cd gate-h
./build-desktop.sh            # builds and packages Gate-H inside a container
./dist/Gate-H-*.AppImage      # run it
```

The build runs in a pinned toolchain image ([docker/build.Dockerfile](docker/build.Dockerfile)),
so you get the same result on any machine.

### 2. Add your first cluster

1. Click **+ Add** in the sidebar.
2. Enter a **name**, then the **host**, **username** and **auth method** under *SSH connection*.
   If your cluster needs a jump host, Azure or Teleport, see
   [Connecting to your clusters](#connecting-to-your-clusters).
3. Optionally fill in **Grafana** and **Jira**. You can add them later.
4. Click **Save cluster**. The cluster appears in the sidebar with its reachability light.

### 3. Open it

Click the cluster. Its **Terminal** and **Status** (Grafana and Jira) open side by side, and the
sidebar stays visible, so switching clusters is one click.

## Connecting to your clusters

How do you normally reach the cluster's login node?

| If you reach it… | Fill in | Section |
|---|---|---|
| directly with `ssh user@host` | *SSH connection* only | [Direct SSH](#direct-ssh) |
| through a jump/bastion host (`ssh -J`) | *SSH connection* + **Connect through a jump/bastion host** | [Through a jump host](#through-a-jump-host) |
| through Azure Bastion or `az ssh vm` | *SSH connection* + **Azure tunnel** | [Through Azure](#through-azure) |
| with `tsh login` / `tsh ssh` | *SSH connection* + **Behind Teleport** | [Behind Teleport](#behind-teleport) |

### Direct SSH

Fill in **Host**, **Port** (usually `22`), **Username** and one **Auth method**:

- **Private key:** the key's path, e.g. `~/.ssh/id_ed25519`, plus its passphrase if it has one.
- **Password:** your password.
- **SSH agent:** nothing else; Gate-H uses your running `ssh-agent`.

Passwords and passphrases are encrypted with your OS keychain and never shown again. The first
time you connect, Gate-H remembers the server's host key. If that key ever changes, it refuses to
connect and tells you why.

### Through a jump host

Fill in the login node as usual, then tick **Connect through a jump/bastion host** and enter the
jump host's address, port, username and auth method.

> A jump host can reuse the cluster's password or passphrase only when both use the same auth
> method.

### Through Azure

For login nodes that are only reachable through **Azure Bastion** or a VM you reach with
**`az ssh vm`**. Gate-H signs in with the Azure CLI, opens a tunnel, and connects SSH through it.

**You need**

- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) installed.
- One of:
  - **Azure Bastion** (Standard or Premium SKU) with *Native client support* enabled, plus
    Reader access to the Bastion host and the target VM.
  - **A VM you can reach with `az ssh vm`.** That needs the *Virtual Machine User Login* or
    *Administrator Login* role, or a local VM account. The VM then forwards you on to the login
    node.

**Steps**

1. Run `az login` once in a terminal. You can also skip this: Gate-H shows a sign-in code in the
   terminal when it needs one.
2. Under *SSH connection*, enter the **far end** of the tunnel, not `127.0.0.1`:
   - **Bastion:** the target VM's host name and SSH port.
   - **az ssh vm:** the login node's host name and port, as the VM sees it.

   Leave the jump host unticked.
3. Tick **Azure tunnel** and fill in:
   - **Tunnel through:** Azure Bastion or `az ssh vm`.
   - **Local port:** any free port, e.g. `2222`.
   - **Subscription:** click **Load from az** to pick one.
   - **Resource group**, and optionally **Tenant ID**.
   - **Bastion:** the **Bastion name** and the **Target VM resource ID**. **az ssh vm:** the
     **VM name**, and optionally the **Local VM user**.
4. Select the cluster. The terminal shows each step (*Checking Azure CLI session* → *Using
   subscription …* → *Tunnel active on port 2222*), then connects.

The tunnel stays open across reconnects and closes when you quit, edit the cluster, or put it in
standby. To keep your work across the drops Azure sometimes causes, run your shell in
`tmux new -A -s main` on the login node.

More in [docs/AZURE.md](docs/AZURE.md): why Azure sessions drop, using the tunnel script on its
own, and testing.

### Behind Teleport

For clusters you normally reach with `tsh login` and then `tsh ssh user@node`. Gate-H checks for a
valid Teleport session, logs you in if needed, right in the terminal, and then opens your shell
with `tsh ssh`.

**You need**

- The Teleport client (`tsh`) installed. Check with `tsh version`.
- From your admin: the **proxy address**, your **Teleport user**, the **node name** and your
  **login** on it, and a **leaf cluster** or **auth connector** name if your setup uses one.

**First time only.** If you sign in with a password, open the invite link from your admin, choose
a password, and scan the QR code with an authenticator app. With single sign-on there's nothing
to set up.

**Steps**

1. Click **+ Add** (or edit a cluster) and tick **Behind Teleport**. Fill in:
   - **Proxy address:** e.g. `teleport.example.com:443`.
   - **Teleport user:** if it isn't the same as your OS username.
   - **Leaf cluster**, **Auth connector:** only if your admin gave you one.
2. Under *SSH connection*, which now asks only for what Teleport needs, fill in:
   - **Teleport node name:** the node as `tsh ls` shows it, e.g. `slogin1`.
   - **Login:** the Linux account to use on it, e.g. your cluster username.
3. Click **Save cluster** and select the cluster. What you'll see:
   - **Already logged in:** the shell opens straight away.
   - **Not logged in, or the session has expired:** your browser opens for single sign-on, or the
     terminal asks for your password and then the 6-digit code. Then the shell opens.

The cluster's light follows the Teleport proxy. If the proxy can't be reached, Gate-H retries
twice and then pauses until the proxy is back.

**Tip:** if your proxy uses your organisation's own certificate authority, start Gate-H with
`SSL_CERT_FILE=/path/to/ca.pem`, the same as you would for `tsh`.

To do the same from a plain terminal, use the bundled script: `./resources/teleport.sh ssh --proxy
teleport.example.com:443 -- alice@slogin1`. More in [docs/TELEPORT.md](docs/TELEPORT.md).

## Everyday use

- **Overview.** The home screen shows a card for every cluster in the current profile: its
  reachability, tags, integrations and unread notifications.
- **Layout.** Use the toolbar above a cluster's widgets to swap them, stack them, or hide one. The
  puzzle-piece icon opens the widget picker, which also shows widgets that are coming later.
- **Notifications.** The bell collects events from every cluster. Click one to jump to the
  cluster and widget it's about.
- **Profiles.** Click the profile name at the top of the sidebar to switch, add, rename or delete
  profiles.
- **Pin a cluster.** Hover it in the sidebar and click the **pin** icon. Its session and Grafana
  stay live in the background while you work on other clusters.
- **Standby.** Click the **power** icon to stop all of a cluster's connections. Select it and
  click **Resume monitoring** to start again.

## Troubleshooting

| Problem | Try |
|---|---|
| The light stays red | Check your VPN, and that you can reach the host (or Teleport proxy) from this machine. |
| The terminal says *Paused* | Gate-H stopped retrying to spare the cluster. Click **Reconnect now**, or wait: it resumes by itself when the light turns green. |
| *Host key … changed* notification | The server's key changed since your last connection. Ask your cluster admin before trusting it. |
| Azure: a sign-in code appears | Your Azure login expired. Open the link and enter the code. |
| Teleport: *unreachable* or *no route to host* | Your machine can't reach the proxy. Check the VPN and the proxy address. |
| Teleport: *certificate signed by unknown authority* | Start Gate-H with `SSL_CERT_FILE` pointing at your organisation's CA file. |
| Teleport: *access denied* | Your Teleport role doesn't allow that login or node. Run `tsh status` to see your logins. |

## For developers

### Run from source

```bash
npm install       # Node.js 20+; also builds the native modules for Electron
npm run dev       # start Gate-H with hot reload
```

Before opening a pull request, run `npm run typecheck`, `npm run lint` and `npm run build`. To
test a single part: `./scripts/test-azure-tunnel.sh`, `./scripts/test-teleport.sh` and
`node scripts/test-pty-manager.mjs`.

### How it's built

Gate-H is an Electron app with three strictly separated processes:

```
src/
  shared/     # types shared by all processes, incl. the GateHApi contract for window.api
  main/       # main process: SQLite store, SSH and PTY sessions, Grafana/Jira clients,
              # background monitors, one IPC handler file per namespace
  preload/    # the only bridge: a contextBridge API exposed as window.api
  renderer/   # React UI, grouped by feature: shell, terminal, status, clusters
```

- **The renderer has no Node or Electron access.** Everything goes through `window.api`, defined
  in [src/shared/types.ts](src/shared/types.ts).
- **Secrets are write-only.** They're encrypted with `electron.safeStorage` (your OS keychain),
  and the renderer only ever learns whether one is set.
- **State lives in SQLite** (`better-sqlite3`). Migrations only add columns and run at every
  launch.
- **Terminals** are rendered with `@xterm/xterm`. SSH and Azure clusters use an `ssh2` channel.
  Teleport clusters run `tsh ssh` on a local pseudo-terminal (`node-pty`), because `ssh2` can't do
  Teleport's certificate auth.
- **Fonts and icons ship with the app,** so the UI never needs the network just to render.

### Contributing

Each change starts as a GitHub issue and gets its own branch and pull request. [CLAUDE.md](CLAUDE.md)
has the commands, the code map, the conventions and the known gotchas.

## Documentation

| Document | What's in it |
|---|---|
| [docs/TELEPORT.md](docs/TELEPORT.md) | Teleport clusters: the session check, login, routing, and testing. |
| [docs/AZURE.md](docs/AZURE.md) | Azure tunnels: how they stay alive, investigating drops, the script on its own, and testing. |
| [docs/JIRA_GUIDE.md](docs/JIRA_GUIDE.md) | Jira setup, and keeping several clusters' tickets apart in one project. |
| [docs/STATUS.md](docs/STATUS.md) | What's shipped, how each feature was verified, known limitations, and the roadmap. |
| [SPEC.md](SPEC.md) | The functional spec, written as requirements. |
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | Prior art (Open OnDemand, ColdFront/XDMoD, Slurm-web, …) and the reasons behind the design. |
| [CHANGELOG.md](CHANGELOG.md) | Every change, in order, and why. |

## License

[MIT](LICENSE) © 2026 Ahmed Yousri Sobhi

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

## Why Gate-H exists

If you look after more than one HPC cluster, you know the routine. There's a terminal for each
login node, a Grafana tab for each cluster's dashboards, and a Jira board somewhere else. Then the
VPN drops, and you have to work out which of those things are still alive.

Most of the existing tools don't fit this job. Open OnDemand is a portal for many users that you
have to host on a server. Bright/Base Command Manager provisions clusters but doesn't help you
work across them. General SSH managers know nothing about Grafana or Jira.

Gate-H is a single-user desktop app built for this one job. You register each cluster once, with
its SSH identity, its Grafana dashboards, and its Jira project. After that:

- Every cluster sits in a sidebar with a live LED showing whether it's reachable.
- Clicking a cluster opens its terminal and its status side by side.
- One notification feed tells you when anything changes on any cluster.

The clusters on the other end are shared infrastructure, so Gate-H is careful with them. Every
reconnect and re-poll is bounded and backed off, so a cluster that's down never gets flooded with
connection attempts. Secrets are encrypted at rest and never leave the main process.

## Key features

- 🖥️ **Multi-cluster sidebar.** Register any number of clusters. Each has its own SSH profile:
  host, port, user, password/key/agent auth, and an optional jump host. Switching clusters never
  loses your place.
- 🟢 **Live reachability.** Every cluster's SSH port is probed in the background. The probe checks
  for a real SSH banner, not just an open TCP port. An LED shows the result, and it re-checks as
  soon as the window regains focus.
- ⌨️ **Embedded SSH terminal.** Host keys are pinned on first use, SSH keepalives catch silently
  dropped connections, and reconnects are bounded with backoff. The terminal clearly shows when a
  session isn't live.
- ☁️ **Azure tunnels built in.** For clusters behind Azure Bastion or `az ssh vm`, Gate-H signs in
  with the Azure CLI, opens the tunnel, and connects SSH through it.
- 📊 **Live Grafana status.** Health checks, plus live panels you pick yourself. Lay them out
  stacked or side by side and resize each one.
- 🎫 **Jira, Cloud or Data Center.** List a cluster's issues and file new ones from its view.
  Gate-H picks the right auth scheme for you.
- 🧩 **Widgets side by side, not tabs.** Show, hide, swap, stack, and drag-resize the terminal and
  status widgets. The layout survives restarts.
- 🔔 **One notification feed.** Reachability changes, Jira activity, and unexpected SSH
  disconnects from every cluster in one place. Click a notification to jump to the cluster and
  widget it's about.
- 🗂️ **Profiles and an overview dashboard.** Group clusters into profiles such as "Work" and
  "Research". The default view is a grid of every cluster in the active profile.
- ⏸️ **Pinning and standby.** Pin a cluster to keep its session alive in the background, or put it
  in standby to stop all its connections until you need it again.

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

### 1. Get the app

The reproducible way to get a runnable Gate-H needs only
[Docker](https://docs.docker.com/engine/install/), with no local Node toolchain:

```bash
git clone git@github.com:AhmedYousriSobhi/gate-h.git
cd gate-h
./build-desktop.sh
./dist/Gate-H-*.AppImage
```

`build-desktop.sh` builds a pinned Node and native-module toolchain image, then builds and packages
Gate-H inside a container from it. You get the same result on any machine, whatever is installed
locally. [docker/build.Dockerfile](docker/build.Dockerfile) shows exactly what's in that image.

### 2. Your first cluster

1. You start in a default profile called "Personal". To keep separate contexts apart (e.g. "Work"
   and "Research"), click the profile name at the top of the sidebar. Each profile has its own
   clusters and dashboard.
2. Click **+ Add** in the sidebar. Enter a name and the SSH connection details (host, user, auth
   method). Grafana and Jira are optional for each cluster.
3. The **Overview** dashboard, the default view, shows every cluster in the current profile:
   reachability, tags, configured integrations, and unread notifications.
4. Click a cluster in the sidebar, or its card on Overview, to open it. Its **Terminal** and
   **Status** (Grafana health and dashboards, plus Jira issues) widgets open side by side. The
   sidebar and its LEDs stay visible, so switching clusters takes one click.
5. Use the toolbar above the widgets to swap their order, switch between side by side and
   stacked, or open the widget picker (puzzle-piece icon) to show or hide each one. The picker
   also lists widgets planned for later, such as job queue, GPU usage, and storage quota.

For Jira setup, including how to keep several clusters' tickets apart in one shared Jira project,
see [docs/JIRA_GUIDE.md](docs/JIRA_GUIDE.md).

### Clusters reachable only through Azure

Some clusters can only be reached through an Azure tunnel. Gate-H can open that tunnel itself,
using [resources/azure-tunnel.sh](resources/azure-tunnel.sh), each time it connects. It signs in
with the Azure CLI, selects the subscription, opens the tunnel, then connects SSH through it.
[docs/AZURE.md](docs/AZURE.md) covers how the tunnel is kept alive, how to investigate drops, and
how to test it.

**Prerequisites**

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) on your `PATH`.
  The script installs the `bastion` or `ssh` CLI extension on first use if it's missing.
- One of these ways to reach the cluster:
  - `--mode bastion`: an Azure Bastion host on the Standard or Premium SKU, with
    **Native client support** enabled, plus Reader access to the Bastion host and the target VM.
  - `--mode az-ssh`: a VM you can log in to with `az ssh vm`. By default that needs Entra ID
    login, which means the *Virtual Machine User Login* or *Administrator Login* role on the VM.
    Pass `--local-user` to log in with a local VM account instead. The VM then forwards to the
    cluster's login node.

**Steps (in the app)**

1. Sign in once in a terminal with `az login`. Gate-H can also sign in for you: if `az` has no
   valid session, the terminal view shows a device-code prompt (a URL and a code) to finish in
   your browser.
2. Click **+ Add** (or edit a cluster). Fill in **SSH connection** with the tunnel's *far end*:
   - Bastion: the target VM's host name and SSH port.
   - az ssh vm: the login node's host name and port, as the VM reaches it.

   These are *not* `127.0.0.1`. Leave the jump host unchecked; the tunnel does that job.
3. Tick **Azure tunnel** and fill in the fields:
   - **Tunnel through:** Azure Bastion, or VM via az ssh vm.
   - **Local port:** any free port, e.g. `2222`.
   - **Subscription:** click **Load from az** to pick one.
   - **Resource group**, and optionally **Tenant ID**.
   - Bastion: **Bastion name** and **Target VM resource ID**.
   - az ssh vm: **VM name**, and optionally **Local VM user**.
4. Select the cluster. The terminal shows each step (*Checking Azure CLI session*, *Using
   subscription '…'*, *Tunnel active on port 2222*), then connects.

The tunnel stays open across reconnects. If it drops, the terminal's automatic reconnect reopens it.
If a connect through it fails, Gate-H replaces it. The tunnel closes when you quit Gate-H, edit or
remove the cluster, or put the cluster in standby. The cluster's LED shows the tunnel's health.

**Staying connected.** Gate-H sends an SSH keepalive every 15 s, which is well under Azure's
4-minute idle timeouts. The best protection against drops you can't prevent (Bastion maintenance,
sleep, Wi-Fi changes) is running your shell inside `tmux new -A -s main` on the login node, so a
reconnect puts you back where you were. See [docs/AZURE.md](docs/AZURE.md) for why Azure sessions
drop and what else helps.

**Using the script without the app** (for debugging, or for another SSH client):

1. List your subscriptions. If you're not logged in, this runs `az login` first:

   ```bash
   ./resources/azure-tunnel.sh subscriptions
   ```

2. Open the tunnel. `--local-port` is the port on your machine (on `127.0.0.1`), and
   `--remote-port` is the port on the target (default `22`). If you leave out `--subscription`
   and you have more than one, the script shows a menu to pick one.

   ```bash
   # Through Azure Bastion, straight to the target VM's SSH port:
   ./resources/azure-tunnel.sh up --name mycluster --mode bastion \
     -g my-rg --bastion my-bastion \
     --target-id /subscriptions/<sub-id>/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/login01 \
     -l 2222 -s "<subscription name or id>"

   # Through a VM with `az ssh vm`, forwarding on to a login node the VM can reach:
   ./resources/azure-tunnel.sh up --name mycluster --mode az-ssh \
     -g my-rg --vm my-jumpbox --remote-host login01.internal \
     -l 2222 -s "<subscription name or id>"
   ```

   Once it prints `STATUS active Tunnel active on port 2222`, the tunnel is running in the
   background. You can run `up` again safely: if the tunnel is already up, it just reports that.

3. Connect any SSH client to it: `ssh -p 2222 <user>@127.0.0.1`.

4. Check on the tunnel, or close it when you're done:

   ```bash
   ./resources/azure-tunnel.sh status --name mycluster
   ./resources/azure-tunnel.sh down   --name mycluster
   ```

To keep the tunnel tied to your terminal instead, add `--foreground` to `up`. Ctrl-C then closes
it.

**Saving the settings.** Every option can also come from an `AZT_*` environment variable or a
`--config` file. Command-line flags win over both. For example:

```bash
# ~/.config/gate-h/mycluster.azure
AZT_NAME=mycluster
AZT_MODE=bastion
AZT_RESOURCE_GROUP=my-rg
AZT_BASTION=my-bastion
AZT_TARGET_ID=/subscriptions/<sub-id>/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/login01
AZT_SUBSCRIPTION=<subscription id>
AZT_LOCAL_PORT=2222
```

```bash
./resources/azure-tunnel.sh up --config ~/.config/gate-h/mycluster.azure
```

`./resources/azure-tunnel.sh help` lists every option and exit code. If `up` fails, the last lines
of the tunnel's log are printed, and the full log is kept at
`$XDG_RUNTIME_DIR/gate-h-azure-tunnel/<name>.log`.

### Clusters behind Teleport

For clusters that are only reachable through a [Teleport](https://goteleport.com/) proxy, the
terminal runs `tsh ssh` for you. It first checks for a valid Teleport session and, if there
isn't one, logs you in right in the terminal.

1. Install the Teleport client so `tsh` is on your `PATH`.
2. Add or edit the cluster and tick **Behind Teleport**:
   - **Proxy address:** e.g. `teleport.example.com:443`.
   - **Leaf cluster**, **Teleport user**, **Auth connector:** optional.
   - **Teleport node name** (in the SSH section): the node as `tsh ls` lists it, e.g. `slogin1`.
   - **Login:** the OS account to log in as on the node.
3. Select the cluster. If you need to log in, the password and OTP prompts appear in the
   terminal, or your browser opens for SSO. The shell starts once you're logged in.

The same session check and routing are available from the command line through
[resources/teleport.sh](resources/teleport.sh). [docs/TELEPORT.md](docs/TELEPORT.md) covers both.

## Development

For active development (with hot reload), run Gate-H directly with Node instead — Docker doesn't
give you a GUI window, so it's only used for reproducible packaging above, not for `dev`:

```bash
npm install       # install dependencies (Node.js 20+ required)
npm run dev       # launch Gate-H in development mode
```

Other useful scripts: `npm run lint`, `npm run typecheck`, `npm run build`.

## Architecture

Gate-H is an Electron app with three processes. They are strictly separated, and only a narrow,
explicit bridge connects them.

```
src/
  shared/     # types shared by all three processes, incl. the GateHApi contract for window.api
  main/       # Electron main process: SQLite store, SSH sessions, Grafana/Jira clients,
              # background monitors, one IPC handler file per namespace
  preload/    # the only bridge: a contextBridge API exposed as window.api
  renderer/   # React UI, grouped by feature: shell, terminal, status, clusters
```

- **The renderer has no Node or Electron access.** Everything goes through `window.api`, which is
  defined once in [src/shared/types.ts](src/shared/types.ts).
- **Secrets are write-only.** SSH passphrases and Grafana/Jira tokens are encrypted with
  `electron.safeStorage` (backed by the OS keychain, e.g. libsecret on Linux). The renderer only
  ever gets `has*Secret` booleans back.
- **Local state lives in SQLite** (`better-sqlite3`): clusters, profiles, notifications, and the
  panel layout. Migrations only ever add columns and run on every launch.
- **No local PTY.** Every terminal is a remote channel from `ssh2`, rendered with `@xterm/xterm`.
- **Integrations** use the Grafana HTTP API (service-account token) and the Jira REST API (Cloud:
  email + API token; Data Center: Personal Access Token).
- **Typography and icons ship with the app.** Inter and JetBrains Mono are self-hosted via
  `@fontsource`, and icons come from `lucide-react`. The UI never needs network access just to
  render.

## Documentation

| Document | What's in it |
|---|---|
| [SPEC.md](SPEC.md) | The functional spec: what Gate-H should do, written as requirements. |
| [docs/STATUS.md](docs/STATUS.md) | What's shipped today, how each feature was verified, known limitations, and the roadmap. |
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | Prior art (Open OnDemand, ColdFront/XDMoD, Slurm-web, …) and the reasons behind the architecture. |
| [docs/AZURE.md](docs/AZURE.md) | Azure tunnels: how they stay alive, investigating drops, and testing. |
| [docs/JIRA_GUIDE.md](docs/JIRA_GUIDE.md) | Jira setup step by step, and keeping clusters' tickets apart. |
| [CHANGELOG.md](CHANGELOG.md) | The build log: every change, in order, and why. |
| [CLAUDE.md](CLAUDE.md) | A short guide for contributors and coding agents: commands, code map, conventions, and gotchas. |

## Contributing

Each change starts as a GitHub issue and gets its own branch and pull request. A PR is merged into
`main` once `npm run typecheck`, `npm run lint`, and `npm run build` all pass. There's no
automated test suite yet. [docs/STATUS.md](docs/STATUS.md) explains how each feature has been
verified so far.

## License

[MIT](LICENSE) © 2026 Ahmed Yousri Sobhi

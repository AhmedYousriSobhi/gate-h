<p align="center">
  <img src="resources/icon.png" alt="Gate-H icon" width="96" height="96">
</p>

<h1 align="center">Gate-H</h1>

<p align="center">
  A standalone desktop app (not a browser app) for managing HPC workloads across multiple
  clusters, from a single Linux desktop.
</p>

## What it does

- **Multi-cluster management** — register any number of HPC clusters, each with its own SSH
  connection profile (host, port, user, auth method, optional jump/bastion host), always visible
  in a sidebar so switching between clusters never means losing your place.
- **Live reachability monitoring** — every registered cluster is continuously checked in the
  background; a colored LED next to its name shows at a glance whether it's currently reachable.
- **Connect & operate** — open an SSH session (embedded terminal) to any registered cluster
  without leaving the app.
- **Live status via Grafana** — pull cluster health and dashboard snapshots from each cluster's
  Grafana instance using the Grafana REST API.
- **Jira integration** — view matching issues and file new tickets against a cluster's Jira
  project, for both Jira Cloud and Jira Data Center/Server.
- **Side-by-side widgets, not tabs** — a cluster's Terminal and Status live in the same view at
  once instead of switching back and forth; toggle either one on/off, swap their positions, or
  flip between a side-by-side and stacked layout, all from the panel's toolbar. The widget picker
  also previews what's planned next (job queue, GPU usage, storage quota, node health, job
  history) - see [docs/STATUS.md](docs/STATUS.md) for the roadmap.
- **Cross-cluster notifications** — a bell icon collects reachability changes, new/updated Jira
  tickets, and unexpected SSH disconnects from every cluster in one place, so you don't have to
  click into each one to notice something changed. Clicking a notification jumps straight to the
  relevant cluster and brings the right widget into view.
- **Overview dashboard** — the default view is a grid of every cluster in the current profile,
  with its reachability, tags, configured integrations, and unread notification count at a
  glance - not just a blank "pick something" screen.
- **Profiles** — group clusters under separate named profiles (e.g. "Work" vs "Research"), each
  with its own cluster list and dashboard; switch between them from the sidebar without one
  profile's clusters cluttering another's view.

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

## Get the app

The reproducible way to get a runnable Gate-H, no local Node/toolchain setup required — just
[Docker](https://docs.docker.com/engine/install/):

```bash
./build-desktop.sh
./dist/Gate-H-*.AppImage
```

`build-desktop.sh` builds a pinned Node + native-module toolchain image, then builds and packages
Gate-H inside a container from it — the same result on any machine, regardless of what's installed
locally. See [docker/build.Dockerfile](docker/build.Dockerfile) for exactly what's in that image.

Then, inside the app:

1. You start in a single default profile ("Personal") - click the profile name at the top of the
   sidebar if you want separate profiles for separate contexts (e.g. "Work" vs "Research"), each
   with its own clusters and dashboard.
2. Click **+ Add** in the sidebar and fill in a name plus its SSH connection details (host, user,
   auth method). Grafana and Jira are optional per cluster.
3. The **Overview** dashboard (the default view) shows every cluster in the current profile at a
   glance - reachability, tags, configured integrations, unread notifications.
4. Click a cluster in the sidebar (or its card on Overview) to open it - its embedded SSH
   **Terminal** and **Status** (Grafana health/dashboards + Jira issues) widgets show side by
   side by default, not as tabs; the sidebar (and its live reachability LEDs) stays visible the
   whole time, so switching clusters is just a click.
5. Use the toolbar above the widgets to swap their left/right (or top/bottom) order, switch
   between side-by-side and stacked, or open the widget picker (puzzle-piece icon) to hide/show
   either one - it also previews widgets planned for later (job queue, GPU usage, storage quota,
   and more).

### Clusters reachable only through Azure

Some clusters can only be reached through an Azure tunnel. For those, you open the tunnel first
with [resources/azure-tunnel.sh](resources/azure-tunnel.sh), then point Gate-H at the tunnel's
local end.

> **Not yet built into the app.** Gate-H has no Azure option or pre-flight step in its UI yet.
> The script runs on its own, from a terminal, before you connect.

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

**Steps**

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

3. In Gate-H, add (or edit) the cluster with **Host** `127.0.0.1`, **Port** `2222`, and your usual
   cluster username and auth method. Don't set a jump host; the tunnel does that job.

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

## Development

For active development (with hot reload), run Gate-H directly with Node instead — Docker doesn't
give you a GUI window, so it's only used for reproducible packaging above, not for `dev`:

```bash
npm install       # install dependencies (Node.js 20+ required)
npm run dev       # launch Gate-H in development mode
```

Other useful scripts: `npm run lint`, `npm run typecheck`, `npm run build`.

## Tech stack

- **Shell**: Electron (Linux-first; cross-platform later if needed)
- **UI**: React + TypeScript, bundled with Vite (`electron-vite`); Inter (UI text) and JetBrains
  Mono (hostnames/code), both self-hosted via `@fontsource*` so the app never depends on network
  access just to render its own typography; icons from `lucide-react`
- **SSH / terminal**: `ssh2` (SSH client, password/key/agent auth, jump-host chaining) +
  `@xterm/xterm` for the embedded terminal (no local PTY needed - every session is a remote SSH
  channel)
- **Secrets**: `electron.safeStorage` (OS keychain-backed, e.g. libsecret on Linux) - SSH
  passphrases and Grafana/Jira API tokens are encrypted at rest and never sent back to the
  renderer once saved
- **Local persistence**: `better-sqlite3` for cluster/profile configuration and app preferences
  (e.g. the panel layout)
- **Integrations**: Grafana HTTP API (service-account token), Jira REST API (Cloud: email + API
  token; Data Center: Personal Access Token)

Project layout:

```
src/
  shared/     # types shared between main and renderer (over the preload bridge)
  main/       # Electron main process — SSH sessions, SQLite store, Grafana/Jira HTTP calls
  preload/    # contextBridge API exposed to the renderer
  renderer/   # React UI (sidebar + panel shell, terminal, Grafana/Jira status)
```

## Learn more / project status

This README stays focused on what Gate-H is and how to run it. For anything deeper:

- **[docs/JIRA_GUIDE.md](docs/JIRA_GUIDE.md)** — step-by-step Jira setup, and how to keep multiple
  clusters' tickets from bleeding into each other when they share one Jira project (plus where
  Confluence currently stands: not integrated yet).
- **[docs/STATUS.md](docs/STATUS.md)** — current feature completeness, how each feature has been
  verified so far, and known limitations/roadmap.
- **[CHANGELOG.md](CHANGELOG.md)** — the chronological build log: every change, in the order it
  happened, and why.
- **[docs/ANALYSIS.md](docs/ANALYSIS.md)** — prior-art research (Open OnDemand, ColdFront/XDMoD,
  Slurm-web, etc.) and the architecture decisions behind Gate-H.

Each feature is developed on its own `feature/*` branch and merged into `main` once it builds,
lints, and typechecks cleanly.

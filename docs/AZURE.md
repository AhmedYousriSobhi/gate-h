# Azure tunnels: keeping them alive, investigating drops, testing

This covers clusters whose login node can only be reached through Azure. For setup (the
prerequisites and form fields), see "Through Azure" in the README's
[Quick start](../README.md#-quick-start).

## How it works

```
Gate-H terminal ──ssh2──▶ 127.0.0.1:<local port> ══ Azure tunnel ══▶ login node :22
                                    ▲
       resources/azure-tunnel.sh up ┘  (az login → az account set → bastion tunnel | az ssh vm -L)
```

- **Connecting** (`src/main/ssh/manager.ts`): before a cluster with an Azure tunnel connects,
  `ensureTunnel()` in `src/main/azure/tunnel.ts` runs `azure-tunnel.sh up --non-interactive`.
  - `up` is idempotent: if the tunnel is already healthy, it returns straight away.
  - Its `STATUS` lines are sent to the terminal view: *Checking Azure CLI session*, then
    *Using subscription '…'*, then *Tunnel active on port N*.
  - If `az` needs a login, the terminal also shows the device-code prompt, as selectable text.
  - SSH then dials `127.0.0.1:<local port>`. The host key stays pinned under the cluster's real
    Host/Port, not under 127.0.0.1.
- **Lifetime**: the tunnel is a detached process group, tracked in
  `$XDG_RUNTIME_DIR/gate-h-azure-tunnel/gateh-<cluster id>.state`, and it outlives any one SSH
  session. It stops when any of these happens:
  - you quit Gate-H
  - you edit or remove the cluster
  - you put the cluster in standby
  - an SSH connect through the tunnel fails (see the hung-tunnel case below)
- **Reachability LED**: the LED shows the tunnel's health. The sidebar LED is green only while the
  tunnel is up:
  - **az-ssh:** the tunnel must be up, and the usual SSH banner probe must pass through it.
  - **Bastion:** the tunnel process must be alive and listening. There's no probe, because a
    Bastion tunnel handles only one connection at a time reliably
    ([azure-cli#24600](https://github.com/Azure/azure-cli/issues/24600)), and a probe could collide
    with your session.

## Finding your cluster's Azure details

Azure Resource Graph searches across **every subscription you have access to** in one query, so
you don't need to already know (or guess) the right subscription before you can fill in the form.

```bash
# One-time, if az doesn't already have it (usually auto-installs on first use):
az extension add --name resource-graph

# Which subscription/resource group is this VM in?
az graph query -q "Resources | where type =~ 'microsoft.compute/virtualmachines' and name =~ '<vm-name>' | project name, resourceGroup, subscriptionId, id" --output table

# Which Bastion host serves it?
az graph query -q "Resources | where type =~ 'microsoft.network/bastionhosts' | project name, resourceGroup, subscriptionId" --output table

# Your tenant ID for a given subscription (also what the form's "Load from az" fetches):
az account list --query "[].{name:name, id:id, tenantId:tenantId}" --output table
```

The first query's `id` column is the VM's full resource ID, for the Bastion form's **Target VM
resource ID** field - or leave that blank and put the VM name in **VM name** instead, and Gate-H
resolves it the same way, itself, when the tunnel opens. `subscriptionId` and `resourceGroup` go
straight into the matching form fields.

## Keeping the tunnel and the shell alive

### Why Azure sessions drop

| Cause | What happens | Source |
|---|---|---|
| **4-minute idle timeouts** on Azure Load Balancer, NAT Gateway, and public-IP outbound | Idle flows are dropped **silently**, with no RST, so both ends think the connection is still open. | [LB TCP reset](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-tcp-reset), [NAT GW FAQ](https://learn.microsoft.com/en-us/azure/nat-gateway/faq) |
| **Azure Firewall** | North-south traffic times out after 4 min. East-west traffic times out after a fixed 5 min, **without RST**. Scale-in and maintenance also end long sessions. Microsoft recommends keepalives every 30 s. | [Firewall TCP behaviour](https://learn.microsoft.com/en-us/azure/firewall/tcp-session-behavior) |
| **Bastion carries SSH inside a websocket** | The az tunnel sends no websocket pings and sets no TCP keepalive, so only traffic *inside* SSH keeps the path warm. TCP-level keepalives don't help across a proxy. | [`tunnel.py`](https://github.com/Azure/azure-cli-extensions/blob/main/src/bastion/azext_bastion/tunnel.py), [LB docs](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-tcp-reset) |
| **Bastion tunnel hangs** | The websocket drops ("Connection to remote host was lost", "Bad file descriptor"), but the process **keeps running and listening**. | [azure-cli#28367](https://github.com/Azure/azure-cli/issues/28367) |
| **`--timeout` on `az network bastion tunnel`** | Not an idle timeout. The whole tunnel exits after N seconds, however busy it is. | [`custom.py`](https://github.com/Azure/azure-cli-extensions/blob/main/src/bastion/azext_bastion/custom.py) |
| **Bastion maintenance** | Existing sessions are disconnected. | [Bastion FAQ](https://learn.microsoft.com/en-us/azure/bastion/bastion-faq) |
| **`az ssh vm` certificates** | The short-lived Entra certificate is deleted locally about 120 s after connecting. A running `-L` forward survives, but every *reconnect* needs a new `az ssh vm` (and a valid `az` login). | [`ssh_utils.py`](https://github.com/Azure/azure-cli-extensions/blob/main/src/ssh/azext_ssh/ssh_utils.py) |

### What Gate-H already does about it

- **SSH keepalive every 15 s** (`keepaliveInterval: 15000`, `keepaliveCountMax: 3` in
  `src/main/ssh/manager.ts`). That is well under every idle timeout above, and it runs inside SSH,
  so it keeps Bastion's websocket and every NAT/LB/firewall hop active. A path that is really dead
  is detected within about 45 s, instead of the session sitting there looking connected.
- **The az-ssh forwarder has its own keepalive** (`ServerAliveInterval=30`, `ServerAliveCountMax=3`
  in `resources/azure-tunnel.sh`). Its VM hop can sit idle even while Gate-H's SSH session inside
  it is active. `ExitOnForwardFailure=yes` makes it exit, rather than idle uselessly, if its port
  can't be bound.
- **Never passes `--timeout`** to `az network bastion tunnel`.
- **Automatic reconnect reopens the tunnel.** When a session drops, the terminal's existing bounded
  retry runs: 2 tries in 2 minutes, with backoff. Each try goes through `ensureTunnel()`, which
  restarts a dead tunnel (signing in to Azure again if the token has expired). So a dropped tunnel
  is repaired without you re-SSHing.
- **Hung tunnels are replaced, not reused.** If an SSH connect through the tunnel fails, Gate-H
  tears the tunnel down before the next retry, so a hung-but-listening Bastion tunnel (#28367)
  can't keep failing every reconnect.
- **The tunnel is shared across sessions.** A reconnect only redoes SSH, not Azure sign-in and
  tunnel setup, unless the tunnel itself died.

### What to do on your side

- **Run your work inside `tmux` (or `screen`) on the login node.** No keepalive survives Bastion
  maintenance or a laptop going to sleep. But if the shell lives in tmux, a reconnect puts you back
  exactly where you were. Start or reattach one session with:

  ```bash
  tmux new -A -s main
  ```

  Long-running jobs belong in the scheduler (`sbatch`) anyway, not in an interactive shell.
- **Ask the cluster admins for server-side keepalive** (`ClientAliveInterval 30` in `sshd_config`)
  if you are on an east-west path through Azure Firewall. That path sends no RST, so the server's
  half of the connection needs its own keepalive to notice a dead peer.
- **Don't rely on raising idle timeouts.** Microsoft advises against raising NAT Gateway's timeout,
  and the Firewall limit needs a support request. Keepalives are the fix.
- **One session per Bastion tunnel.** Don't point a second SSH client at the same local port while
  Gate-H is connected (#24600).
- **mosh won't work here.** It needs UDP 60000-61000, and both tunnel types carry TCP only.

## Investigating a drop

Go layer by layer, from Azure down to Gate-H. Find the tunnel's name first. It's the state file's
name, without `.state`:

```bash
ls "${XDG_RUNTIME_DIR:-/tmp}/gate-h-azure-tunnel/"      # gateh-<cluster id>.state / .log
NAME=gateh-<cluster id>
```

1. **Is the Azure CLI session still valid?**

   ```bash
   az account get-access-token --output none && echo "token OK"
   az account show --query '{sub:name, user:user.name}' --output table
   ```

   If this fails, the next reconnect will need a login. Gate-H shows the device-code prompt in the
   terminal.
2. **Is the tunnel alive?**

   ```bash
   ./resources/azure-tunnel.sh status --name "$NAME"; echo "exit=$?"
   tail -n 50 "${XDG_RUNTIME_DIR:-/tmp}/gate-h-azure-tunnel/$NAME.log"
   ```

   | exit | meaning | likely cause |
   |---|---|---|
   | 0 | active: process alive, port listening | The drop happened above the tunnel. Go to step 3. |
   | 7 | degraded: process alive, port **not** listening | A hung forwarder. The log usually shows it. |
   | 8 | not running | The tunnel process exited. Check the log: Bastion maintenance, `ServerAlive` giving up on a dead VM hop, an expired token. |

3. **Does SSH work through the tunnel without Gate-H?** Disconnect Gate-H's session first, because
   of the one-connection limit on Bastion tunnels:

   ```bash
   ssh -vvv -p <local port> <user>@127.0.0.1
   ```

   - Stuck at `Connection established` with no banner: the tunnel is hung (#28367). Run `down`,
     then retry.
   - `Connection refused`: nothing is listening. Go back to step 2.
4. **What did Gate-H see?**
   - The terminal's status text shows the last pre-flight line.
   - The notification bell records every unexpected SSH disconnect, with its time.
   - Run Gate-H from a terminal (`npm run dev`, or launch the AppImage from a shell). A failed `up`
     then prints `[gate-h] azure tunnel for <cluster> failed:` followed by the script's last
     stderr lines.
5. **Reproduce the tunnel by hand with Azure's debug logging.** Close Gate-H's tunnel first
   (`azure-tunnel.sh down --name "$NAME"`):

   ```bash
   az network bastion tunnel --name <bastion> --resource-group <rg> \
     --target-resource-id <vm id> --resource-port 22 --port <local port> --debug 2>&1 | tee bastion.log
   # or
   az ssh vm -g <rg> -n <vm> --debug -- -N -L 127.0.0.1:<port>:<login node>:22 -vvv 2>&1 | tee azssh.log
   ```

   Leave it idle for longer than 5 minutes with an SSH session inside it, then compare the time of
   the drop with the idle timeouts in the table above.
6. **Check the Azure side (Bastion).** Enable a diagnostic setting on the Bastion host that sends
   **BastionAuditLogs** to a Log Analytics workspace, then query:

   ```kusto
   MicrosoftAzureBastionAuditLogs
   | where TimeGenerated > ago(1d)
   | order by TimeGenerated desc
   ```

   Each session's start and end show whether Azure ended it, for example during maintenance.
   Bastion's **Sessions** metric shows the concurrent session count. Reference:
   [Bastion monitoring data](https://learn.microsoft.com/en-us/azure/bastion/monitor-bastion-reference).

| Symptom | Most likely cause | Fix |
|---|---|---|
| The shell freezes after a few idle minutes, then drops | An idle timeout on a hop without keepalive | Already covered for Gate-H's own SSH session. If it still happens, check server-side `ClientAliveInterval`. |
| Drops at a fixed interval, even while busy | `--timeout` passed to a bastion tunnel you started by hand | Don't pass `--timeout`. |
| Reconnect fails repeatedly, but `status` says active | A hung Bastion tunnel | Gate-H tears it down after a failed connect. By hand, run `down` then `up`. |
| Reconnect asks for a device code | The `az` refresh token expired | Complete the login shown in the terminal. |
| Drop at an odd hour, and every session drops at once | Bastion or Firewall maintenance | Unavoidable. Use tmux so the shell survives. |

## Using the script on its own

For debugging, or to use the tunnel with another SSH client:

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

### Saving the settings

Every option can also come from an `AZT_*` environment variable or a
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

## Testing

### Offline smoke test (no Azure needed)

```bash
./scripts/test-azure-tunnel.sh
```

This runs `resources/azure-tunnel.sh` against a fake `az` that starts a local listener in place of
the real forwarder. It checks:
- argument validation
- device-code login when there is no session
- refusing to guess among several subscriptions
- `up` idempotency and a port that's already taken
- `status` for a healthy tunnel, a dead one, and a hung one (process alive, port gone)
- `down` killing the tunnel's whole process group

Run it after any change to the script.

### Against real Azure, script only

1. `./resources/azure-tunnel.sh subscriptions` should list what `az account list -o table` lists.
2. Run `up` with your real values (see
   [Using the script on its own](#using-the-script-on-its-own)), then
   `ssh -p <local port> <user>@127.0.0.1`.
3. Run `kill -STOP <pid from the .state file>` to freeze the tunnel. The SSH session should drop
   within about a minute. `down` must still clean up, escalating to SIGKILL.

### In the app

`npm run typecheck` and `npm run lint` cover the code. Run these by hand on a desktop:

1. **Setup:** add the cluster with the Azure tunnel section filled in, and click **Load from az**
   to fill the subscription list.
2. **Pre-flight:** select the cluster. The terminal should step through *Checking Azure CLI
   session*, *Using subscription*, and *Tunnel active on port N*, then connect. With `az` logged
   out, it should show the device-code prompt instead.
3. **Idle:** leave the session idle for 15 minutes or more. It should still be live.
4. **Dropped tunnel:** run `./resources/azure-tunnel.sh down --name gateh-<id>` while connected.
   The terminal should show *reconnecting (attempt 1/2)*, reopen the tunnel, and reconnect by
   itself.
5. **Hung tunnel:** `kill -STOP` the tunnel's process. SSH keepalive should notice within about
   45 s. The failed reconnect tears the frozen tunnel down, and the next attempt opens a fresh one.
6. **Lifecycle:** check each of these, and confirm the `.state` file is gone afterwards.
   - Put the cluster in standby: the tunnel stops.
   - Edit the cluster: the tunnel stops, and the next connect opens a new one.
   - Quit Gate-H: the tunnel stops.

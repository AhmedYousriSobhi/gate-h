# Teleport-protected clusters: session pre-flight and routing

This covers clusters whose login nodes are only reachable through a
[Teleport](https://goteleport.com/) proxy (`tsh login --proxy=...` then `tsh ssh user@node`).
The work is done by [resources/teleport.sh](../resources/teleport.sh). You can run it on its own,
and Gate-H's terminal runs it for clusters set up with **Behind Teleport** (see
[In the app](#in-the-app)).

## What the script does

```
teleport.sh ssh --proxy P --cluster C -- user@node cmd
   │
   ├─ no --proxy? ───────────────────────────────▶ exec ssh user@node cmd   (direct cluster)
   │
   ├─ tsh status --format=json   (local only, reads ~/.tsh)
   │    session for P, ≥ --min-ttl left? ─ yes ─▶ exec tsh --proxy=P ssh --cluster=C user@node cmd
   │                                   └─ no ──▶ tsh login --proxy=P [--auth] [--browser=none] [C]
   │                                              then check again, then exec as above
   └─ failures ▶ STATUS error <reason> + a stable exit code
```

- **Pre-flight** (`status`): looks for a profile for *this* proxy (and `--user`, if given) in
  every stored profile, not only the active one. A session with less than `--min-ttl` (default
  5 minutes) left counts as expired, so a long shell or copy doesn't start on a certificate that's
  about to run out.
- **Login** (`login`, or automatically before `ssh`/`scp`): a no-op if the session is usable.
  With no terminal (or `--non-interactive`) it passes `--browser=none`, so tsh prints the SSO link
  on stderr for the caller to show instead of trying to open a browser. `--login-timeout`
  (default 180s) stops it waiting forever for an SSO callback nobody completes.
- **Several clusters and proxies**: every tsh call gets `--proxy` (and `--cluster` for a leaf
  cluster) explicitly. Two clusters behind different proxies can be used side by side, and
  neither depends on which tsh profile is currently active.
- **Direct clusters**: `ssh`/`scp` with no `--proxy` run plain OpenSSH, so a caller can use the
  one script for every cluster.

Output follows the same contract as `azure-tunnel.sh`: `STATUS <phase> <message>` lines on
stdout (phases `check`, `login`, `valid`, `expired`, `error`), diagnostics and tsh's own output
on stderr. For `ssh`/`scp`, pre-flight output goes to stderr and stdout belongs to the remote
command.

| Exit | Meaning | What a caller should do |
|---|---|---|
| 0 | ok | - |
| 2 | usage (e.g. no `--proxy`) | fix the cluster's config |
| 3 | `tsh` or `python3` missing | tell the user to install it |
| 4 | no usable session (`status`, or `--no-login`) | run `login` |
| 5 | login failed or timed out, or needs a password/OTP prompt with no terminal | show the reason; don't retry on its own |
| 6 | proxy unreachable (DNS, refused, timeout) | back off and retry, like any unreachable cluster |

After a successful pre-flight, `ssh`/`scp` exit with the remote command's own exit code.

## Usage

```bash
./resources/teleport.sh status --proxy teleport.example.com:443
./resources/teleport.sh login  --proxy teleport.example.com:443 --auth okta
./resources/teleport.sh login  --proxy teleport.example.com:443 --force   # renew a still-valid session
./resources/teleport.sh ssh    --proxy teleport.example.com:443 --cluster hpc-leaf -- alice@slogin1
./resources/teleport.sh scp    --proxy teleport.example.com:443 -- ./job.sh alice@slogin1:~/
./resources/teleport.sh ssh    -- alice@login.direct.example.com     # not behind Teleport
```

Options can also come from `TPW_*` environment variables or a `--config` file of `TPW_*=...`
assignments (flag > config file > environment > default), the same scheme as `AZT_*`.
`./resources/teleport.sh help` lists them all.

## Testing

```bash
./scripts/test-teleport.sh
```

This runs against a fake `tsh`, so no Teleport account or network is needed. It covers the
session states (none, expired, about to expire, valid, other proxy, other user, non-active
profile), login and its failure modes (unreachable proxy, no terminal for a password prompt,
timeout), and routing through tsh or straight to OpenSSH.

### Against a real proxy

These cases have been checked with `tsh` v18.11.2 against a one-VM Teleport v18 cluster (auth,
proxy and SSH node together) with a local user using password + OTP:

- **Session states**: none (exit 4), valid (the real `tsh status --format=json` is parsed
  correctly), under `--min-ttl` (exit 4), and belonging to a different `--user` (exit 4).
- **Login**: interactive password + OTP works. A second `login` doesn't prompt. With no
  terminal, login fails with exit 5 and the "needs a terminal prompt" message.
- **Handover**: `ssh` with and without `--cluster`, the remote exit code passed through, and an
  interactive shell with a real PTY and the local window size. An `scp` round trip works, and
  stdout carries only the remote command's output.
- **Direct route**: `ssh` with no `--proxy` runs plain OpenSSH. `tsh login` loads Teleport keys
  into ssh-agent, so pass `-o IdentitiesOnly=yes` with `-i` if the server limits auth attempts.
- **Unreachable proxy** (exit 6): refused, DNS-failed, and silently dropped. A dropped proxy
  shows up as a timeout while tsh's first request (`webapi/ping`) is still pending.

Not yet run against a real proxy: certificate expiry (`tsh login --ttl`) and SSO login (the lab
has no SSO provider).

## In the app

Gate-H's SSH terminal uses `ssh2`, which (as of 1.17) can't authenticate with OpenSSH user
certificates, and Teleport nodes only accept certificate auth. So a cluster with **Behind
Teleport** set gets a different kind of session: `teleport.sh ssh` running on a local
pseudo-terminal ([node-pty](https://github.com/microsoft/node-pty)).

```
xterm ──ssh:write/resize──▶ main: ptyManager (src/main/pty/manager.ts)
      ◀──ssh:data/closed── PTY: bash teleport.sh ssh --proxy P [--cluster C] -- login@node
                                   │  session check, then (only if needed) tsh login
                                   └─ exec tsh ssh ──▶ Teleport proxy ──▶ node
```

- **Same session interface.** `openSshSession` in `src/main/ssh/manager.ts` sends Teleport
  clusters to the PTY and SSH/Azure clusters to `ssh2`. Both sit behind the same session IDs and
  `ssh:*` IPC channels, so the renderer drives both the same way.
- **A terminal never logs in by itself.** It runs `teleport.sh ssh --no-login`. With no usable
  session, the wrapper exits 4 at once and the terminal shows **Teleport login needed** with a
  **Log in** button. That state is never resumed automatically: reachability going green
  doesn't make a login happen. A cluster in the background, or a reconnect nobody is
  watching, therefore can't open SSO browser tabs or sit on a hidden password prompt.
- **Logging in is its own dialog.** **Log in** (and **Renew**, below) opens a small terminal
  running `teleport.sh login` on its own PTY. The password and OTP prompts are answered there,
  or `tsh` opens the browser for SSO. The cluster's shell is never touched. Gate-H never
  answers a prompt.
- **One login covers the proxy.** `src/main/teleport/sessionState.ts` tracks each cluster's
  session: clusters with the same proxy and Teleport user share one. After any login (in the
  dialog, or `tsh login` in any terminal), every terminal on that proxy that shows **Login
  needed** reconnects by itself.
- **Expiry warning.** 15 minutes before a session expires, one notification goes out per shared
  session, and the terminal's status bar shows *Teleport login expires at HH:MM* with **Renew**.
  Renew runs `teleport.sh login --force`, which signs out of that proxy first, because `tsh
  login` returns straight away while a session is still valid. A session that expires while
  Gate-H is running gets one more notification. One that expired while it was closed doesn't:
  its terminals already say **Log in**.
- **Nothing polls.** `tsh status` (local only) runs at startup, when clusters change, after a
  login, and when `~/.tsh` changes (an `fs.watch`/inotify watch, debounced to 500 ms). Each
  session has one timer for the warning and one for expiry, re-armed on every refresh. Timers are
  unref'd and all are released on quit. With no Teleport clusters, `tsh` never runs.
- **Other errors.** Until the wrapper reports `STATUS valid`, `TeleportPreflight` follows its
  `STATUS` lines. If the session fails its check (proxy unreachable, login failed, `tsh`
  missing), the reason becomes the terminal's error banner and the notification. Exit code 0
  (the user typed `exit`) raises no notification.
- **Resize and close.** Window size changes reach the remote shell through `tsh`. Closing a
  session sends SIGHUP, as closing a terminal window does, and SIGKILL after 3 seconds if
  it's still running.
- **Reachability.** The node name only resolves inside Teleport, so the cluster's LED tracks its
  proxy, through the proxy's unauthenticated `/webapi/ping` endpoint. Without a port, the probe
  tries 443 and then 3080. The proxy's multiplexed port sends no SSH banner, so the usual banner
  check can't be used.
- **Setup.** In the cluster form, tick **Behind Teleport** and enter the proxy address, plus a
  leaf cluster, Teleport user or auth connector if needed. Host becomes the Teleport node name
  (as `tsh ls` shows it) and Username the login. Port, auth method and jump host don't apply - a
  jump host can't be layered on a Teleport connection, since every node Teleport routes to
  presents a certificate-format host key that this app's SSH library (`ssh2`) can't verify.
  `tsh` must be on the app's `PATH`. A proxy behind your organisation's own CA needs `SSL_CERT_FILE`
  (and/or `SSL_CERT_DIR`) set to the CA bundle, as for `tsh` itself - on macOS, Gate-H adopts these
  from your login shell at startup the same way it already does `PATH`, so exporting them in
  `.zshrc`/`.bash_profile` and restarting the app is enough; they don't need to be set on whatever
  command launches it. A self-signed or lab proxy with no real CA to point that at instead has its
  own **Skip certificate verification** checkbox in the cluster form (`tsh`'s own `--insecure`) -
  off by default, since it drops TLS verification entirely; only turn it on for a proxy you know is
  self-signed.

### Testing the PTY session

```bash
node scripts/test-pty-manager.mjs
TELEPORT_LAB_PROXY=teleport.example.com:443 TELEPORT_LAB_USER=alice \
  TELEPORT_LAB_NODE=slogin1 TELEPORT_LAB_LOGIN=alice node scripts/test-pty-manager.mjs
```

This runs `PtyManager` under Electron's own Node (`ELECTRON_RUN_AS_NODE`), so node-pty loads as
the build the app ships and no window is needed. It covers spawn size, resize, input, exit codes,
SIGHUP and the SIGKILL fallback, UTF-8 decoding, and a failed Teleport check. With the
`TELEPORT_LAB_*` variables set, it also runs a real `tsh ssh` session: the check passes, the
shell hands over, and it checks the remote size before and after a resize, a clean exit, and a
kill. That run needs an existing `tsh` session, because nobody is there to answer a login prompt.
It has been run against a one-VM Teleport v18 lab.

The same command also runs `scripts/teleport-sessions.checks.ts` against a fake `tsh` and a
scratch `HOME`. It checks session matching, the 15-minute warning and expiry notifications (each
sent once), that a burst of `~/.tsh` writes triggers a single `tsh status`, and that a login in any
terminal is picked up. It also checks that when idle, nothing runs and exactly two timers and one
watcher are live, and that stopping the monitor releases all of them. A probe counts the timers
and watchers directly, because `process.getActiveResourcesInfo()` leaves out unref'd ones. The UI (form section, status bar) is only
checked by typecheck, lint and review, since this environment can't open an Electron window.

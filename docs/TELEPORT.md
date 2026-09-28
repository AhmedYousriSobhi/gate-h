# Teleport-protected clusters: session pre-flight and routing

This covers clusters whose login nodes are only reachable through a
[Teleport](https://goteleport.com/) proxy (`tsh login --proxy=...` then `tsh ssh user@node`).
Right now this is a standalone script, [resources/teleport.sh](../resources/teleport.sh). The
in-app terminal can't reach these clusters yet (see [In the app](#in-the-app)).

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

The fake's `tsh status --format=json` output and the error strings the script classifies are
based on Teleport's documented behavior. They have not been checked against a real proxy. Before
relying on the exit codes, run `status`/`login` once against your proxy.

## In the app

Gate-H's terminal uses `ssh2`, which (as of 1.17) can't authenticate with OpenSSH user
certificates. Teleport nodes only accept certificate auth, so the `ssh2` session path can't reach
them even through `tsh proxy ssh`. There are two ways to add in-app support:

1. **`tsh ssh` under a PTY** (recommended): the main process runs the pre-flight with
   `teleport.sh login --non-interactive` (the SSO link goes to the terminal view, like Azure's
   device code), then spawns `tsh --proxy=P ssh --cluster=C user@node` in a pseudo-terminal
   wired to xterm. This needs `node-pty`, a new native dependency.
2. **Pipes, no new dependency**: spawn `tsh ssh -t` with plain pipes. This works, but terminal
   resizes can't reach the remote shell, so full-screen tools (vim, htop) render at a fixed
   size.

The app should never answer tsh's prompts for it. A login runs only as the separate, time-limited
`login --non-interactive` step, with stdin closed. The terminal's `tsh ssh` starts only after
that pre-flight passes, so any prompt it still shows (e.g. per-session MFA) appears in the
terminal, where the user can answer it. Nothing blocks on a prompt no one can see.

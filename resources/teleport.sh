#!/usr/bin/env bash
# teleport.sh - check for a usable Teleport session, log in when there isn't
# one, and route ssh/scp through `tsh` for clusters that sit behind a
# Teleport proxy (or through plain OpenSSH for clusters that don't).
#
# Same output contract as azure-tunnel.sh, so Gate-H's main process can drive
# either one the same way:
#   stdout - one machine-parseable line per state change:
#              STATUS <phase> <free-text message>
#            phases: check, login, valid, expired, error
#   stderr - human-oriented diagnostics and tsh's own output (e.g. the SSO
#            link to open when no browser can be launched).
# Exit codes are stable (EXIT_* below). `ssh`/`scp` hand over to tsh/ssh with
# exec once the pre-flight passes, so from then on the exit code and stdout
# are the remote command's own.
#
# Run `teleport.sh help` for usage.

set -euo pipefail

readonly EXIT_USAGE=2
readonly EXIT_DEPS=3
readonly EXIT_NO_SESSION=4
readonly EXIT_LOGIN=5
readonly EXIT_NETWORK=6

usage() {
  cat >&2 <<'EOF'
Usage:
  teleport.sh status [options]              is there a usable session for --proxy?
  teleport.sh login  [options]              log in unless a usable session exists
                                            (--force: sign out of --proxy first, to renew)
  teleport.sh ssh    [options] -- [ssh args] pre-flight, then tsh ssh (or ssh if no --proxy)
  teleport.sh scp    [options] -- [scp args] pre-flight, then tsh scp (or scp if no --proxy)

Options (each also settable via the env var shown, or in a --config file):
  --proxy HOST[:PORT]   Teleport proxy; empty means a direct     TPW_PROXY
                        (non-Teleport) cluster for ssh/scp
  --cluster NAME        root or leaf cluster to route through    TPW_CLUSTER
  --user NAME           Teleport user                            TPW_USER
  --auth CONNECTOR      auth connector (e.g. an SSO connector)   TPW_AUTH
  --min-ttl SECS        a session with less time left than this  TPW_MIN_TTL (default: 300)
                        counts as expired
  --login-timeout SECS  max wait for `tsh login` (SSO callback)  TPW_LOGIN_TIMEOUT (default: 180)
  --no-login            ssh/scp: fail instead of logging in
  --force               login: renew even if the session is still valid
  --non-interactive     never prompt; print the SSO link instead TPW_NON_INTERACTIVE=1
                        of opening a browser
  --config FILE         bash file of TPW_*=... assignments       TPW_CONFIG

Exit codes: 0 ok, 2 usage, 3 missing dependency, 4 no usable session,
            5 login failed, 6 proxy unreachable
EOF
}

status() { printf 'STATUS %s %s\n' "$1" "$2"; }
log() { printf '[teleport] %s\n' "$*" >&2; }
die() {
  local code=$1
  shift
  log "error: $*"
  status error "$*"
  exit "$code"
}

is_interactive() { [[ "$NON_INTERACTIVE" != 1 && -t 0 && -t 2 ]]; }

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

parse_args() {
  local o_proxy="" o_cluster="" o_user="" o_auth="" o_ttl="" o_timeout=""
  local o_config="" o_nonint=""
  NO_LOGIN=0
  FORCE=0
  PASSTHROUGH=()

  while (($#)); do
    case "$1" in
      --proxy) o_proxy=${2:?--proxy needs a value}; shift ;;
      --cluster) o_cluster=${2:?--cluster needs a value}; shift ;;
      --user) o_user=${2:?--user needs a value}; shift ;;
      --auth) o_auth=${2:?--auth needs a value}; shift ;;
      --min-ttl) o_ttl=${2:?--min-ttl needs a value}; shift ;;
      --login-timeout) o_timeout=${2:?--login-timeout needs a value}; shift ;;
      --config) o_config=${2:?--config needs a value}; shift ;;
      --no-login) NO_LOGIN=1 ;;
      --force) FORCE=1 ;;
      --non-interactive) o_nonint=1 ;;
      --) shift; PASSTHROUGH=("$@"); break ;;
      -h | --help) usage; exit 0 ;;
      *) usage; die "$EXIT_USAGE" "Unknown option: $1" ;;
    esac
    shift
  done

  # Precedence: command-line flag > config file > environment > default.
  local config=${o_config:-${TPW_CONFIG:-}}
  if [[ -n "$config" ]]; then
    [[ -r "$config" ]] || die "$EXIT_USAGE" "Config file not readable: $config"
    # shellcheck source=/dev/null
    source "$config"
  fi

  PROXY=${o_proxy:-${TPW_PROXY:-}}
  CLUSTER=${o_cluster:-${TPW_CLUSTER:-}}
  TP_USER=${o_user:-${TPW_USER:-}}
  AUTH=${o_auth:-${TPW_AUTH:-}}
  MIN_TTL=${o_ttl:-${TPW_MIN_TTL:-300}}
  LOGIN_TIMEOUT=${o_timeout:-${TPW_LOGIN_TIMEOUT:-180}}
  NON_INTERACTIVE=${o_nonint:-${TPW_NON_INTERACTIVE:-0}}

  [[ "$MIN_TTL" =~ ^[0-9]+$ ]] || die "$EXIT_USAGE" "--min-ttl must be whole seconds"
  [[ "$LOGIN_TIMEOUT" =~ ^[0-9]+$ ]] || die "$EXIT_USAGE" "--login-timeout must be whole seconds"
}

require_proxy() {
  [[ -n "$PROXY" ]] || die "$EXIT_USAGE" "--proxy is required (the Teleport proxy address, e.g. teleport.example.com:443)"
}

require_tsh() {
  command -v tsh >/dev/null 2>&1 ||
    die "$EXIT_DEPS" "Teleport client ('tsh') not found on PATH - install it from https://goteleport.com/download/"
  command -v python3 >/dev/null 2>&1 || die "$EXIT_DEPS" "python3 not found on PATH (needed to read 'tsh status')"
}

# Global tsh flags for every call, so each one targets this cluster's proxy
# profile explicitly instead of whatever profile happens to be active - two
# clusters behind different proxies can be used side by side without
# `tsh login` flipping the active profile underneath the other.
tsh_scope() {
  TSH_SCOPE=(--proxy="$PROXY")
  if [[ -n "$TP_USER" ]]; then TSH_SCOPE+=(--user="$TP_USER"); fi
}

# ---------------------------------------------------------------------------
# Session check
# ---------------------------------------------------------------------------

# Prints "<state> <seconds-left> <user> <cluster>" for the profile matching
# PROXY (and TP_USER, if set), where state is valid | expired | none.
# `tsh status` only reads ~/.tsh, so this is cheap and works offline; whether
# the proxy still honors the certificate is only known once it's used.
read -r -d '' READ_SESSION_PY <<'PY' || true
import json, re, sys
from datetime import datetime, timezone

wanted_proxy, wanted_user = sys.argv[1], sys.argv[2]

def host(addr):
    addr = re.sub(r"^[a-z]+://", "", addr or "")
    return addr.split("/")[0].rsplit(":", 1)[0].lower()

def parse_time(value):
    # tsh writes RFC 3339 with up to nanosecond precision; fromisoformat
    # (before 3.11) takes neither 'Z' nor more than 6 fractional digits.
    value = re.sub(r"(\.\d{6})\d+", r"\1", value.replace("Z", "+00:00"))
    return datetime.fromisoformat(value)

try:
    data = json.load(sys.stdin)
except ValueError:
    print("none 0 - -")
    sys.exit()
profiles = [data.get("active")] + (data.get("profiles") or [])
for p in profiles:
    if not p or host(p.get("profile_url")) != host(wanted_proxy):
        continue
    if wanted_user and p.get("username") != wanted_user:
        continue
    try:
        left = int((parse_time(p["valid_until"]) - datetime.now(timezone.utc)).total_seconds())
    except (KeyError, ValueError):
        left = 0
    state = "valid" if left > 0 else "expired"
    print(state, max(left, 0), p.get("username") or "-", p.get("cluster") or "-")
    sys.exit()
print("none 0 - -")
PY

read_session() {
  local json
  # tsh exits non-zero with "Not logged in" when there are no profiles at all.
  json=$(tsh status --format=json 2>/dev/null) || {
    echo "none 0 - -"
    return
  }
  printf '%s' "$json" | python3 -c "$READ_SESSION_PY" "$PROXY" "$TP_USER"
}

# Succeeds when there's a session for PROXY with at least MIN_TTL left. A
# session about to expire counts as expired: starting a long terminal session
# or copy on it would just fail partway through (Teleport can cut sessions at
# certificate expiry when the cluster sets disconnect_expired_cert).
check_session() {
  status check "Checking Teleport session for $PROXY"
  local state left user cluster
  read -r state left user cluster < <(read_session)
  case "$state" in
    valid)
      if ((left >= MIN_TTL)); then
        status valid "Logged in to $PROXY as $user (cluster $cluster, $(fmt_duration "$left") left)"
        return 0
      fi
      status expired "Teleport session for $PROXY expires in $(fmt_duration "$left"), under the ${MIN_TTL}s minimum (--min-ttl)"
      ;;
    expired) status expired "Teleport session for $PROXY has expired" ;;
    *) status expired "Not logged in to $PROXY" ;;
  esac
  return 1
}

fmt_duration() {
  local s=$1
  if ((s >= 3600)); then
    printf '%dh%02dm' $((s / 3600)) $((s % 3600 / 60))
  else
    printf '%dm' $((s / 60))
  fi
}

# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

# Maps tsh's error text to an exit code. Network failures get their own code
# so a caller can back off and retry instead of asking the user to log in
# again, which wouldn't help.
classify_login_failure() {
  local output=$1
  if grep -qiE 'connection refused|no such host|i/o timeout|network is unreachable|no route to host|context deadline exceeded|dial tcp|connection reset|tls handshake timeout' <<<"$output"; then
    die "$EXIT_NETWORK" "Teleport proxy $PROXY is unreachable (VPN down or blocked by a firewall?)"
  fi
  if grep -qiE 'inappropriate ioctl|not a terminal|/dev/tty' <<<"$output"; then
    die "$EXIT_LOGIN" "This auth method needs a terminal prompt (password/OTP) - run 'tsh login --proxy=$PROXY' in a terminal, or configure an SSO connector with --auth"
  fi
  local reason
  reason=$(grep -iE 'error|denied|failed|invalid' <<<"$output" | tail -n 1 || true)
  die "$EXIT_LOGIN" "tsh login failed${reason:+: $reason}"
}

do_login() {
  local args=(login "${TSH_SCOPE[@]}")
  if [[ -n "$AUTH" ]]; then args+=(--auth="$AUTH"); fi
  # A detached caller can't have tsh launch a browser for it; with
  # --browser=none tsh prints the SSO link on stderr, which the caller shows.
  if ! is_interactive; then args+=(--browser=none); fi
  if [[ -n "$CLUSTER" ]]; then args+=("$CLUSTER"); fi

  local runner=() stdin=/dev/null
  if command -v timeout >/dev/null 2>&1; then runner=(timeout "$LOGIN_TIMEOUT"); fi
  if is_interactive; then
    stdin=/dev/stdin
    # Without --foreground, timeout moves tsh into its own process group, off
    # the terminal's foreground group: tsh is then stopped (SIGTTIN) the moment
    # it reads the OTP prompt, and Ctrl-C never reaches it.
    if ((${#runner[@]})); then runner=(timeout --foreground "$LOGIN_TIMEOUT"); fi
  fi

  status login "Logging in to $PROXY"
  local errlog rc=0
  errlog=$(mktemp)
  # All of tsh's output goes to stderr, so it can't be mistaken for a STATUS
  # line, and is also kept to classify a failure by.
  # A pipeline rather than a process substitution, so the shell waits for tee to finish writing
  # the log before it's read below.
  set +e
  "${runner[@]}" tsh "${args[@]}" <"$stdin" 2>&1 | tee "$errlog" >&2
  rc=${PIPESTATUS[0]}
  set -e
  if ((rc == 124)); then
    local output
    output=$(cat "$errlog")
    rm -f "$errlog"
    # A proxy behind a firewall that drops packets never answers tsh's first
    # request (webapi/ping), so tsh hangs until the timeout rather than
    # failing fast like it does on a refused connection.
    if grep -q 'webapi/ping' <<<"$output"; then
      die "$EXIT_NETWORK" "Teleport proxy $PROXY did not respond within ${LOGIN_TIMEOUT}s (VPN down or blocked by a firewall?)"
    fi
    die "$EXIT_LOGIN" "Login to $PROXY was not completed within ${LOGIN_TIMEOUT}s"
  fi
  if ((rc != 0)); then
    local reason
    reason=$(cat "$errlog")
    rm -f "$errlog"
    classify_login_failure "$reason"
  fi
  rm -f "$errlog"

  check_session ||
    die "$EXIT_LOGIN" "tsh login succeeded but no usable session for $PROXY was found afterwards"
}

ensure_session() {
  check_session && return 0
  if ((NO_LOGIN)); then die "$EXIT_NO_SESSION" "No usable Teleport session for $PROXY (run 'teleport.sh login --proxy $PROXY')"; fi
  do_login
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_status() {
  require_proxy
  require_tsh
  tsh_scope
  check_session || exit "$EXIT_NO_SESSION"
}

cmd_login() {
  require_proxy
  require_tsh
  tsh_scope
  if ((FORCE)); then
    # tsh login returns straight away while a session is still valid, so renewing early means
    # dropping this proxy's certificate first. Other proxies' profiles are left alone.
    status login "Signing out of $PROXY to renew the session"
    tsh logout "${TSH_SCOPE[@]}" >&2 2>&1 || true
    do_login
    return
  fi
  ensure_session
}

# ssh and scp: a cluster with no proxy is reached directly, so callers can use
# this one entry point for every cluster.
passthrough() {
  local tool=$1
  if [[ -z "$PROXY" ]]; then
    command -v "$tool" >/dev/null 2>&1 || die "$EXIT_DEPS" "'$tool' not found on PATH"
    exec "$tool" "${PASSTHROUGH[@]}"
  fi
  require_tsh
  tsh_scope
  # Pre-flight chatter goes to stderr so the command's own stdout stays clean
  # (e.g. `teleport.sh ssh ... -- node cat file > copy`).
  ensure_session >&2
  local args=("${TSH_SCOPE[@]}" "$tool")
  if [[ -n "$CLUSTER" ]]; then args+=(--cluster="$CLUSTER"); fi
  exec tsh "${args[@]}" "${PASSTHROUGH[@]}"
}

cmd_ssh() { passthrough ssh; }
cmd_scp() { passthrough scp; }

main() {
  local cmd=${1:-help}
  (($#)) && shift
  case "$cmd" in
    status | login | ssh | scp) parse_args "$@" ;;
    help | -h | --help) usage; exit 0 ;;
    *) usage; die "$EXIT_USAGE" "Unknown command: $cmd" ;;
  esac
  "cmd_$cmd"
}

main "$@"

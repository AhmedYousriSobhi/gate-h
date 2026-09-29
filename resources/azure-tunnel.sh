#!/usr/bin/env bash
# azure-tunnel.sh - authenticate to Azure, pick a subscription, and open a
# port-forwarding tunnel to a cluster that is only reachable through Azure.
#
# Meant to be driven either by a person in a terminal or by Gate-H's main
# process, so its output is split in two:
#   stdout - one machine-parseable line per state change:
#              STATUS <phase> <free-text message>
#            phases: auth, subscription, tunnel, active, degraded, down, error
#   stderr - human-oriented diagnostics, az's own prompts (e.g. device-code
#            login instructions), and the subscription menu.
# Exit codes are stable (EXIT_* below) so a caller can branch on them without
# scraping text.
#
# Run `azure-tunnel.sh help` for usage.

set -euo pipefail

readonly EXIT_USAGE=2
readonly EXIT_DEPS=3
readonly EXIT_AUTH=4
readonly EXIT_SUBSCRIPTION=5
readonly EXIT_PORT_IN_USE=6
readonly EXIT_TUNNEL=7
readonly EXIT_NOT_RUNNING=8

# az >= 2.61 shows its own interactive subscription picker after `az login`;
# this script does the selection itself (so it also works non-interactively).
export AZURE_CORE_LOGIN_EXPERIENCE_V2=off
# Lets `az ssh` / `az network bastion` install their CLI extension on first use
# instead of stopping at a y/N prompt nobody can answer when run detached.
export AZURE_EXTENSION_USE_DYNAMIC_INSTALL=yes_without_prompt

usage() {
  cat >&2 <<'EOF'
Usage:
  azure-tunnel.sh up     [options]   authenticate, select subscription, open tunnel
  azure-tunnel.sh down   [--name N]  tear down a tunnel started by `up`
  azure-tunnel.sh status [--name N]  report whether a tunnel is alive and listening
  azure-tunnel.sh subscriptions      list enabled subscriptions (id<TAB>name<TAB>isDefault)

Options (each also settable via the env var shown, or in a --config file):
  --name N              tunnel identifier for PID/log files      AZT_NAME (default: default)
  --mode M              bastion | az-ssh                         AZT_MODE
  -g, --resource-group  resource group of the bastion/VM         AZT_RESOURCE_GROUP
  -s, --subscription    subscription id or name                  AZT_SUBSCRIPTION
      --tenant          tenant id for `az login`                 AZT_TENANT
  -l, --local-port      local port to listen on (127.0.0.1)      AZT_LOCAL_PORT
  -r, --remote-port     port on the target                       AZT_REMOTE_PORT (default: 22)
  mode=bastion (az network bastion tunnel; needs Standard SKU + native client support):
      --bastion         bastion host name                        AZT_BASTION
      --target-id       full resource id of the target VM        AZT_TARGET_ID
                        (or use --vm; resolved via `az vm show`)
  mode=az-ssh (az ssh vm with Entra ID auth, then ssh -L):
      --vm              VM name                                  AZT_VM
                        (required for az-ssh; alternative to --target-id for bastion)
      --remote-host     host to forward to, as seen from the VM  AZT_REMOTE_HOST (default: localhost)
      --local-user      local VM account instead of Entra ID     AZT_LOCAL_USER
  --timeout SECS        max wait for the tunnel to listen        AZT_TIMEOUT (default: 60)
  --foreground          stay attached; Ctrl-C/SIGTERM tears the tunnel down
  --non-interactive     never prompt (device-code login, no subscription menu)
                                                                 AZT_NON_INTERACTIVE=1
  --config FILE         bash file of AZT_*=... assignments       AZT_CONFIG

Exit codes: 0 ok, 2 usage, 3 missing dependency, 4 auth, 5 subscription,
            6 local port in use, 7 tunnel failed/degraded, 8 not running
EOF
}

status() { printf 'STATUS %s %s\n' "$1" "$2"; }
log() { printf '[azure-tunnel] %s\n' "$*" >&2; }
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
  local o_name="" o_mode="" o_rg="" o_sub="" o_tenant="" o_lport="" o_rport=""
  local o_bastion="" o_target="" o_vm="" o_rhost="" o_luser="" o_timeout=""
  local o_config="" o_nonint=""
  FOREGROUND=0

  while (($#)); do
    case "$1" in
      --name) o_name=${2:?--name needs a value}; shift ;;
      --mode) o_mode=${2:?--mode needs a value}; shift ;;
      -g | --resource-group) o_rg=${2:?$1 needs a value}; shift ;;
      -s | --subscription) o_sub=${2:?$1 needs a value}; shift ;;
      --tenant) o_tenant=${2:?--tenant needs a value}; shift ;;
      -l | --local-port) o_lport=${2:?$1 needs a value}; shift ;;
      -r | --remote-port) o_rport=${2:?$1 needs a value}; shift ;;
      --bastion) o_bastion=${2:?--bastion needs a value}; shift ;;
      --target-id) o_target=${2:?--target-id needs a value}; shift ;;
      --vm) o_vm=${2:?--vm needs a value}; shift ;;
      --remote-host) o_rhost=${2:?--remote-host needs a value}; shift ;;
      --local-user) o_luser=${2:?--local-user needs a value}; shift ;;
      --timeout) o_timeout=${2:?--timeout needs a value}; shift ;;
      --config) o_config=${2:?--config needs a value}; shift ;;
      --foreground) FOREGROUND=1 ;;
      --non-interactive) o_nonint=1 ;;
      -h | --help) usage; exit 0 ;;
      *) usage; die "$EXIT_USAGE" "Unknown option: $1" ;;
    esac
    shift
  done

  # Precedence: command-line flag > config file > environment > default.
  local config=${o_config:-${AZT_CONFIG:-}}
  if [[ -n "$config" ]]; then
    [[ -r "$config" ]] || die "$EXIT_USAGE" "Config file not readable: $config"
    # shellcheck source=/dev/null
    source "$config"
  fi

  NAME=${o_name:-${AZT_NAME:-default}}
  MODE=${o_mode:-${AZT_MODE:-}}
  RESOURCE_GROUP=${o_rg:-${AZT_RESOURCE_GROUP:-}}
  SUBSCRIPTION=${o_sub:-${AZT_SUBSCRIPTION:-}}
  TENANT=${o_tenant:-${AZT_TENANT:-}}
  LOCAL_PORT=${o_lport:-${AZT_LOCAL_PORT:-}}
  REMOTE_PORT=${o_rport:-${AZT_REMOTE_PORT:-22}}
  BASTION_NAME=${o_bastion:-${AZT_BASTION:-}}
  TARGET_ID=${o_target:-${AZT_TARGET_ID:-}}
  VM_NAME=${o_vm:-${AZT_VM:-}}
  REMOTE_HOST=${o_rhost:-${AZT_REMOTE_HOST:-localhost}}
  LOCAL_USER=${o_luser:-${AZT_LOCAL_USER:-}}
  TIMEOUT=${o_timeout:-${AZT_TIMEOUT:-60}}
  NON_INTERACTIVE=${o_nonint:-${AZT_NON_INTERACTIVE:-0}}

  # NAME becomes part of a file path - keep it from escaping the state dir.
  [[ "$NAME" =~ ^[A-Za-z0-9._-]+$ && "$NAME" != .* ]] ||
    die "$EXIT_USAGE" "--name may only contain letters, digits, '.', '_' and '-'"

  STATE_DIR="${AZT_STATE_DIR:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/gate-h-azure-tunnel}"
  STATE_FILE="$STATE_DIR/$NAME.state"
  LOG_FILE="$STATE_DIR/$NAME.log"
}

require() {
  local var=$1 flag=$2
  [[ -n "${!var}" ]] || die "$EXIT_USAGE" "$flag is required for mode '$MODE'"
}

validate_port() {
  local value=$1 flag=$2
  [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1 && value <= 65535)) ||
    die "$EXIT_USAGE" "$flag must be a port number (1-65535), got '$value'"
}

validate_up_args() {
  [[ -n "$LOCAL_PORT" ]] || die "$EXIT_USAGE" "--local-port is required"
  validate_port "$LOCAL_PORT" --local-port
  validate_port "$REMOTE_PORT" --remote-port
  [[ "$TIMEOUT" =~ ^[0-9]+$ ]] || die "$EXIT_USAGE" "--timeout must be whole seconds"
  case "$MODE" in
    bastion)
      require RESOURCE_GROUP --resource-group
      require BASTION_NAME --bastion
      if [[ -z "$TARGET_ID" && -z "$VM_NAME" ]]; then
        die "$EXIT_USAGE" "--target-id or --vm is required for mode 'bastion'"
      fi
      ;;
    az-ssh)
      require RESOURCE_GROUP --resource-group
      require VM_NAME --vm
      ;;
    "") die "$EXIT_USAGE" "--mode is required (bastion | az-ssh)" ;;
    *) die "$EXIT_USAGE" "Unknown --mode '$MODE' (expected bastion | az-ssh)" ;;
  esac
}

# ---------------------------------------------------------------------------
# Azure session + subscription
# ---------------------------------------------------------------------------

ensure_login() {
  status auth "Checking Azure CLI session"
  # `az account show` only reads the local cache and succeeds even when the
  # refresh token has expired; minting a token proves the session is usable.
  if az account get-access-token --only-show-errors --output none >/dev/null 2>&1; then
    status auth "Azure CLI session is valid"
    return
  fi

  status auth "No valid Azure session - logging in"
  local args=(--only-show-errors --output none)
  if [[ -n "$TENANT" ]]; then args+=(--tenant "$TENANT"); fi
  # A detached caller has no browser to hand off to, and neither does a
  # headless Linux box; device-code login prints a URL + code on stderr that
  # the caller can show to the user instead.
  if ! is_interactive || [[ "$(uname -s)" == Linux && -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    args+=(--use-device-code)
  fi
  az login "${args[@]}" >&2 || die "$EXIT_AUTH" "az login failed"
  status auth "Logged in to Azure"
}

list_subscriptions() {
  az account list --only-show-errors --output tsv \
    --query "[?state=='Enabled'].[id, name, isDefault]"
}

# Prints the menu on stderr and the chosen subscription id on stdout.
prompt_subscription() {
  local i=1 line id name is_default default_idx="" choice
  log "Available subscriptions:"
  for line in "$@"; do
    IFS=$'\t' read -r id name is_default <<<"$line"
    local mark=""
    if [[ "$is_default" == true ]]; then
      mark="  [current]"
      default_idx=$i
    fi
    printf '  %2d) %s  (%s)%s\n' "$i" "$name" "$id" "$mark" >&2
    i=$((i + 1))
  done

  while :; do
    read -r -p "Select subscription [${default_idx:-1-$#}]: " choice </dev/tty >&2 || exit "$EXIT_SUBSCRIPTION"
    choice=${choice:-$default_idx}
    if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= $#)); then
      line=${!choice}
      printf '%s\n' "${line%%$'\t'*}"
      return
    fi
    log "Enter a number between 1 and $#."
  done
}

# Bastion needs a full ARM resource id; a bare VM name (as a person would type it, or as a
# manual bastion-tunnel script resolves with the same `az vm show` call) is looked up once here so
# the form field can take either.
resolve_target_id() {
  [[ "$MODE" == bastion && -z "$TARGET_ID" ]] || return 0
  status tunnel "Resolving VM '$VM_NAME' to its resource ID"
  TARGET_ID=$(az vm show --only-show-errors --subscription "$SUBSCRIPTION" \
    -g "$RESOURCE_GROUP" -n "$VM_NAME" --query id --output tsv) ||
    die "$EXIT_TUNNEL" "Could not resolve VM '$VM_NAME' in resource group '$RESOURCE_GROUP' to a resource ID"
  [[ -n "$TARGET_ID" ]] ||
    die "$EXIT_TUNNEL" "VM '$VM_NAME' not found in resource group '$RESOURCE_GROUP'"
}

select_subscription() {
  status subscription "Selecting subscription"
  local wanted=$SUBSCRIPTION

  if [[ -z "$wanted" ]]; then
    local raw line subs=()
    raw=$(list_subscriptions) || die "$EXIT_SUBSCRIPTION" "Could not list subscriptions"
    while IFS= read -r line; do
      if [[ -n "$line" ]]; then subs+=("$line"); fi
    done <<<"$raw"

    case ${#subs[@]} in
      0) die "$EXIT_SUBSCRIPTION" "No enabled subscriptions for this account" ;;
      1) wanted=${subs[0]%%$'\t'*} ;;
      *)
        # Silently taking the CLI's current default could open a tunnel in the
        # wrong tenant/subscription, so a non-interactive caller must choose.
        is_interactive ||
          die "$EXIT_SUBSCRIPTION" "Multiple subscriptions available; pass --subscription (see 'azure-tunnel.sh subscriptions')"
        wanted=$(prompt_subscription "${subs[@]}") || die "$EXIT_SUBSCRIPTION" "No subscription selected"
        ;;
    esac
  fi

  # Scoped via --subscription on each later az call instead of `az account set`, which would
  # mutate the CLI's shared, machine-wide default subscription - surprising for anything else
  # using `az` (another terminal, another cluster's tunnel opening at the same time) and racy if
  # two tunnels for different subscriptions start concurrently.
  local name
  name=$(az account show --only-show-errors --subscription "$wanted" --query name --output tsv) ||
    die "$EXIT_SUBSCRIPTION" "Could not use subscription '$wanted'"
  SUBSCRIPTION=$wanted
  status subscription "Using subscription '$name'"
}

# ---------------------------------------------------------------------------
# Tunnel process tracking
# ---------------------------------------------------------------------------

# Checks for a LISTEN socket rather than connecting: a probe connection
# through a Bastion tunnel opens a real Bastion session, and the tunnel only
# handles one connection at a time reliably (azure-cli#24600).
port_listening() {
  local port=$1
  if command -v ss >/dev/null 2>&1; then
    [[ -n "$(ss -Hltn "sport = :$port" 2>/dev/null)" ]]
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null
  fi
}

# Reads the state file into TUNNEL_PID/TUNNEL_PORT/TUNNEL_MODE and succeeds
# only if that process is still ours and alive.
load_tunnel() {
  TUNNEL_PID="" TUNNEL_PORT="" TUNNEL_MODE=""
  [[ -f "$STATE_FILE" ]] || return 1
  read -r TUNNEL_PID TUNNEL_PORT TUNNEL_MODE <"$STATE_FILE" || return 1
  [[ "$TUNNEL_PID" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$TUNNEL_PID" 2>/dev/null || return 1
  # Guards against PID reuse after a crash/reboot left a stale state file: the
  # tunnel is always started as the leader of its own process group, which a
  # recycled PID almost never is.
  [[ "$(ps -o pgid= -p "$TUNNEL_PID" 2>/dev/null | tr -d ' ')" == "$TUNNEL_PID" ]]
}

# Signals the whole process group: `az ssh vm` runs ssh as a child, and
# killing only the az (python) parent would orphan the ssh holding the port.
kill_tunnel_group() {
  local pid=$1 i
  kill -TERM -- "-$pid" 2>/dev/null || return 0
  for ((i = 0; i < 20; i++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.25
  done
  log "Tunnel did not exit on SIGTERM; sending SIGKILL"
  kill -KILL -- "-$pid" 2>/dev/null || true
}

stop_tunnel() {
  if load_tunnel; then
    status tunnel "Stopping tunnel '$NAME' (pid $TUNNEL_PID)"
    kill_tunnel_group "$TUNNEL_PID"
  fi
  rm -f "$STATE_FILE"
}

build_tunnel_cmd() {
  case "$MODE" in
    bastion)
      TUNNEL_CMD=(az network bastion tunnel --only-show-errors --subscription "$SUBSCRIPTION"
        --name "$BASTION_NAME" --resource-group "$RESOURCE_GROUP"
        --target-resource-id "$TARGET_ID"
        --resource-port "$REMOTE_PORT" --port "$LOCAL_PORT")
      TUNNEL_DESC="127.0.0.1:$LOCAL_PORT -> ${TARGET_ID##*/}:$REMOTE_PORT via bastion $BASTION_NAME"
      ;;
    az-ssh)
      TUNNEL_CMD=(az ssh vm --only-show-errors --subscription "$SUBSCRIPTION"
        --resource-group "$RESOURCE_GROUP" --name "$VM_NAME")
      if [[ -n "$LOCAL_USER" ]]; then TUNNEL_CMD+=(--local-user "$LOCAL_USER"); fi
      # ExitOnForwardFailure makes ssh die (instead of idling uselessly) if the
      # local bind fails; ServerAlive* makes a silently dropped link exit so
      # `status` reports it rather than a zombie "active" tunnel.
      TUNNEL_CMD+=(-- -N
        -L "127.0.0.1:$LOCAL_PORT:$REMOTE_HOST:$REMOTE_PORT"
        -o ExitOnForwardFailure=yes
        -o ServerAliveInterval=30 -o ServerAliveCountMax=3
        -o BatchMode=yes)
      TUNNEL_DESC="127.0.0.1:$LOCAL_PORT -> $REMOTE_HOST:$REMOTE_PORT via VM $VM_NAME"
      ;;
  esac
}

# Starts the tunnel detached in its own process group and waits until the
# local port is listening (or the process dies / TIMEOUT elapses).
start_tunnel() {
  (umask 077 && mkdir -p "$STATE_DIR")
  : >"$LOG_FILE"

  status tunnel "Starting tunnel $TUNNEL_DESC"
  # Job control gives the background job its own process group (pgid == pid),
  # so `down` can signal az and its ssh child together.
  set -m
  nohup "${TUNNEL_CMD[@]}" >>"$LOG_FILE" 2>&1 </dev/null &
  local pid=$!
  set +m
  printf '%s %s %s\n' "$pid" "$LOCAL_PORT" "$MODE" >"$STATE_FILE"

  local deadline=$((SECONDS + TIMEOUT))
  while ((SECONDS < deadline)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$STATE_FILE"
      log "Tunnel process exited during startup. Last log lines ($LOG_FILE):"
      tail -n 20 "$LOG_FILE" >&2 || true
      die "$EXIT_TUNNEL" "Tunnel process exited before it started listening"
    fi
    if port_listening "$LOCAL_PORT"; then
      status active "Tunnel active on port $LOCAL_PORT (pid $pid)"
      return
    fi
    sleep 0.5
  done

  kill_tunnel_group "$pid"
  rm -f "$STATE_FILE"
  die "$EXIT_TUNNEL" "Tunnel did not start listening on port $LOCAL_PORT within ${TIMEOUT}s (log: $LOG_FILE)"
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_up() {
  validate_up_args
  command -v az >/dev/null 2>&1 || die "$EXIT_DEPS" "Azure CLI ('az') not found on PATH"

  if load_tunnel; then
    # Idempotent: a caller can safely run `up` as a pre-flight on every connect.
    if port_listening "$TUNNEL_PORT"; then
      status active "Tunnel active on port $TUNNEL_PORT (pid $TUNNEL_PID)"
      if ((FOREGROUND == 0)); then return; fi
    fi
    stop_tunnel
  fi
  if port_listening "$LOCAL_PORT"; then
    die "$EXIT_PORT_IN_USE" "Local port $LOCAL_PORT is already in use by another process"
  fi

  ensure_login
  select_subscription
  resolve_target_id
  build_tunnel_cmd
  start_tunnel

  if ((FOREGROUND == 1)); then
    trap 'stop_tunnel; status down "Tunnel stopped"; exit 0' INT TERM HUP
    load_tunnel
    # `wait` can't wait on a PID from a previous run of the script, so poll.
    while kill -0 "$TUNNEL_PID" 2>/dev/null; do sleep 1; done
    rm -f "$STATE_FILE"
    tail -n 20 "$LOG_FILE" >&2 || true
    status down "Tunnel exited unexpectedly"
    exit "$EXIT_TUNNEL"
  fi
}

cmd_down() {
  if load_tunnel; then
    stop_tunnel
    status down "Tunnel stopped"
  else
    rm -f "$STATE_FILE"
    status down "Tunnel '$NAME' is not running"
  fi
}

cmd_status() {
  if ! load_tunnel; then
    status down "Tunnel '$NAME' is not running"
    exit "$EXIT_NOT_RUNNING"
  fi
  if port_listening "$TUNNEL_PORT"; then
    status active "Tunnel active on port $TUNNEL_PORT (pid $TUNNEL_PID, mode $TUNNEL_MODE)"
  else
    status degraded "Tunnel process $TUNNEL_PID is alive but port $TUNNEL_PORT is not listening"
    exit "$EXIT_TUNNEL"
  fi
}

cmd_subscriptions() {
  command -v az >/dev/null 2>&1 || die "$EXIT_DEPS" "Azure CLI ('az') not found on PATH"
  ensure_login >&2
  list_subscriptions || die "$EXIT_SUBSCRIPTION" "Could not list subscriptions"
}

main() {
  local cmd=${1:-help}
  (($#)) && shift
  case "$cmd" in
    up | down | status | subscriptions) parse_args "$@" ;;
    help | -h | --help) usage; exit 0 ;;
    *) usage; die "$EXIT_USAGE" "Unknown command: $cmd" ;;
  esac
  "cmd_$cmd"
}

main "$@"

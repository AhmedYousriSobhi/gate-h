#!/usr/bin/env bash
# Smoke test for resources/azure-tunnel.sh against a fake `az` - no Azure account, network, or
# real tunnel needed. Covers the lifecycle Gate-H relies on: login/subscription pre-flight, `up`
# (and its idempotency), `status` for a healthy, dropped, and hung tunnel, and `down` killing the
# tunnel's whole process group.
#
#   ./scripts/test-azure-tunnel.sh        (needs bash, python3, and ss or lsof)

set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/resources/azure-tunnel.sh"
WORK=$(mktemp -d)
trap 'AZT_STATE_DIR="$WORK/state" bash "$SCRIPT" down --name t >/dev/null 2>&1; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# The fake az: account commands answer from files in $WORK; the tunnel commands start a python
# listener standing in for the real forwarder, as a child process like `az ssh vm`'s ssh.
cat >"$WORK/bin/az" <<'EOF'
#!/usr/bin/env bash
listen() { # port, seconds to keep the socket open, seconds to linger after closing it
  python3 -c "import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', int(sys.argv[1]))); s.listen(); time.sleep(float(sys.argv[2]))
s.close(); time.sleep(float(sys.argv[3]))" "$@"
}
port_arg() { printf '%s\n' "$@" | grep -oE '^127\.0\.0\.1:[0-9]+' | cut -d: -f2; }
case "$1 $2" in
  "account get-access-token") [[ -f "$MOCK/logged-in" ]] ;;
  "account list") cat "$MOCK/subscriptions" ;;
  "account set") echo "${@: -1}" >"$MOCK/selected" ;;
  "account show") cat "$MOCK/selected" ;;
  "login "*) touch "$MOCK/logged-in" ;;
  "ssh vm") listen "$(port_arg "$@")" 600 0 & wait ;;
  "network bastion")
    port=$(printf '%s\n' "$@" | grep -A1 -- '--port' | tail -1)
    case "${MOCK_BASTION:-ok}" in
      ok) listen "$port" 600 0 ;;
      fail) echo "ERROR: Bastion Host SKU must be Standard or Premium" >&2; exit 1 ;;
      hang) listen "$port" 3 600 ;; # listener goes away, process stays: azure-cli#28367
    esac ;;
esac
EOF
chmod +x "$WORK/bin/az"

export PATH="$WORK/bin:$PATH" MOCK="$WORK" AZT_STATE_DIR="$WORK/state"
printf 'sub-a\tProd HPC\tfalse\nsub-b\tDev HPC\ttrue\n' >"$WORK/subscriptions"

failures=0
# expect <exit code> <description> <command...>: runs the script, checks its exit code.
expect() {
  local want=$1 desc=$2
  shift 2
  bash "$SCRIPT" "$@" >"$WORK/out" 2>&1 </dev/null
  local got=$?
  if [[ $got == "$want" ]]; then
    printf 'ok    %s\n' "$desc"
  else
    printf 'FAIL  %s (exit %s, want %s)\n' "$desc" "$got" "$want"
    sed 's/^/        /' "$WORK/out"
    failures=$((failures + 1))
  fi
}
check() { # check <description> <shell test...>
  local desc=$1
  shift
  if "$@"; then printf 'ok    %s\n' "$desc"; else printf 'FAIL  %s\n' "$desc"; failures=$((failures + 1)); fi
}
listening() { [[ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]] || lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

PORT=$((20000 + RANDOM % 20000))
AZSSH=(--name t --mode az-ssh -g rg --vm jump -l "$PORT" --non-interactive)
BASTION=(--name t --mode bastion -g rg --bastion b --target-id /x/vm -l "$PORT" -s sub-a --non-interactive)

echo "-- argument validation"
expect 2 "unknown mode is a usage error" up --mode nope -l "$PORT"
expect 2 "missing --vm is a usage error" up --mode az-ssh -g rg -l "$PORT"
expect 2 "--name can't escape the state dir" up --name ../x "${AZSSH[@]:2}"

echo "-- pre-flight"
expect 5 "several subscriptions + non-interactive refuses to guess" up "${AZSSH[@]}"
check "logged in via az login when there was no session" test -f "$WORK/logged-in"
expect 0 "up with --subscription" up "${AZSSH[@]}" -s sub-a
check "selected the requested subscription" grep -qx sub-a "$WORK/selected"
check "tunnel is listening" listening "$PORT"

echo "-- lifecycle"
expect 0 "up again reuses the running tunnel" up "${AZSSH[@]}" -s sub-a
check "...without starting a second one" grep -q "already\|active" "$WORK/out"
expect 6 "another tunnel on the same port is refused" up --name other "${AZSSH[@]:2}" -s sub-a
expect 0 "status reports active" status --name t
pid=$(cut -d' ' -f1 "$AZT_STATE_DIR/t.state")
expect 0 "down" down --name t
sleep 0.5
# ss on Linux, lsof on macOS (which has no ss).
check "down killed the forwarder child too (port released)" bash -c "! { (ss -Hltn 'sport = :$PORT' 2>/dev/null || lsof -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null) | grep -q .; }"
check "down killed the tunnel process group" bash -c "! kill -0 $pid 2>/dev/null"
expect 8 "status after down reports not running" status --name t

echo "-- failure modes"
MOCK_BASTION=fail expect 7 "tunnel process dying at startup fails up" up "${BASTION[@]}"
check "...and shows the tunnel's own error" grep -q "SKU must be Standard" "$WORK/out"
MOCK_BASTION=hang expect 0 "bastion tunnel comes up" up "${BASTION[@]}"
sleep 4
expect 7 "hung tunnel (process alive, port gone) reports degraded" status --name t
expect 0 "down cleans up the hung tunnel" down --name t

echo
if ((failures)); then echo "$failures check(s) failed"; exit 1; fi
echo "all checks passed"

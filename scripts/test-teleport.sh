#!/usr/bin/env bash
# Smoke test for resources/teleport.sh against a fake `tsh` - no Teleport cluster, account, or
# network needed. Covers the session pre-flight (none / expired / about to expire / valid, and
# matching the right proxy and user among several profiles), login and how its failures are
# reported, and routing ssh/scp through tsh or straight to OpenSSH.
#
#   ./scripts/test-teleport.sh        (needs bash and python3)

set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/resources/teleport.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# The fake tsh: `status` answers from $MOCK/status.json, `login` behaves per $MOCK_LOGIN, and
# ssh/scp just record how they were called. Every call is appended to $MOCK/calls.
cat >"$WORK/bin/tsh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$MOCK/calls"
sub=""
for a in "$@"; do case "$a" in -*) ;; *) sub=$a; break ;; esac; done
case "$sub" in
  status)
    [[ -f "$MOCK/status.json" ]] || { echo "Not logged in." >&2; exit 1; }
    cat "$MOCK/status.json" ;;
  login)
    case "${MOCK_LOGIN:-ok}" in
      ok)
        echo "If browser window does not open automatically, open it by clicking on the link:" >&2
        echo " http://127.0.0.1:40000/sso" >&2
        echo "> Profile URL: https://teleport.example.com:443"
        "$MOCK/profile" teleport.example.com alice 43200 >"$MOCK/status.json" ;;
      network) echo "ERROR: dial tcp: lookup teleport.example.com: no such host" >&2; exit 1 ;;
      tty) echo "ERROR: underlying reader is not a terminal" >&2; exit 1 ;;
      hang) sleep 30 ;;
      # What tsh prints when killed while its first request to a silent proxy is still pending.
      blackhole)
        trap 'echo "ERROR: Get \"https://teleport.example.com:443/webapi/ping\": context canceled" >&2; exit 1' TERM
        sleep 30 & wait ;;
    esac ;;
  ssh | scp) echo "tsh-ran $*" ;;
esac
EOF
cat >"$WORK/bin/ssh" <<'EOF'
#!/usr/bin/env bash
echo "openssh-ran $*"
EOF
# profile <proxy> <user> <seconds from now> [<proxy> <user> <secs>...]: writes `tsh status
# --format=json` output, the first profile active; timestamps carry nanoseconds, as tsh's do.
cat >"$WORK/profile" <<'EOF'
#!/usr/bin/env python3
import json, sys
from datetime import datetime, timedelta, timezone
def prof(proxy, user, secs):
    t = datetime.now(timezone.utc) + timedelta(seconds=int(secs))
    return {"profile_url": f"https://{proxy}:443", "username": user, "cluster": "root",
            "valid_until": t.strftime("%Y-%m-%dT%H:%M:%S.%f") + "123Z"}
a = sys.argv[1:]
ps = [prof(*a[i:i + 3]) for i in range(0, len(a), 3)]
print(json.dumps({"active": ps[0], "profiles": ps[1:]}, indent=2))
EOF
chmod +x "$WORK/bin/tsh" "$WORK/bin/ssh" "$WORK/profile"

export PATH="$WORK/bin:$PATH" MOCK="$WORK"
P=(--proxy teleport.example.com:443)

failures=0
# expect <exit code> <description> <command...>: runs the script, checks its exit code.
expect() {
  local want=$1 desc=$2
  shift 2
  bash "$SCRIPT" "$@" >"$WORK/out" 2>"$WORK/err" </dev/null
  local got=$?
  if [[ $got == "$want" ]]; then
    printf 'ok    %s\n' "$desc"
  else
    printf 'FAIL  %s (exit %s, want %s)\n' "$desc" "$got" "$want"
    sed 's/^/        /' "$WORK/out" "$WORK/err"
    failures=$((failures + 1))
  fi
}
check() { # check <description> <shell test...>
  local desc=$1
  shift
  if "$@"; then printf 'ok    %s\n' "$desc"; else printf 'FAIL  %s\n' "$desc"; failures=$((failures + 1)); fi
}
session() { "$WORK/profile" "$@" >"$WORK/status.json"; }
reset() { rm -f "$WORK/status.json" "$WORK/calls"; }

echo "-- argument validation"
expect 2 "status without --proxy is a usage error" status
expect 2 "non-numeric --min-ttl is a usage error" status "${P[@]}" --min-ttl soon
if ! PATH=/usr/bin:/bin command -v tsh >/dev/null; then
  PATH=/usr/bin:/bin expect 3 "missing tsh is reported as a dependency error" status "${P[@]}"
fi

echo "-- session check"
reset
expect 4 "no profiles at all" status "${P[@]}"
check "...reported as not logged in" grep -q "STATUS expired Not logged in" "$WORK/out"
session other.example.com alice 43200
expect 4 "a session for a different proxy doesn't count" status "${P[@]}"
session teleport.example.com alice -60
expect 4 "an expired session" status "${P[@]}"
session teleport.example.com alice 100
expect 4 "a session with less than --min-ttl left" status "${P[@]}"
expect 0 "...is fine with a lower --min-ttl" status "${P[@]}" --min-ttl 30
session teleport.example.com alice 43200
expect 0 "a valid session" status "${P[@]}"
check "...reports user and time left" grep -q "STATUS valid Logged in to .* as alice .*11h59m left" "$WORK/out"
expect 4 "...but not for a different --user" status "${P[@]}" --user bob
session other.example.com bob 43200 teleport.example.com alice 43200
expect 0 "a valid session in a non-active profile is found" status --proxy teleport.example.com

echo "-- login"
session teleport.example.com alice 43200
expect 0 "login with a valid session" login "${P[@]}"
check "...doesn't run tsh login" bash -c "! grep -q '^login' '$WORK/calls'"
reset
expect 0 "login without a session" login "${P[@]}" --cluster leaf --auth okta
check "...runs tsh login scoped to the proxy, cluster, and connector" \
  grep -qx "login --proxy=teleport.example.com:443 --auth=okta --browser=none leaf" "$WORK/calls"
check "...shows the SSO link on stderr" grep -q "127.0.0.1:40000/sso" "$WORK/err"
check "...keeps tsh's output off stdout" bash -c "! grep -qv '^STATUS ' '$WORK/out'"
check "...ends with a valid session" grep -q "STATUS valid" "$WORK/out"
reset
MOCK_LOGIN=network expect 6 "an unreachable proxy is a network error" login "${P[@]}"
MOCK_LOGIN=tty expect 5 "a password prompt with no terminal fails login" login "${P[@]}"
check "...and says to log in from a terminal" grep -q "needs a terminal prompt" "$WORK/out"
if command -v timeout >/dev/null; then
  MOCK_LOGIN=hang expect 5 "a login nobody completes times out" login "${P[@]}" --login-timeout 1
  MOCK_LOGIN=blackhole expect 6 "a proxy that never answers is a network error" login "${P[@]}" --login-timeout 1
fi

echo "-- routing"
reset
expect 0 "ssh with no --proxy goes straight to OpenSSH" ssh -- alice@login1 hostname
check "...with the args unchanged" grep -qx "openssh-ran alice@login1 hostname" "$WORK/out"
check "...and never touches tsh" test ! -f "$WORK/calls"
expect 4 "ssh --no-login without a session fails" ssh "${P[@]}" --no-login -- alice@slogin1
session teleport.example.com alice 43200
expect 0 "ssh through Teleport" ssh "${P[@]}" --cluster leaf -- alice@slogin1 hostname
check "...runs tsh ssh on the right proxy and cluster" \
  grep -qx "tsh-ran --proxy=teleport.example.com:443 ssh --cluster=leaf alice@slogin1 hostname" "$WORK/out"
check "...with stdout left to the remote command" test "$(wc -l <"$WORK/out")" -eq 1
reset
expect 0 "scp logs in first when needed" scp "${P[@]}" -- ./job.sh alice@slogin1:~/
check "...then runs tsh scp" grep -q "^tsh-ran --proxy=teleport.example.com:443 scp ./job.sh" "$WORK/out"

echo
if ((failures)); then echo "$failures check(s) failed"; exit 1; fi
echo "all checks passed"

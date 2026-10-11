#!/usr/bin/env bash
# Exercises scripts/verify-wave.sh against throwaway repositories (a bare
# origin plus a clone) with stub `pnpm` and `just` on PATH. One row per line of
# the ticket's behaviour table; stdout, stderr and the exit code are compared
# as whole values. No real install, vitest or e2e ever runs.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vw="$script_dir/verify-wave.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/verify-wave-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT

fail=0
report() {
  if [ "$1" -eq 0 ]; then echo "ok   $2"; else echo "FAIL $2"; fail=1; fi
}

usage_line='usage: verify-wave.sh [--e2e] <branch>...'

# ---------------------------------------------------------------------------
# Stubs: log "<command> <args>|<pwd -P>" to $STUB_LOG, print canned output and
# exit with a code from the environment.
# ---------------------------------------------------------------------------
stubs="$tmp/stubs"
mkdir -p "$stubs"

cat >"$stubs/pnpm" <<'STUB'
#!/usr/bin/env bash
echo "pnpm $*|$(pwd -P)" >>"$STUB_LOG"
case "$1" in
  install)
    exit "${STUB_INSTALL_RC:-0}"
    ;;
  exec)
    {
      [ -e ../from-origin.txt ] && printf 'from-origin=yes ' || printf 'from-origin=no '
      [ -e ../local-only.txt ] && printf 'local-only=yes\n' || printf 'local-only=no\n'
    } >"${STUB_SEEN:-/dev/null}"
    case "${STUB_VITEST_OUT:-pass}" in
      pass) printf ' Test Files  1 passed (1)\n Test Files  2 passed (2)\n      Tests  5 passed (5)\n' ;;
      failed) printf ' Test Files  1 failed (1)\n      Tests  3 failed (3)\n' ;;
      none) printf 'something went wrong\n' ;;
    esac
    if [ -n "${STUB_VITEST_SLEEP:-}" ]; then
      sleep 30 &
      echo $! >"$STUB_SLEEPPID"
      wait $!
    fi
    exit "${STUB_VITEST_RC:-0}"
    ;;
  typecheck)
    if [ -n "${STUB_TC_ERROR:-}" ]; then
      echo "ERROR production config" >&2
      echo "ERROR production config"
    fi
    exit "${STUB_TC_RC:-0}"
    ;;
  lint)
    exit "${STUB_LINT_RC:-0}"
    ;;
esac
STUB
cat >"$stubs/just" <<'STUB'
#!/usr/bin/env bash
echo "just $*|$(pwd -P)" >>"$STUB_LOG"
exit "${STUB_JUST_RC:-0}"
STUB
chmod +x "$stubs/pnpm" "$stubs/just"

# ---------------------------------------------------------------------------
# Fixture: bare origin + clone with a grill-room/ directory.
# ---------------------------------------------------------------------------
case_n=0

# mkrepo <conflicting: yes|no>: sets origin, clone, ttmp, base_* for a fresh case
mkrepo() {
  case_n=$((case_n + 1))
  base="$tmp/case-$case_n"
  origin="$base/origin.git"
  clone="$base/clone"
  ttmp="$base/tmp"
  mkdir -p "$ttmp"
  git init -q --bare "$origin"
  git init -q "$clone"
  git -C "$clone" config user.email "test@example.com"
  git -C "$clone" config user.name "Test"
  git -C "$clone" remote add origin "$origin"
  mkdir "$clone/grill-room"
  echo base >"$clone/grill-room/keep.txt"
  echo base >"$clone/shared.txt"
  git -C "$clone" add -A
  git -C "$clone" commit -q -m base
  git -C "$clone" branch -M main
  git -C "$clone" push -q -u origin main
  for b in feat-a feat-b; do
    git -C "$clone" checkout -q -b "$b" main
    if [ "$1" = yes ]; then echo "$b" >"$clone/shared.txt"; else echo "$b" >"$clone/$b.txt"; fi
    git -C "$clone" add -A
    git -C "$clone" commit -q -m "$b"
    git -C "$clone" push -q origin "$b"
  done
  git -C "$clone" checkout -q main
  echo '.scratch/' >>"$clone/.git/info/exclude"
  stub_log="$base/stub.log"
  : >"$stub_log"
}

worktree_count() { git -C "$clone" worktree list --porcelain | grep -c '^worktree '; }

# snapshot before a run, leak report after
snapshot() {
  snap_head="$(git -C "$clone" rev-parse HEAD)"
  snap_branch="$(git -C "$clone" rev-parse --abbrev-ref HEAD)"
  snap_wt="$(worktree_count)"
}
leaks() {
  leak=""
  [ "$(worktree_count)" = "$snap_wt" ] || leak="$leak worktree-left"
  [ -z "$(git -C "$clone" status --porcelain)" ] || leak="$leak dirty-status"
  [ "$(git -C "$clone" rev-parse HEAD)" = "$snap_head" ] || leak="$leak head-moved"
  [ "$(git -C "$clone" rev-parse --abbrev-ref HEAD)" = "$snap_branch" ] || leak="$leak branch-moved"
  [ -z "$(ls -A "$ttmp")" ] || leak="$leak tmpdir-not-empty"
}

# vwrun <env assignments as one string> <cwd> <args...>: sets out, err, code, leak
vwrun() {
  local e="$1" cwd="$2"
  shift 2
  snapshot
  : >"$stub_log"
  out="$(cd "$cwd" && env $e TMPDIR="$ttmp" STUB_LOG="$stub_log" PATH="$stubs:$PATH" "$vw" "$@" 2>"$base/err")"; code=$?
  err="$(cat "$base/err")"
  leaks
}

pidline_ok() { printf '%s\n' "$err" | grep -qx 'pid: [0-9]*' && [ "$(printf '%s\n' "$err" | wc -l | tr -d ' ')" = 1 ]; }
join() { local IFS="$NL"; printf '%s' "$*"; }
NL='
'

# row <name> <expected stdout> <expected exit>: stderr must be exactly the pid line
row() {
  [ "$out" = "$2" ] && pidline_ok && [ "$code" -eq "$3" ] && [ -z "$leak" ]
  report $? "$1${leak:+ (leaks:$leak)}"
}
# errrow <name> <expected stderr> <expected stdout> <expected exit>
errrow() {
  [ "$out" = "$3" ] && [ "$err" = "$2" ] && [ "$code" -eq "$4" ] && [ -z "$leak" ]
  report $? "$1${leak:+ (leaks:$leak)}"
}
logis() { [ "$(cat "$stub_log")" = "$1" ]; }

wt_ok() { # all logged dirs are <ttmp>/<x>/grill-room in pwd -P form
  local p dirs
  p="$(cd "$ttmp" && pwd -P)"
  dirs="$(sed 's/^[^|]*|//' "$stub_log" | sort -u)"
  case "$dirs" in "$p"/*/grill-room) [ "$(printf '%s\n' "$dirs" | wc -l | tr -d ' ')" = 1 ] ;; *) return 1 ;; esac
}
calls() { sed 's/|.*$//' "$stub_log"; }

merged='merged: feat-b feat-a'
install0='install: exit 0'
pass_tail="Test Files  2 passed (2)${NL}Tests  5 passed (5)"
install_cmd='pnpm install --frozen-lockfile --prefer-offline'
vitest_cmd='pnpm exec vitest --run --maxWorkers=3'

mkrepo no
repo_main="$clone"

# all pass
vwrun "" "$clone" feat-b feat-a
row "all pass" "$(join "$merged" "$install0" "vitest: exit 0" "$pass_tail" "typecheck: exit 0" "lint: exit 0" "e2e: skipped" "RESULT: pass")" 0

# call sequence
[ "$(calls)" = "$(join "$install_cmd" "$vitest_cmd" "pnpm typecheck" "pnpm lint")" ] && wt_ok
report $? "call sequence"

# e2e flag
vwrun "" "$clone" --e2e feat-b feat-a
row "e2e flag" "$(join "$merged" "$install0" "vitest: exit 0" "$pass_tail" "typecheck: exit 0" "lint: exit 0" "e2e: exit 0" "RESULT: pass")" 0
[ "$(calls)" = "$(join "$install_cmd" "$vitest_cmd" "pnpm typecheck" "pnpm lint" "just e2e")" ] && wt_ok
report $? "e2e flag call sequence"

# e2e fails
vwrun "STUB_JUST_RC=1" "$clone" --e2e feat-b feat-a
row "e2e fails" "$(join "$merged" "$install0" "vitest: exit 0" "$pass_tail" "typecheck: exit 0" "lint: exit 0" "e2e: exit 1" "RESULT: fail")" 1

# vitest fails
vwrun "STUB_VITEST_RC=1" "$clone" feat-b feat-a
row "vitest fails" "$(join "$merged" "$install0" "vitest: exit 1" "$pass_tail" "typecheck: exit 0" "lint: exit 0" "e2e: skipped" "RESULT: fail")" 1

# vitest fails, e2e passes
vwrun "STUB_VITEST_RC=1" "$clone" --e2e feat-b feat-a
row "vitest fails e2e passes" "$(join "$merged" "$install0" "vitest: exit 1" "$pass_tail" "typecheck: exit 0" "lint: exit 0" "e2e: exit 0" "RESULT: fail")" 1
[ "$(calls)" = "$(join "$install_cmd" "$vitest_cmd" "pnpm typecheck" "pnpm lint" "just e2e")" ]
report $? "vitest fails e2e passes call sequence"

# typecheck ERROR line with exit 0
vwrun "STUB_TC_ERROR=1" "$clone" feat-b feat-a
row "typecheck ERROR line exit 0" "$(join "$merged" "$install0" "vitest: exit 0" "$pass_tail" "typecheck: exit 0" "lint: exit 0" "e2e: skipped" "RESULT: pass")" 0

# typecheck fails
vwrun "STUB_TC_RC=1" "$clone" feat-b feat-a
row "typecheck fails" "$(join "$merged" "$install0" "vitest: exit 0" "$pass_tail" "typecheck: exit 1" "lint: exit 0" "e2e: skipped" "RESULT: fail")" 1

# lint fails
vwrun "STUB_LINT_RC=1" "$clone" feat-b feat-a
row "lint fails" "$(join "$merged" "$install0" "vitest: exit 0" "$pass_tail" "typecheck: exit 0" "lint: exit 1" "e2e: skipped" "RESULT: fail")" 1

# install fails
skipped="$(join "install: exit 1" "vitest: skipped" "typecheck: skipped" "lint: skipped" "e2e: skipped" "RESULT: fail")"
vwrun "STUB_INSTALL_RC=1" "$clone" feat-b feat-a
row "install fails" "$(join "$merged" "$skipped")" 1
[ "$(calls)" = "$install_cmd" ]
report $? "install fails call log"
vwrun "STUB_INSTALL_RC=1" "$clone" --e2e feat-b feat-a
row "install fails with e2e" "$(join "$merged" "$skipped")" 1
[ "$(calls)" = "$install_cmd" ]
report $? "install fails with e2e call log"

# vitest prints no summary
vwrun "STUB_VITEST_OUT=none STUB_VITEST_RC=1" "$clone" feat-b feat-a
row "vitest no summary" "$(join "$merged" "$install0" "vitest: exit 1" "typecheck: exit 0" "lint: exit 0" "e2e: skipped" "RESULT: fail")" 1

# vitest failed summary lines
vwrun "STUB_VITEST_OUT=failed STUB_VITEST_RC=1" "$clone" feat-b feat-a
row "vitest failed summary" "$(join "$merged" "$install0" "vitest: exit 1" "Test Files  1 failed (1)" "Tests  3 failed (3)" "typecheck: exit 0" "lint: exit 0" "e2e: skipped" "RESULT: fail")" 1

# logs land under the checkout the script was run from
vwrun "" "$clone/grill-room" feat-b feat-a
pidn="${err#pid: }"
[ "$code" -eq 0 ] && pidline_ok && [ -f "$clone/.scratch/verify-wave/$pidn/vitest.log" ] && [ -f "$clone/.scratch/verify-wave/$pidn/git.log" ] && [ -z "$leak" ]
report $? "logs from subdirectory"

# unknown branch, stale ref, usage
vwrun "" "$clone" feat-b nope
errrow "unknown branch" "verify-wave.sh: no branch origin/nope" "" 2
[ ! -s "$stub_log" ]
report $? "unknown branch runs nothing"

git -C "$clone" push -q origin feat-a:refs/heads/gone
git --git-dir="$origin" branch -q -D gone
vwrun "" "$clone" gone
[ -n "$(git -C "$clone" rev-parse --verify -q refs/remotes/origin/gone)" ] || echo "setup: stale ref missing"
errrow "stale ref" "verify-wave.sh: no branch origin/gone" "" 2

vwrun "" "$clone"
errrow "no arguments" "$usage_line" "" 2
vwrun "" "$clone" --bogus feat-a
errrow "bogus flag" "$usage_line" "" 2
vwrun "" "$clone" feat-a --e2e
errrow "e2e after branch" "$usage_line" "" 2
vwrun "" "$clone" --e2e
errrow "e2e without branch" "$usage_line" "" 2

# pid line: launched directly, the number is the script's own PID
snapshot
: >"$stub_log"
cd "$clone" || exit 1
TMPDIR="$ttmp" STUB_LOG="$stub_log" PATH="$stubs:$PATH" "$vw" feat-b feat-a >"$base/pid-out" 2>"$base/pid-err" &
launched=$!
wait "$launched"
cd "$OLDPWD" || exit 1
err="$(cat "$base/pid-err")"
[ "$err" = "pid: $launched" ]
report $? "pid line"

# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------
mkrepo yes
vwrun "" "$clone" feat-a feat-b
[ "$out" = "conflict: feat-b" ] && [ "$(printf '%s\n' "$err" | sed -n 1p)" != "" ] && printf '%s\n' "$err" | sed -n 1p | grep -qx 'pid: [0-9]*' \
  && [ "$(printf '%s\n' "$err" | sed -n 2p)" = "verify-wave.sh: merge conflict with origin/feat-b" ] && [ "$(printf '%s\n' "$err" | wc -l | tr -d ' ')" = 2 ] \
  && [ "$code" -eq 2 ] && [ ! -s "$stub_log" ] && [ -z "$leak" ]
report $? "conflict b${leak:+ (leaks:$leak)}"
vwrun "" "$clone" feat-b feat-a
[ "$out" = "conflict: feat-a" ] && printf '%s\n' "$err" | sed -n 1p | grep -qx 'pid: [0-9]*' \
  && [ "$(printf '%s\n' "$err" | sed -n 2p)" = "verify-wave.sh: merge conflict with origin/feat-a" ] && [ "$(printf '%s\n' "$err" | wc -l | tr -d ' ')" = 2 ] \
  && [ "$code" -eq 2 ] && [ ! -s "$stub_log" ] && [ -z "$leak" ]
report $? "conflict a${leak:+ (leaks:$leak)}"

# ---------------------------------------------------------------------------
# Linked worktree: logs land under that worktree's top level
# ---------------------------------------------------------------------------
mkrepo no
lw="$base/linked"
git -C "$clone" worktree add -q "$lw" -b linked-branch main
vwrun "" "$lw" feat-b feat-a
pidn="${err#pid: }"
[ "$code" -eq 0 ] && pidline_ok && [ -f "$lw/.scratch/verify-wave/$pidn/vitest.log" ] && [ ! -e "$clone/.scratch/verify-wave/$pidn" ] && [ -z "$leak" ]
report $? "logs from linked worktree${leak:+ (leaks:$leak)}"

# ---------------------------------------------------------------------------
# origin/main, not local main
# ---------------------------------------------------------------------------
mkrepo no
other="$base/other"
git clone -q "$origin" "$other"
git -C "$other" config user.email "test@example.com"
git -C "$other" config user.name "Test"
echo o >"$other/from-origin.txt"
git -C "$other" add -A
git -C "$other" commit -q -m "from origin"
git -C "$other" push -q origin main
echo l >"$clone/local-only.txt"
git -C "$clone" add -A
git -C "$clone" commit -q -m "local only"
seen="$base/seen"
vwrun "STUB_SEEN=$seen" "$clone" feat-b feat-a
[ "$code" -eq 0 ] && [ "$(cat "$seen")" = "from-origin=yes local-only=no" ] && [ -z "$leak" ]
report $? "origin not local${leak:+ (leaks:$leak)}"

# ---------------------------------------------------------------------------
# TERM, INT, HUP: exits within 5 s with the signal's code, process group gone,
# worktree and temp dir removed. Job control gives the job default signal
# dispositions; a plain background job of a non-interactive shell ignores INT.
# ---------------------------------------------------------------------------
# signal_row <SIG> <expected code>
signal_row() {
  local sig="$1" want="$2" sleeppid spid i finished sig_code sleeper sleeper_alive
  mkrepo no
  snapshot
  sleeppid="$base/sleep.pid"
  cd "$clone" || exit 1
  set -m
  TMPDIR="$ttmp" STUB_LOG="$stub_log" PATH="$stubs:$PATH" STUB_VITEST_SLEEP=1 STUB_SLEEPPID="$sleeppid" "$vw" feat-b feat-a >"$base/$sig-out" 2>"$base/$sig-err" &
  spid=$!
  set +m
  cd "$OLDPWD" || exit 1
  i=0
  while [ ! -s "$sleeppid" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
  finished=0
  if [ -s "$sleeppid" ]; then
    kill -"$sig" "$spid"
    i=0
    while kill -0 "$spid" 2>/dev/null && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
    kill -0 "$spid" 2>/dev/null || finished=1
  fi
  kill -KILL "$spid" 2>/dev/null
  wait "$spid" 2>/dev/null
  sig_code=$?
  leaks
  sleeper="$(cat "$sleeppid" 2>/dev/null)"
  sleeper_alive=1
  if [ -n "$sleeper" ]; then kill -0 "$sleeper" 2>/dev/null || sleeper_alive=0; fi
  [ "$finished" -eq 1 ] && [ "$sig_code" -eq "$want" ] && [ -n "$sleeper" ] && [ "$sleeper_alive" -eq 0 ] && [ -z "$leak" ]
  report $? "sig$sig exits $want${leak:+ (leaks:$leak)}"
}

signal_row TERM 143
signal_row INT 130
signal_row HUP 129

exit "$fail"

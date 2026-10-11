#!/usr/bin/env bash
# Verify PR branches merged together on top of the fetched origin/main.
#
# Usage: verify-wave.sh [--e2e] <branch>...
#
# Run from inside the repo or a linked worktree of it. Each <branch> is a name
# on origin (no origin/ prefix). The branches are merged, in the order given,
# into a scratch worktree of origin/main; the checkout itself is never changed.
# In that worktree it runs the install, vitest and typecheck (and `just e2e`
# with --e2e), prints a summary, and removes the worktree on every exit.
# Output of every command goes to <repo root>/.scratch/verify-wave/<pid>/;
# stdout and stderr hold only the lines below.
#
# stdout: merged / conflict, then one line per step, then RESULT.
# stderr: pid: <n> (the script's own PID, so a caller can stop it), or one error line.
# Exit: 0 all steps passed, 1 a step failed, 2 usage error, unknown branch or conflict,
# 143, 130 or 129 when stopped by TERM, INT or HUP.
set -uo pipefail

usage_line="usage: verify-wave.sh [--e2e] <branch>..."
usage() { echo "$usage_line" >&2; exit 2; }

e2e=0
if [ "${1:-}" = "--e2e" ]; then
  e2e=1
  shift
fi
[ "$#" -ge 1 ] || usage
for arg in "$@"; do
  case "$arg" in -*) usage ;; esac
done
branches=("$@")

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "verify-wave.sh: not inside a git repository" >&2; exit 2; }
logdir="$root/.scratch/verify-wave/$$"
mkdir -p "$logdir"
gitlog="$logdir/git.log"

for b in "${branches[@]}"; do
  if ! git -C "$root" fetch origin -- "+refs/heads/$b:refs/remotes/origin/$b" >>"$gitlog" 2>&1 \
    || ! git -C "$root" rev-parse --verify -q "refs/remotes/origin/$b^{commit}" >>"$gitlog" 2>&1; then
    echo "verify-wave.sh: no branch origin/$b" >&2
    exit 2
  fi
done

set -m
wt=""
current=""

stop_current() {
  if [ -n "$current" ]; then
    kill -TERM -- "-$current" 2>/dev/null
    wait "$current" 2>/dev/null
    current=""
  fi
}

cleanup() {
  stop_current
  if [ -n "$wt" ]; then
    git -C "$root" worktree remove --force "$wt" >>"$gitlog" 2>&1 || rm -rf "$wt"
    git -C "$root" worktree prune >>"$gitlog" 2>&1
    wt=""
  fi
}

on_term() { cleanup; exit 143; }
on_int() { cleanup; exit 130; }
on_hup() { cleanup; exit 129; }

trap cleanup EXIT
trap on_term TERM
trap on_int INT
trap on_hup HUP

git -C "$root" fetch origin "+refs/heads/main:refs/remotes/origin/main" >>"$gitlog" 2>&1
wt="$(mktemp -d "${TMPDIR:-/tmp}/verify-wave.XXXXXXXX")"
if ! git -C "$root" worktree add --detach "$wt" origin/main >>"$gitlog" 2>&1; then
  echo "verify-wave.sh: cannot create a worktree of origin/main (see $gitlog)" >&2
  exit 2
fi

echo "pid: $$" >&2

for b in "${branches[@]}"; do
  if ! git -C "$wt" merge --no-edit "origin/$b" >>"$gitlog" 2>&1; then
    echo "conflict: $b"
    echo "verify-wave.sh: merge conflict with origin/$b" >&2
    exit 2
  fi
done

# run_step <name> <command...>: runs in <worktree>/grill-room in its own process group.
run_step() {
  local name="$1"
  shift
  ( cd "$wt/grill-room" && exec "$@" ) >"$logdir/$name.log" 2>&1 </dev/null &
  current=$!
  wait "$current"
  local rc=$?
  current=""
  return "$rc"
}

install_rc=""; vitest_rc=""; typecheck_rc=""; e2e_rc=""

run_step install pnpm install --frozen-lockfile --prefer-offline
install_rc=$?
if [ "$install_rc" -eq 0 ]; then
  run_step vitest pnpm exec vitest --run --maxWorkers=3
  vitest_rc=$?
  run_step typecheck pnpm typecheck
  typecheck_rc=$?
  if [ "$e2e" -eq 1 ]; then
    run_step e2e just e2e
    e2e_rc=$?
  fi
fi

result=pass
step_line() { # <name> <rc or empty>
  if [ -z "$2" ]; then
    echo "$1: skipped"
  else
    echo "$1: exit $2"
    [ "$2" -eq 0 ] || result=fail
  fi
}

echo "merged: ${branches[*]}"
step_line install "$install_rc"
step_line vitest "$vitest_rc"
if [ -n "$vitest_rc" ]; then
  grep -E '^[[:space:]]*Test Files[[:space:]]' "$logdir/vitest.log" | tail -n 1 | sed 's/^[[:space:]]*//'
  grep -E '^[[:space:]]*Tests[[:space:]]' "$logdir/vitest.log" | tail -n 1 | sed 's/^[[:space:]]*//'
fi
step_line typecheck "$typecheck_rc"
step_line e2e "$e2e_rc"
[ -n "$install_rc" ] && [ "$install_rc" -ne 0 ] && result=fail
echo "RESULT: $result"
[ "$result" = pass ]

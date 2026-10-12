#!/usr/bin/env bash
# Run one test command with the branch's non-test source reverted, then re-apply it.
#
# Usage: revert-check.sh '<test command>'
#
# Reverts every non-test file the branch changes against origin/main, runs the
# command with bash -c from the worktree root, and re-applies the source even
# when the command fails or the run is interrupted. Use only double quotes
# inside the command. Exit codes: 2 usage, 3 revert failed, 4 re-apply failed,
# 5 fetch failed, 130/143 interrupted, otherwise the command's own status.
set -uo pipefail

if [ -z "${1:-}" ]; then
  echo "usage: revert-check.sh '<test command>'" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)" || exit 1

if ! git fetch origin; then
  echo "git fetch failed"
  exit 5
fi

patch=$(mktemp "${TMPDIR:-/tmp}/revert-check.XXXXXX")
reverted=0
test_pid=""

reapply() {
  [ "$reverted" = 1 ] || return 0
  reverted=0
  if ! git apply "$patch"; then
    echo "git apply failed"
    return 4
  fi
}

forward() {
  local status=$1
  if [ -n "$test_pid" ]; then
    kill -TERM -- "-$test_pid" 2>/dev/null
    wait "$test_pid" 2>/dev/null
  fi
  reapply || exit 4
  exit "$status"
}

trap 'reapply; rm -f "$patch"' EXIT
trap 'forward 130' INT
trap 'forward 143' TERM

git diff --no-renames --name-only origin/main...HEAD \
  | grep -v -E '\.(test|spec)\.[cm]?[jt]sx?$|\.snap$|(^|/)(e2e|test|__snapshots__)/|(^|/)test-[^/]*\.sh$' \
  | xargs -r git diff --no-renames --binary origin/main...HEAD -- > "$patch"

if [ ! -s "$patch" ]; then
  echo "test-only PR: no source to revert"
  exit 0
fi

reverted=1
if ! git apply -R "$patch"; then
  reverted=0
  echo "git apply -R failed"
  exit 3
fi

set -m
bash -c "$1" &
test_pid=$!
wait "$test_pid"
test_status=$?
set +m
test_pid=""

reapply
reapply_status=$?
if [ "$reapply_status" -ne 0 ]; then
  exit "$reapply_status"
fi
exit "$test_status"

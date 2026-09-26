#!/usr/bin/env bash
# Exercises scripts/prune-worktrees.sh against a throwaway repository, one
# worktree per row of the behaviour table, and asserts the exact output and
# the worktrees/branches left behind.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prune_script="$script_dir/prune-worktrees.sh"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

fail=0

origin="$tmp/origin.git"
work="$tmp/work"

git init -q --bare "$origin"
git init -q "$work"
git -C "$work" config user.email "test@example.com"
git -C "$work" config user.name "Test"
git -C "$work" remote add origin "$origin"

echo "root" >"$work/README.md"
git -C "$work" add README.md
git -C "$work" commit -q -m "root"
git -C "$work" branch -M main
git -C "$work" push -q -u origin main

add_worktree() {
  # add_worktree <dir-name> <branch-name>
  git -C "$work" worktree add -q ".claude/worktrees/$1" -b "$2" main
}

commit_in_worktree() {
  # commit_in_worktree <dir-name> <message>
  echo "$2" >"$work/.claude/worktrees/$1/note.txt"
  git -C "$work/.claude/worktrees/$1" add note.txt
  git -C "$work/.claude/worktrees/$1" commit -q -m "$2"
}

merge_branch() {
  # merge_branch <branch-name>
  git -C "$work" merge -q --no-ff --no-edit "$1" -m "merge $1"
}

# Row: branch not an ancestor of main -> kept (not merged)
add_worktree agent-unmerged agent-unmerged-branch
commit_in_worktree agent-unmerged "unmerged work"

# Row: fresh branch at main's tip, no commits of its own -> kept
add_worktree agent-fresh agent-fresh-branch

# Row: merged, clean, unlocked -> removed
add_worktree agent-merged agent-merged-branch
commit_in_worktree agent-merged "merged work"
merge_branch agent-merged-branch

# Row: locked (also merged, so only the lock check keeps it) -> kept
add_worktree agent-locked agent-locked-branch
commit_in_worktree agent-locked "locked work"
merge_branch agent-locked-branch
git -C "$work" worktree lock --reason "claude agent test" ".claude/worktrees/agent-locked"

# Row: merged but with uncommitted changes -> kept
add_worktree agent-dirty agent-dirty-branch
commit_in_worktree agent-dirty "dirty work"
merge_branch agent-dirty-branch
echo "uncommitted change" >>"$work/.claude/worktrees/agent-dirty/note.txt"

git -C "$work" push -q origin main

output="$(bash "$prune_script" "$work")"
rc=$?

expected="kept    .claude/worktrees/agent-dirty (uncommitted changes)
kept    .claude/worktrees/agent-fresh (agent-fresh-branch has no commits of its own)
kept    .claude/worktrees/agent-locked (locked)
removed .claude/worktrees/agent-merged (agent-merged-branch)
kept    .claude/worktrees/agent-unmerged (agent-unmerged-branch is not merged)"

if [ "$rc" -ne 0 ]; then
  echo "FAIL: prune-worktrees.sh exited $rc"
  fail=1
fi

if [ "$output" != "$expected" ]; then
  echo "FAIL: output mismatch"
  echo "--- expected ---"
  echo "$expected"
  echo "--- actual ---"
  echo "$output"
  fail=1
fi

assert_dir() {
  # assert_dir <dir-name> <should-exist: yes|no>
  local path="$work/.claude/worktrees/$1"
  if [ "$2" = yes ] && [ ! -d "$path" ]; then
    echo "FAIL: expected $1 to still exist"
    fail=1
  fi
  if [ "$2" = no ] && [ -d "$path" ]; then
    echo "FAIL: expected $1 to have been removed"
    fail=1
  fi
}

assert_branch() {
  # assert_branch <branch-name> <should-exist: yes|no>
  if git -C "$work" show-ref --verify --quiet "refs/heads/$1"; then
    exists=yes
  else
    exists=no
  fi
  if [ "$exists" != "$2" ]; then
    echo "FAIL: expected branch $1 existence=$2, got $exists"
    fail=1
  fi
}

assert_dir agent-unmerged yes
assert_dir agent-fresh yes
assert_dir agent-locked yes
assert_dir agent-merged no
assert_dir agent-dirty yes

assert_branch agent-unmerged-branch yes
assert_branch agent-fresh-branch yes
assert_branch agent-locked-branch yes
assert_branch agent-merged-branch no
assert_branch agent-dirty-branch yes

if [ "$fail" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi

echo "OK"
exit 0

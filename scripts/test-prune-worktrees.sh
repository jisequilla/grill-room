#!/usr/bin/env bash
# Exercises scripts/prune-worktrees.sh against throwaway repositories, one
# worktree per row of the behaviour table plus the edge cases the round-1
# review found, and asserts the exact output and the worktrees/branches left
# behind.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prune_script="$script_dir/prune-worktrees.sh"

fail=0

# ---------------------------------------------------------------------------
# Main matrix: one worktree per behaviour-table row, plus a detached-HEAD
# worktree. The repository root itself lives under a path containing a
# space, so every row exercises the space-in-path fix too.
# ---------------------------------------------------------------------------

tmp="$(mktemp -d "${TMPDIR:-/tmp}/gr rsi test.XXXXXXXX")"
cleanup_main() { rm -rf "$tmp"; }
trap cleanup_main EXIT

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

# Row: detached HEAD with an unmerged commit -> kept, never resolved as main's own HEAD
git -C "$work" worktree add -q --detach ".claude/worktrees/agent-detached" main
echo "detached work" >"$work/.claude/worktrees/agent-detached/note.txt"
git -C "$work/.claude/worktrees/agent-detached" add note.txt
git -C "$work/.claude/worktrees/agent-detached" commit -q -m "detached unmerged work"

git -C "$work" push -q origin main

output="$(bash "$prune_script" "$work")"
rc=$?

expected="kept    .claude/worktrees/agent-detached (detached HEAD)
kept    .claude/worktrees/agent-dirty (uncommitted changes)
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
  local exists
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
assert_dir agent-detached yes

assert_branch agent-unmerged-branch yes
assert_branch agent-fresh-branch yes
assert_branch agent-locked-branch yes
assert_branch agent-merged-branch no
assert_branch agent-dirty-branch yes

cleanup_main
trap - EXIT

# ---------------------------------------------------------------------------
# Long history: the fresh branch's tip is the very first line of
# `git rev-list --first-parent`, so an unbuffered `printf | grep -qx` pipe
# breaks once history outgrows the pipe buffer (~1,600+ first-parent
# commits). Build the commits with commit-tree (same tree every time) so it
# stays fast.
# ---------------------------------------------------------------------------

test_long_history() {
  local d work tree parent i out
  d="$(mktemp -d)"
  work="$d/work"

  git init -q "$work"
  git -C "$work" config user.email "test@example.com"
  git -C "$work" config user.name "Test"
  echo "root" >"$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit -q -m "root"
  git -C "$work" branch -M main

  # Build the long history first, so the fresh branch's tip (created below,
  # at main's now-advanced tip) is the very first line `git rev-list` prints
  # (newest first) rather than the last — the case that breaks a
  # `printf | grep -qx` pipe under pipefail once history outgrows the pipe
  # buffer.
  tree="$(git -C "$work" rev-parse HEAD^{tree})"
  parent="$(git -C "$work" rev-parse HEAD)"
  for i in $(seq 1 2000); do
    parent="$(git -C "$work" commit-tree -p "$parent" -m "filler $i" "$tree")"
  done
  git -C "$work" update-ref refs/heads/main "$parent"

  git -C "$work" worktree add -q ".claude/worktrees/agent-fresh" -b agent-fresh-branch main

  out="$(bash "$prune_script" "$work")"

  if ! grep -qxF "kept    .claude/worktrees/agent-fresh (agent-fresh-branch has no commits of its own)" <<<"$out"; then
    echo "FAIL: long-history case did not keep the fresh worktree"
    echo "$out"
    fail=1
  fi
  if [ ! -d "$work/.claude/worktrees/agent-fresh" ]; then
    echo "FAIL: long-history case removed the fresh worktree"
    fail=1
  fi

  rm -rf "$d"
}

# ---------------------------------------------------------------------------
# No remote configured at all: the script must still prune using local main.
# ---------------------------------------------------------------------------

test_no_remote() {
  local d work out rc
  d="$(mktemp -d)"
  work="$d/work"

  git init -q "$work"
  git -C "$work" config user.email "test@example.com"
  git -C "$work" config user.name "Test"
  echo "root" >"$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit -q -m "root"
  git -C "$work" branch -M main

  git -C "$work" worktree add -q ".claude/worktrees/agent-merged" -b agent-merged-branch main
  echo "merged" >"$work/.claude/worktrees/agent-merged/note.txt"
  git -C "$work/.claude/worktrees/agent-merged" add note.txt
  git -C "$work/.claude/worktrees/agent-merged" commit -q -m "merged work"
  git -C "$work" merge -q --no-ff --no-edit agent-merged-branch -m "merge agent-merged-branch"

  out="$(bash "$prune_script" "$work" 2>&1)"
  rc=$?

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: no-remote case exited $rc"
    echo "$out"
    fail=1
  fi
  if [ -d "$work/.claude/worktrees/agent-merged" ]; then
    echo "FAIL: no-remote case did not remove the merged worktree"
    echo "$out"
    fail=1
  fi

  rm -rf "$d"
}

# ---------------------------------------------------------------------------
# Neither main nor origin/main resolves: the script reports it and exits 0,
# removing nothing.
# ---------------------------------------------------------------------------

test_no_main_ref() {
  local d work out rc
  d="$(mktemp -d)"
  work="$d/work"

  git init -q "$work"
  git -C "$work" config user.email "test@example.com"
  git -C "$work" config user.name "Test"
  echo "root" >"$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit -q -m "root"
  git -C "$work" branch -M trunk

  mkdir -p "$work/.claude/worktrees"

  out="$(bash "$prune_script" "$work" 2>&1)"
  rc=$?

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: no-main-ref case exited $rc"
    echo "$out"
    fail=1
  fi
  if [ -z "$out" ]; then
    echo "FAIL: no-main-ref case printed nothing"
    fail=1
  fi

  rm -rf "$d"
}

test_long_history
test_no_remote
test_no_main_ref

if [ "$fail" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi

echo "OK"
exit 0

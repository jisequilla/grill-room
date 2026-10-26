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

# ---------------------------------------------------------------------------
# Workflow worktrees (wf_*): finished ones go whatever their HEAD looks like;
# locked, unmerged and dirty ones stay. The helpers read the caller's `work`.
# ---------------------------------------------------------------------------

assert_file() {
  # assert_file <worktree-name> <relative path> <should-exist: yes|no>
  local exists=no
  [ -e "$work/.claude/worktrees/$1/$2" ] && exists=yes
  if [ "$exists" != "$3" ]; then
    echo "FAIL: expected $1/$2 existence=$3, got $exists"
    fail=1
  fi
}

assert_modified() {
  # assert_modified <worktree-name> <file>
  local status
  status="$(git -C "$work/.claude/worktrees/$1" status --porcelain -- "$2")"
  if [ "$status" != " M $2" ]; then
    echo "FAIL: expected $1/$2 to be modified, status was '$status'"
    fail=1
  fi
}

wf_merged() {
  # wf_merged <dir-name> <branch-name>: branch from main, one commit, merged
  add_worktree "$1" "$2"
  commit_in_worktree "$1" "$1 work"
  merge_branch "$2"
}

wf_detached() {
  # wf_detached <dir-name>: detached at main's tip
  git -C "$work" worktree add -q --detach ".claude/worktrees/$1" main
}

wf_custom_commit() {
  # wf_custom_commit <dir-name> <relative file>: commit one new tracked file
  local dir="$work/.claude/worktrees/$1"
  mkdir -p "$(dirname "$dir/$2")"
  echo "tracked" >"$dir/$2"
  git -C "$dir" add "$2"
  git -C "$dir" commit -q -m "$1 adds $2"
}

wf_untracked() {
  # wf_untracked <dir-name> <relative file>
  local dir="$work/.claude/worktrees/$1"
  mkdir -p "$(dirname "$dir/$2")"
  echo "untracked" >"$dir/$2"
}

wf_lock() {
  git -C "$work" worktree lock --reason "claude agent test" ".claude/worktrees/$1"
}

test_workflow_worktrees() {
  local d work origin clone out rc expected gone kept
  d="$(mktemp -d "${TMPDIR:-/tmp}/gr pq3 test.XXXXXXXX")"
  work="$d/work"
  origin="$d/origin.git"
  clone="$d/clone"

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

  wf_merged agent-merged agent-merged-branch

  wf_merged wf_a-1 worktree-wf_a-1

  wf_detached wf_a-2

  git -C "$work" worktree add -q ".claude/worktrees/wf_a-3" -b fix-gr-x main

  wf_merged wf_a-4 worktree-wf_a-4
  wf_untracked wf_a-4 pr-body-gr-x.md

  wf_merged wf_a-5 worktree-wf_a-5
  wf_untracked wf_a-5 notes.md
  wf_untracked wf_a-5 pr-body-gr-x.md

  wf_merged wf_a-6 worktree-wf_a-6
  wf_untracked wf_a-6 pr-body-gr-x.md.orig

  wf_merged wf_a-7 worktree-wf_a-7
  echo "modified" >>"$work/.claude/worktrees/wf_a-7/note.txt"

  wf_merged wf_a-8 worktree-wf_a-8
  wf_lock wf_a-8

  add_worktree wf_a-9 worktree-wf_a-9
  commit_in_worktree wf_a-9 "wf_a-9 work"

  wf_detached wf_b-1
  commit_in_worktree wf_b-1 "wf_b-1 work"

  add_worktree wf_b-2 worktree-wf_b-2
  wf_custom_commit wf_b-2 pr-body-d/t
  merge_branch worktree-wf_b-2
  wf_untracked wf_b-2 pr-body-d/x.md

  add_worktree wf_b-3 worktree-wf_b-3
  commit_in_worktree wf_b-3 "wf_b-3 work"
  wf_untracked wf_b-3 notes.md
  wf_lock wf_b-3

  add_worktree wf_b-4 worktree-wf_b-4
  commit_in_worktree wf_b-4 "wf_b-4 work"
  wf_untracked wf_b-4 notes.md
  wf_untracked wf_b-4 pr-body-gr-x.md

  wf_merged wf_b-5 worktree-wf_b-5
  wf_untracked wf_b-5 "pr-body-x y.md"

  wf_detached wf_b-6
  wf_untracked wf_b-6 pr-body-gr-x.md

  wf_merged wf_b-7 worktree-wf_b-7
  wf_untracked wf_b-7 newdir/x

  wf_detached wf_b-8
  wf_untracked wf_b-8 notes.md

  wf_detached wf_b-9
  wf_lock wf_b-9

  git -C "$work" push -q origin main

  add_worktree wf_c-1 worktree-wf_c-1
  commit_in_worktree wf_c-1 "wf_c-1 work"
  git -C "$work/.claude/worktrees/wf_c-1" push -q origin worktree-wf_c-1
  git clone -q -b main "$origin" "$clone"
  git -C "$clone" config user.email "test@example.com"
  git -C "$clone" config user.name "Test"
  git -C "$clone" fetch -q origin worktree-wf_c-1
  git -C "$clone" merge -q --no-ff --no-edit FETCH_HEAD
  git -C "$clone" push -q origin main

  wf_merged wf_c-2 worktree-wf_c-2

  add_worktree wf_d-1 worktree-wf_d-1
  wf_custom_commit wf_d-1 pr-body-t.md
  merge_branch worktree-wf_d-1
  wf_untracked wf_d-1 pr-body-gr-x.md

  add_worktree wf_d-2 worktree-wf_d-2
  wf_custom_commit wf_d-2 pr-body-u.md
  merge_branch worktree-wf_d-2
  echo "modified" >>"$work/.claude/worktrees/wf_d-2/pr-body-u.md"

  out="$(bash "$prune_script" "$work")"
  rc=$?

  expected="removed .claude/worktrees/agent-merged (agent-merged-branch)
removed .claude/worktrees/wf_a-1 (worktree-wf_a-1)
removed .claude/worktrees/wf_a-2 (detached HEAD)
removed .claude/worktrees/wf_a-3 (fix-gr-x)
removed .claude/worktrees/wf_a-4 (worktree-wf_a-4)
kept    .claude/worktrees/wf_a-5 (uncommitted changes)
kept    .claude/worktrees/wf_a-6 (uncommitted changes)
kept    .claude/worktrees/wf_a-7 (uncommitted changes)
kept    .claude/worktrees/wf_a-8 (locked)
kept    .claude/worktrees/wf_a-9 (worktree-wf_a-9 is not merged)
kept    .claude/worktrees/wf_b-1 (detached HEAD is not merged)
kept    .claude/worktrees/wf_b-2 (uncommitted changes)
kept    .claude/worktrees/wf_b-3 (locked)
kept    .claude/worktrees/wf_b-4 (worktree-wf_b-4 is not merged)
kept    .claude/worktrees/wf_b-5 (uncommitted changes)
removed .claude/worktrees/wf_b-6 (detached HEAD)
kept    .claude/worktrees/wf_b-7 (uncommitted changes)
kept    .claude/worktrees/wf_b-8 (uncommitted changes)
kept    .claude/worktrees/wf_b-9 (locked)
removed .claude/worktrees/wf_c-1 (worktree-wf_c-1)
removed .claude/worktrees/wf_c-2 (worktree-wf_c-2)
removed .claude/worktrees/wf_d-1 (worktree-wf_d-1)
kept    .claude/worktrees/wf_d-2 (uncommitted changes)"

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: workflow worktrees case exited $rc"
    fail=1
  fi
  if [ "$out" != "$expected" ]; then
    echo "FAIL: workflow worktrees output mismatch"
    echo "--- expected ---"
    echo "$expected"
    echo "--- actual ---"
    echo "$out"
    fail=1
  fi

  for gone in agent-merged wf_a-1 wf_a-2 wf_a-3 wf_a-4 wf_b-6 wf_c-1 wf_c-2 wf_d-1; do
    assert_dir "$gone" no
  done
  for kept in wf_a-5 wf_a-6 wf_a-7 wf_a-8 wf_a-9 wf_b-1 wf_b-2 wf_b-3 wf_b-4 wf_b-5 wf_b-7 wf_b-8 wf_b-9 wf_d-2; do
    assert_dir "$kept" yes
  done

  for gone in agent-merged-branch worktree-wf_a-1 fix-gr-x worktree-wf_a-4 worktree-wf_c-1 worktree-wf_c-2 worktree-wf_d-1; do
    assert_branch "$gone" no
  done
  for kept in worktree-wf_a-5 worktree-wf_a-6 worktree-wf_a-7 worktree-wf_a-8 worktree-wf_a-9 worktree-wf_b-2 worktree-wf_b-3 worktree-wf_b-4 worktree-wf_b-5 worktree-wf_b-7 worktree-wf_d-2; do
    assert_branch "$kept" yes
  done

  assert_file wf_a-5 notes.md yes
  assert_file wf_a-5 pr-body-gr-x.md yes
  assert_file wf_a-6 pr-body-gr-x.md.orig yes
  assert_modified wf_a-7 note.txt
  assert_file wf_b-2 pr-body-d/x.md yes
  assert_file wf_b-3 notes.md yes
  assert_file wf_b-4 notes.md yes
  assert_file wf_b-4 pr-body-gr-x.md yes
  assert_file wf_b-5 "pr-body-x y.md" yes
  assert_file wf_b-7 newdir/x yes
  assert_file wf_b-8 notes.md yes
  assert_modified wf_d-2 pr-body-u.md

  rm -rf "$d"
}

# ---------------------------------------------------------------------------
# Rows 0, 7 and 8: folders that are not worktrees, a removal that fails, a
# branch delete that fails. Needs a non-root user (chmod a-w must bite).
# ---------------------------------------------------------------------------

test_wf_remove_failures() {
  local d work out rc expected
  if [ "$(id -u)" -eq 0 ]; then
    echo "SKIP: test_wf_remove_failures needs a non-root user"
    return 0
  fi

  d="$(mktemp -d "${TMPDIR:-/tmp}/gr pq3 test.XXXXXXXX")"
  work="$d/work"
  restore_wf_failures() {
    chmod u+w "$work/.claude/worktrees/wf_a-1/d" "$work/.claude/worktrees/wf_a-4/d" 2>/dev/null || true
    rm -f "$work/.git/refs/heads/worktree-wf_a-3.lock"
    rm -rf "$d"
  }
  trap restore_wf_failures EXIT

  git init -q "$work"
  git -C "$work" config user.email "test@example.com"
  git -C "$work" config user.name "Test"
  echo "root" >"$work/README.md"
  git -C "$work" add README.md
  git -C "$work" commit -q -m "root"
  git -C "$work" branch -M main

  add_worktree wf_a-1 worktree-wf_a-1
  wf_custom_commit wf_a-1 d/f
  merge_branch worktree-wf_a-1

  wf_merged wf_a-2 worktree-wf_a-2

  wf_merged wf_a-3 worktree-wf_a-3
  : >"$work/.git/refs/heads/worktree-wf_a-3.lock"

  wf_detached wf_a-4

  mkdir "$work/.claude/worktrees/wf_e-1"
  wf_merged wf_e-10 worktree-wf_e-10
  touch "$work/.claude/worktrees/wf_e-2"

  chmod a-w "$work/.claude/worktrees/wf_a-1/d" "$work/.claude/worktrees/wf_a-4/d"

  out="$(bash "$prune_script" "$work" 2>/dev/null)"
  rc=$?

  expected="kept    .claude/worktrees/wf_a-1 (remove failed)
removed .claude/worktrees/wf_a-2 (worktree-wf_a-2)
removed .claude/worktrees/wf_a-3 (worktree-wf_a-3; branch -D failed)
kept    .claude/worktrees/wf_a-4 (remove failed)
kept    .claude/worktrees/wf_e-1 (not a registered worktree)
removed .claude/worktrees/wf_e-10 (worktree-wf_e-10)
kept    .claude/worktrees/wf_e-2 (not a registered worktree)"

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: remove-failure case exited $rc"
    fail=1
  fi
  if [ "$out" != "$expected" ]; then
    echo "FAIL: remove-failure output mismatch"
    echo "--- expected ---"
    echo "$expected"
    echo "--- actual ---"
    echo "$out"
    fail=1
  fi

  assert_dir wf_a-1 yes
  assert_file wf_a-1 d/f yes
  assert_branch worktree-wf_a-1 yes
  assert_dir wf_a-2 no
  assert_branch worktree-wf_a-2 no
  assert_dir wf_a-3 no
  assert_branch worktree-wf_a-3 yes
  assert_dir wf_a-4 yes
  assert_file wf_a-4 d/f yes
  assert_dir wf_e-1 yes
  assert_dir wf_e-10 no
  assert_branch worktree-wf_e-10 no
  if [ ! -f "$work/.claude/worktrees/wf_e-2" ]; then
    echo "FAIL: expected the plain file wf_e-2 to still exist"
    fail=1
  fi

  out="$(bash "$prune_script" "$work" 2>/dev/null)"
  rc=$?

  expected="kept    .claude/worktrees/wf_a-1 (not a registered worktree)
kept    .claude/worktrees/wf_a-4 (not a registered worktree)
kept    .claude/worktrees/wf_e-1 (not a registered worktree)
kept    .claude/worktrees/wf_e-2 (not a registered worktree)"

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: remove-failure second run exited $rc"
    fail=1
  fi
  if [ "$out" != "$expected" ]; then
    echo "FAIL: remove-failure second run output mismatch"
    echo "--- expected ---"
    echo "$expected"
    echo "--- actual ---"
    echo "$out"
    fail=1
  fi

  restore_wf_failures
  trap - EXIT
}

test_long_history
test_no_remote
test_no_main_ref
test_workflow_worktrees
test_wf_remove_failures

if [ "$fail" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi

echo "OK"
exit 0

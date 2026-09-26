#!/usr/bin/env bash
# Remove Agent-tool worktrees whose branch is merged into main.
#
# Usage: prune-worktrees.sh <repo-root>
#
# For each .claude/worktrees/agent-* worktree, checks in order:
#   1. locked                                         -> kept
#   2. branch not an ancestor of main/origin/main      -> kept (not merged)
#   3. branch tip on the first-parent history of
#      main/origin/main (a fresh branch with no
#      commits of its own)                            -> kept
#   4. uncommitted changes                             -> kept
#   5. otherwise: merged, clean, unlocked              -> removed
set -euo pipefail

root="${1:?usage: prune-worktrees.sh <repo-root>}"
cd "$root"

git fetch -q origin main
shopt -s nullglob

worktree_list="$(git worktree list --porcelain)"

is_locked() {
  local abs="$1"
  printf '%s\n' "$worktree_list" | awk -v p="$abs" '
    $1 == "worktree" { cur = $2 }
    $1 == "locked" && cur == p { print "yes"; exit }
  ' | grep -q yes
}

first_parent_shas="$(git rev-list --first-parent main origin/main)"

on_first_parent_history() {
  local tip="$1"
  printf '%s\n' "$first_parent_shas" | grep -qx "$tip"
}

for path in .claude/worktrees/agent-*; do
  branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
  abs=$(cd "$path" && pwd -P)

  if is_locked "$abs"; then
    echo "kept    $path (locked)"
    continue
  fi

  if ! git merge-base --is-ancestor "$branch" main && ! git merge-base --is-ancestor "$branch" origin/main; then
    echo "kept    $path ($branch is not merged)"
    continue
  fi

  tip=$(git -C "$path" rev-parse HEAD)
  if on_first_parent_history "$tip"; then
    echo "kept    $path ($branch has no commits of its own)"
    continue
  fi

  if [ -n "$(git -C "$path" status --porcelain)" ]; then
    echo "kept    $path (uncommitted changes)"
    continue
  fi

  git worktree remove "$path" && git branch -D "$branch" >/dev/null && echo "removed $path ($branch)"
done

git worktree prune

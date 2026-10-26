#!/usr/bin/env bash
# Remove Agent-tool and Workflow worktrees that are merged into main.
#
# Usage: prune-worktrees.sh <repo-root>
#
# For each .claude/worktrees/agent-* worktree, checks in order:
#   1. locked                                         -> kept
#   2. detached HEAD                                   -> kept
#   3. commit not an ancestor of main/origin/main       -> kept (not merged)
#   4. commit on the first-parent history of
#      main/origin/main (a fresh branch with no
#      commits of its own)                            -> kept
#   5. uncommitted changes                             -> kept
#   6. otherwise: merged, clean, unlocked              -> removed
#
# For each .claude/worktrees/wf_* worktree (printed after the agent-* lines),
# checks in order:
#   0. not a folder, or not a registered worktree      -> kept
#   1. locked                                         -> kept
#   2. branch tip not an ancestor of main/origin/main  -> kept (not merged)
#   3. detached HEAD not an ancestor of them           -> kept (not merged)
#   4. uncommitted changes (an untracked top-level
#      pr-body-*.md does not count)                    -> kept
#   5. otherwise: the pr-body-*.md files are deleted and the worktree is
#      removed, with its branch if it has one. A detached HEAD or a branch
#      with no commits of its own is removed too.
#
# Uses whichever of `main` and `origin/main` exist. With neither, prints one
# line and removes nothing.
set -euo pipefail

root="${1:?usage: prune-worktrees.sh <repo-root>}"
cd "$root"

git fetch -q origin main 2>/dev/null || true
shopt -s nullglob

worktree_list="$(git worktree list --porcelain)"

is_locked() {
  local abs="$1"
  awk -v p="$abs" '
    $1 == "worktree" { cur = substr($0, 10) }
    $1 == "locked" && cur == p { print "yes"; exit }
  ' <<<"$worktree_list" | grep -qx yes
}

refs=()
if git rev-parse --verify -q main >/dev/null 2>&1; then
  refs+=("main")
fi
if git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  refs+=("origin/main")
fi

if [ "${#refs[@]}" -eq 0 ]; then
  echo "no main or origin/main ref found; removed nothing"
  exit 0
fi

first_parent_shas="$(git rev-list --first-parent "${refs[@]}")"

is_ancestor_of_any_ref() {
  local commit="$1" ref
  for ref in "${refs[@]}"; do
    if git merge-base --is-ancestor "$commit" "$ref"; then
      return 0
    fi
  done
  return 1
}

on_first_parent_history() {
  local tip="$1"
  grep -qxF "$tip" <<<"$first_parent_shas"
}

is_registered() { grep -qxF "worktree $1" <<<"$worktree_list"; }

pr_body_untracked='^?? pr-body-[^/]*\.md$'

for path in .claude/worktrees/agent-*; do
  branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
  tip=$(git -C "$path" rev-parse HEAD)
  abs=$(cd "$path" && pwd -P)

  if is_locked "$abs"; then
    echo "kept    $path (locked)"
    continue
  fi

  if [ "$branch" = "HEAD" ]; then
    echo "kept    $path (detached HEAD)"
    continue
  fi

  if ! is_ancestor_of_any_ref "$tip"; then
    echo "kept    $path ($branch is not merged)"
    continue
  fi

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

for path in .claude/worktrees/wf_*; do
  abs="$(pwd -P)/$path"

  if [ ! -d "$path" ] || ! is_registered "$abs"; then
    echo "kept    $path (not a registered worktree)"
    continue
  fi

  branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
  tip=$(git -C "$path" rev-parse HEAD)
  label="$branch"
  [ "$branch" = HEAD ] && label="detached HEAD"

  if is_locked "$abs"; then
    echo "kept    $path (locked)"
    continue
  fi

  if ! is_ancestor_of_any_ref "$tip"; then
    echo "kept    $path ($label is not merged)"
    continue
  fi

  dirty=$(git -C "$path" status --porcelain | grep -v "$pr_body_untracked" || true)
  if [ -n "$dirty" ]; then
    echo "kept    $path (uncommitted changes)"
    continue
  fi

  while IFS= read -r line; do
    rm -f "$path/${line#\?\? }"
  done < <(git -C "$path" status --porcelain | grep "$pr_body_untracked" || true)

  if [ "$branch" = HEAD ]; then
    if git worktree remove "$path"; then
      echo "removed $path (detached HEAD)"
    else
      echo "kept    $path (remove failed)"
    fi
  else
    if git worktree remove "$path"; then
      if git branch -D "$branch" >/dev/null; then
        echo "removed $path ($branch)"
      else
        echo "removed $path ($branch; branch -D failed)"
      fi
    else
      echo "kept    $path (remove failed)"
    fi
  fi
done

git worktree prune

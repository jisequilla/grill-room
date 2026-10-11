#!/usr/bin/env bash
# Checks .claude/skills/run-wave/SKILL.md: the frontmatter, the four failure
# mode lead-ins, and that every repo path the body names exists.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$script_dir/.." && pwd)"
skill="$root/.claude/skills/run-wave/SKILL.md"

fail=0
report() {
  if [ "$1" -eq 0 ]; then echo "ok   $2"; else echo "FAIL $2"; fail=1; fi
}

# one sentence: exactly one "." and it is the last character
description_ok() {
  local d="$1" dots
  dots="$(printf '%s' "$d" | tr -cd '.' | wc -c | tr -d ' ')"
  [ -n "$d" ] && [ "$dots" = 1 ] && [ "${d%.}" != "$d" ]
}

if [ ! -f "$skill" ]; then
  report 1 "skill exists"
  exit 1
fi

# frontmatter
[ "$(sed -n 1p "$skill")" = "---" ] && [ "$(sed -n 2p "$skill")" = "name: run-wave" ] \
  && [ "$(sed -n 3p "$skill" | cut -c1-13)" = "description: " ] && [ "$(sed -n 4p "$skill")" = "---" ]
shape=$?
description="$(sed -n 3p "$skill" | cut -c14-)"
description_ok "$description"
report $((shape + $?)) "frontmatter"

description_ok "Use when two things happen. And a second sentence."
[ $? -ne 0 ]
report $? "frontmatter: two sentences fail"
description_ok "Use when running a wave."
report $? "frontmatter: one sentence passes"

# failure modes
want="$(printf '%s\n' \
  '**zsh does not word-split a variable.**' \
  '**e2e can hang on its own PGlite lock (gr-tte).**' \
  '**Agent replies arrive truncated.**' \
  '**The classifier blocks chained gh writes.**')"
section="$(awk '/^## /{ on = ($0 == "## Failure modes"); next } on' "$skill")"
got="$(printf '%s\n' "$section" | grep '^\*\*')"
[ "$got" = "$want" ]
report $? "failure modes"

# referenced paths
missing=""
while IFS= read -r span; do
  for word in $span; do
    case "$word" in *"<"* | *">"*) continue ;; esac
    case "$word" in
      scripts/* | .claude/*)
        word="$(printf '%s' "$word" | sed 's/[[:punct:]]*$//')"
        [ -e "$root/$word" ] || missing="$missing $word"
        ;;
    esac
  done
done < <(grep -o '`[^`]*`' "$skill" | tr -d '`')
[ -z "$missing" ]
report $? "referenced paths${missing:+ (missing:$missing)}"

exit "$fail"

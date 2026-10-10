#!/usr/bin/env bash
# Format one ticket's non-blocking findings as a nits bead.
#
# Usage: nits-bead.sh <result.json>
#
# <result.json> holds one object from the workflow's returned array, with the
# fields bead, pr and nonBlocking. Line 1 of stdout is the bead title, line 2
# is empty, and each following line is one finding, in the order given.
set -uo pipefail

file="${1:-}"
if [ -z "$file" ]; then
  echo "usage: nits-bead.sh <result.json>" >&2
  exit 1
fi
if [ ! -r "$file" ] || [ -d "$file" ]; then
  echo "nits-bead.sh: cannot read $file" >&2
  exit 1
fi

valid='type == "object"
  and ((.bead | type) == "string") and (.bead | length) > 0
  and .pr != null
  and ((.nonBlocking | type) == "array")'
if ! jq -e "$valid" "$file" >/dev/null 2>&1; then
  echo "nits-bead.sh: $file needs bead, pr and nonBlocking" >&2
  exit 1
fi

if [ "$(jq '.nonBlocking | length' "$file")" -eq 0 ]; then
  echo "no non-blocking findings" >&2
  exit 0
fi

jq -r '
  def flat: if . == null then "" else tostring | gsub("\r\n|\n"; " ") | sub("\\s+$"; "") end;
  "PR #\(.pr) nits: \(.bead)",
  "",
  (.nonBlocking[] |
    ([ "- \(.level | flat)",
       (if .line == null then (.file | flat) else "\(.file | flat):\(.line)" end),
       (.claim | flat) ]
     + (if (.evidence | flat) != "" then ["evidence: `\(.evidence | flat)`"] else [] end)
     + (if (.equivalentMutant | flat) != "" then ["equivalent: `\(.equivalentMutant | flat)`"] else [] end)
     + (if .sentToFix != null then ["addressed in round \(.sentToFix)"] else [] end)
    ) | join(" · "))
' "$file"

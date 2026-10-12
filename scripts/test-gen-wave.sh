#!/usr/bin/env bash
# Exercises scripts/gen-wave.py against throwaway fixture roots, one row per
# line of the ticket's behaviour table, asserting stdout, stderr, exit code and
# whether out.js was written as whole values.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
gen="$script_dir/gen-wave.py"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/gen-wave-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT

fail=0

report() {
  if [ "$1" -eq 0 ]; then echo "ok   $2"; else echo "FAIL $2"; fail=1; fi
}

usage_line='usage: gen-wave.py <spec.json> <out.js> [--root <repo>]'
tdir=".claude/templates/delegation"
wfile=".claude/workflows/ticket-build-review-loop.js"

mkfx() {
  mkdir -p "$1/$tdir" "$1/.claude/workflows"
  printf '%s' 'B {{bead}}|{{title}}|{{ticket}}' >"$1/$tdir/builder.md"
  printf '%s' 'R {{lens}}|{{ticket}}|{{pr}}' >"$1/$tdir/reviewer.md"
  printf '%s' 'F {{bead}}|{{ticket}}|{{branch}}' >"$1/$tdir/fix.md"
  printf "export const meta = {\n  name: 'x',\n}\nconst results = await pipeline(\n  args,\n  work,\n)\n" >"$1/$wfile"
}

printf 'T1' >"$tmp/t1.md"
printf 'T2' >"$tmp/t2.md"
fx="$tmp/fx"
mkfx "$fx"
out_js="$tmp/out.js"
spec="$tmp/spec.json"

# run <args...>: sets out, err, code; removes out.js first
run() {
  rm -f "$out_js"
  out="$(python3 "$gen" "$@" 2>"$tmp/err")"; code=$?
  err="$(cat "$tmp/err")"
}

# fails <expected stderr> <name>: exit 1, empty stdout, out.js absent
fails() {
  [ "$code" -eq 1 ] && [ "$err" = "$1" ] && [ -z "$out" ] && [ ! -e "$out_js" ]
  report $? "$2"
}

wave_text() { # <json list>
  printf "export const meta = {\n  name: 'x',\n}\n\nconst WAVE_ARGS = %s\nconst results = await pipeline(\n  WAVE_ARGS,\n  work,\n)\n" "$1"
}

check_out() { # <name> <expected file content>
  [ "$code" -eq 0 ] && [ -z "$err" ] && [ "$(cat "$out_js")" = "$2" ]
  report $? "$1"
}

# single ticket
printf '[{"bead":"gr-a","ticket":"%s","title":"Title A","lenses":["lensX"]}]' "$tmp/t1.md" >"$spec"
run "$spec" "$out_js" --root "$fx"
single_json='[{"bead": "gr-a", "builder": "B gr-a|Title A|T1", "reviewers": ["R lensX|T1|{{pr}}"], "fix": "F gr-a|T1|{{branch}}"}]'
check_out "single ticket" "$(wave_text "$single_json")"
cp "$out_js" "$tmp/first-out.js"

# workflow rewrite
[ "$(sed -n 6,7p "$out_js")" = "$(printf 'const results = await pipeline(\n  WAVE_ARGS,')" ] && ! grep -qx '  args,' "$out_js" && [ "$(sed -n 4p "$out_js")" = "" ]
report $? "workflow rewrite"

# spec order and summary
printf '[{"bead":"gr-z","ticket":"%s","title":"Z","lenses":["L2","L1"]},{"bead":"gr-a","ticket":"%s","title":"A","lenses":["L"]}]' "$tmp/t1.md" "$tmp/t2.md" >"$spec"
run "$spec" "$out_js" --root "$fx"
want_json='[{"bead": "gr-z", "builder": "B gr-z|Z|T1", "reviewers": ["R L2|T1|{{pr}}", "R L1|T1|{{pr}}"], "fix": "F gr-z|T1|{{branch}}"}, {"bead": "gr-a", "builder": "B gr-a|A|T2", "reviewers": ["R L|T2|{{pr}}"], "fix": "F gr-a|T2|{{branch}}"}]'
[ "$code" -eq 0 ] && [ "$(cat "$out_js")" = "$(wave_text "$want_json")" ]
report $? "spec order"
[ "$(sed -n 5p "$out_js" | grep -o '"reviewers": \["R L2[^]]*\]' | head -1)" = '"reviewers": ["R L2|T1|{{pr}}", "R L1|T1|{{pr}}"]' ]
report $? "lens order"
[ "$out" = "wrote $out_js: gr-z=2 gr-a=1" ] && [ -z "$err" ]
report $? "summary"

# options after or before positionals
run --root "$fx" "$spec" "$out_js"
[ "$code" -eq 0 ] && [ "$(cat "$out_js")" = "$(wave_text "$want_json")" ]
report $? "root before positionals"

# anchors
printf '[{"bead":"gr-a","ticket":"%s","title":"A","lenses":["L"]}]' "$tmp/t1.md" >"$spec"
fx2="$tmp/fx-noargs"; mkfx "$fx2"
printf "export const meta = {\n}\nconst results = await pipeline(\n  other,\n)\n" >"$fx2/$wfile"
run "$spec" "$out_js" --root "$fx2"
fails "gen-wave.py: $fx2/$wfile has no \"  args,\" line after \"await pipeline(\"" "missing anchor"

printf "export const meta = {\n}\nconst results = 1\n" >"$fx2/$wfile"
run "$spec" "$out_js" --root "$fx2"
fails "gen-wave.py: $fx2/$wfile has no \"  args,\" line after \"await pipeline(\"" "no pipeline line"

# anchor beats a missing ticket
printf "export const meta = {\n}\nconst results = await pipeline(\n  other,\n)\n" >"$fx2/$wfile"
printf '[{"bead":"gr-a","ticket":"%s/nope.md","title":"A","lenses":["L"]}]' "$tmp" >"$spec"
run "$spec" "$out_js" --root "$fx2"
fails "gen-wave.py: $fx2/$wfile has no \"  args,\" line after \"await pipeline(\"" "anchor before ticket"

# missing ticket
run "$spec" "$out_js" --root "$fx"
fails "gen-wave.py: cannot read $tmp/nope.md" "missing ticket"

printf '[{"bead":"gr-a","ticket":"%s/nope1.md","title":"A","lenses":["L"]},{"bead":"gr-b","ticket":"%s/nope2.md","title":"B","lenses":["L"]}]' "$tmp" "$tmp" >"$spec"
run "$spec" "$out_js" --root "$fx"
fails "gen-wave.py: cannot read $tmp/nope1.md" "first unreadable ticket"

# spec entry checks
entry_err() { echo "gen-wave.py: spec entry $1 needs bead, ticket, title and lenses"; }
t1="$tmp/t1.md"
spec_row() { # <name> <spec json> <expected stderr>
  printf '%s' "$2" >"$spec"
  run "$spec" "$out_js" --root "$fx"
  fails "$3" "$1"
}
spec_row "missing lenses" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\"}]" "$(entry_err 0)"
spec_row "empty lenses" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":[\"L\"]},{\"bead\":\"gr-b\",\"ticket\":\"$t1\",\"title\":\"B\",\"lenses\":[]}]" "$(entry_err 1)"
spec_row "empty lenses before missing ticket" "[{\"bead\":\"gr-a\",\"ticket\":\"$tmp/nope.md\",\"title\":\"A\",\"lenses\":[\"L\"]},{\"bead\":\"gr-b\",\"ticket\":\"$t1\",\"title\":\"B\",\"lenses\":[]}]" "$(entry_err 1)"
spec_row "missing bead" "[{\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "missing ticket field" "[{\"bead\":\"gr-a\",\"title\":\"A\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "missing title" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "lenses string" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":\"lensX\"}]" "$(entry_err 0)"
spec_row "entry not an object" "[1]" "$(entry_err 0)"
spec_row "empty bead" "[{\"bead\":\"\",\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "lenses of numbers" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":[1]}]" "$(entry_err 0)"
spec_row "empty title" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "empty ticket" "[{\"bead\":\"gr-a\",\"ticket\":\"\",\"title\":\"A\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "non-string title" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":5,\"lenses\":[\"L\"]}]" "$(entry_err 0)"
spec_row "non-string ticket" "[{\"bead\":\"gr-a\",\"ticket\":5,\"title\":\"A\",\"lenses\":[\"L\"]}]" "$(entry_err 0)"

# model: optional, sonnet or opus, copied as the wave entry's last key
model_err() { echo "gen-wave.py: spec entry $1 model must be sonnet or opus"; }
model_spec() { # <model json fragment, empty for none>
  printf '[{"bead":"gr-a","ticket":"%s","title":"Title A","lenses":["lensX"]%s}]' "$t1" "$1" >"$spec"
  run "$spec" "$out_js" --root "$fx"
}
model_json() { # <model json fragment, empty for none>
  printf '[{"bead": "gr-a", "builder": "B gr-a|Title A|T1", "reviewers": ["R lensX|T1|{{pr}}"], "fix": "F gr-a|T1|{{branch}}"%s}]' "$1"
}
model_spec ""
check_out "model absent" "$(wave_text "$(model_json "")")"
model_spec ',"model":"opus"'
check_out "model opus" "$(wave_text "$(model_json ', "model": "opus"')")"
model_spec ',"model":"sonnet"'
check_out "model sonnet" "$(wave_text "$(model_json ', "model": "sonnet"')")"
model_row() { # <name> <model json value>
  model_spec ",\"model\":$2"
  fails "$(model_err 0)" "$1"
}
model_row "model haiku" '"haiku"'
model_row "model empty" '""'
model_row "model number" '5'
model_row "model null" 'null'
model_row "model list" '[]'
model_row "model object" '{}'
spec_row "model error index" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":[\"L\"]},{\"bead\":\"gr-b\",\"ticket\":\"$t1\",\"title\":\"B\",\"lenses\":[\"L\"],\"model\":\"x\"}]" "$(model_err 1)"
spec_row "model check after entry check" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\",\"model\":\"x\"}]" "$(entry_err 0)"
spec_row "model order across entries" "[{\"bead\":\"gr-a\",\"ticket\":\"$t1\",\"title\":\"A\",\"lenses\":[\"L\"],\"model\":\"x\"},{\"bead\":\"gr-b\",\"ticket\":\"$t1\",\"title\":\"B\"}]" "$(model_err 0)"

# spec file problems
run "$tmp/no-such-spec.json" "$out_js" --root "$fx"
fails "gen-wave.py: cannot read $tmp/no-such-spec.json" "missing spec"
printf 'not json' >"$spec"
run "$spec" "$out_js" --root "$fx"
fails "gen-wave.py: $spec is not valid JSON" "invalid JSON"
printf '{"bead": "gr-a"}' >"$spec"
run "$spec" "$out_js" --root "$fx"
fails "gen-wave.py: $spec must be a list" "spec not a list"
printf '[]' >"$spec"
run "$spec" "$out_js" --root "$fx"
fails "gen-wave.py: $spec has no entries" "empty list"

# missing templates and workflow
printf '[{"bead":"gr-a","ticket":"%s","title":"A","lenses":["L"]}]' "$t1" >"$spec"
for name in builder reviewer fix; do
  fx3="$tmp/fx-no-$name"; mkfx "$fx3"; rm "$fx3/$tdir/$name.md"
  run "$spec" "$out_js" --root "$fx3"
  fails "gen-wave.py: cannot read $fx3/$tdir/$name.md" "missing template $name"
done
fx3="$tmp/fx-nowf"; mkfx "$fx3"; rm "$fx3/$wfile"
run "$spec" "$out_js" --root "$fx3"
fails "gen-wave.py: cannot read $fx3/$wfile" "missing workflow"

# read order: templates, workflow, tickets
printf '[{"bead":"gr-a","ticket":"%s/nope.md","title":"A","lenses":["L"]}]' "$tmp" >"$spec"
fx3="$tmp/fx-order1"; mkfx "$fx3"; rm "$fx3/$tdir/builder.md"
run "$spec" "$out_js" --root "$fx3"
fails "gen-wave.py: cannot read $fx3/$tdir/builder.md" "read order: template before ticket"
fx3="$tmp/fx-order2"; mkfx "$fx3"; rm "$fx3/$tdir/builder.md" "$fx3/$tdir/fix.md"
run "$spec" "$out_js" --root "$fx3"
fails "gen-wave.py: cannot read $fx3/$tdir/builder.md" "read order: builder before fix"
fx3="$tmp/fx-order3"; mkfx "$fx3"; rm "$fx3/$wfile"
run "$spec" "$out_js" --root "$fx3"
fails "gen-wave.py: cannot read $fx3/$wfile" "read order: workflow before ticket"

# roots used as given
printf '[{"bead":"gr-a","ticket":"%s","title":"A","lenses":["L"]}]' "$t1" >"$spec"
fx3="$tmp/fx-slash"; mkfx "$fx3"; rm "$fx3/$tdir/builder.md"
run "$spec" "$out_js" --root "$fx3/"
fails "gen-wave.py: cannot read $fx3/$tdir/builder.md" "trailing slash root"
mkdir -p "$tmp/x"
run "$spec" "$out_js" --root "$tmp/x/../fx-slash"
fails "gen-wave.py: cannot read $tmp/x/../fx-slash/$tdir/builder.md" "unnormalised root"

# usage
usage_row() { # <name> <args...>
  local name="$1"; shift
  run "$@"
  fails "$usage_line" "$name"
}
usage_row "usage one argument" "$spec"
usage_row "usage three positionals" "$spec" "$out_js" "$tmp/extra"
usage_row "usage root without value" "$spec" "$out_js" --root
usage_row "usage unknown flag" "$spec" "$out_js" --bogus

# relative ticket path is read from the current directory
mkdir -p "$tmp/rel"
printf 'T1' >"$tmp/rel/t1.md"
printf '[{"bead":"gr-a","ticket":"t1.md","title":"Title A","lenses":["lensX"]}]' >"$spec"
rm -f "$out_js"
(cd "$tmp/rel" && python3 "$gen" "$spec" "$out_js" --root "$fx" >/dev/null 2>"$tmp/err"); code=$?
[ "$code" -eq 0 ] && cmp -s "$out_js" "$tmp/first-out.js"
report $? "relative ticket from current directory"

# default root
fxd="$tmp/fx-default"; mkfx "$fxd"; mkdir "$fxd/scripts"; cp "$gen" "$fxd/scripts/gen-wave.py"
printf '[{"bead":"gr-a","ticket":"%s","title":"Title A","lenses":["lensX"]}]' "$t1" >"$spec"
rm -f "$out_js"
python3 "$fxd/scripts/gen-wave.py" "$spec" "$out_js" >/dev/null 2>"$tmp/err"; code=$?
[ "$code" -eq 0 ] && cmp -s "$out_js" "$tmp/first-out.js"
report $? "default root"

# seam: the saved workflow still has the anchors the script needs
rm -f "$out_js"
python3 "$gen" "$spec" "$out_js" --root "$repo_root" >/dev/null 2>"$tmp/err"; code=$?
[ "$code" -eq 0 ] \
  && [ "$(awk '/await pipeline\(/ { getline; print; exit }' "$out_js")" = "  WAVE_ARGS," ] \
  && grep -q '^const WAVE_ARGS = ' "$out_js"
report $? "real workflow anchors"

exit "$fail"

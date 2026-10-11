#!/usr/bin/env bash
# Exercises scripts/nits-bead.sh: one throwaway input per row of the ticket's
# two behaviour tables, asserting exact stdout (and stderr and exit code for
# the call table).
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nits="$script_dir/nits-bead.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/nits-bead-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT

fail=0
n=0

report() {
  if [ "$1" -eq 0 ]; then echo "ok   $2"; else echo "FAIL $2"; fail=1; fi
}

# stdout_matches <actual file> <expected text>: byte-exact, so a trailing blank
# line is a mismatch. Empty expected text means empty stdout.
stdout_matches() {
  local want="$tmp/want"
  if [ -z "$2" ]; then : >"$want"; else printf '%s\n' "$2" >"$want"; fi
  cmp -s "$1" "$want"
}

# entry_row <name> <entry json> <expected line>
entry_row() {
  n=$((n + 1))
  local f="$tmp/entry-$n.json" err code
  printf '{"bead":"gr-t.1","pr":1,"nonBlocking":[%s]}' "$2" >"$f"
  "$nits" "$f" >"$tmp/out" 2>"$tmp/err"; code=$?
  err="$(cat "$tmp/err")"
  stdout_matches "$tmp/out" "$(printf 'PR #1 nits: gr-t.1\n\n%s' "$3")" && [ -z "$err" ] && [ "$code" -eq 0 ]
  report $? "entry: $1"
}

# call_row <name> <file or ''> <expected stdout> <expected stderr> <expected exit>
call_row() {
  local err code
  if [ -z "$2" ]; then
    "$nits" >"$tmp/out" 2>"$tmp/err"; code=$?
  else
    "$nits" "$2" >"$tmp/out" 2>"$tmp/err"; code=$?
  fi
  err="$(cat "$tmp/err")"
  stdout_matches "$tmp/out" "$3" && [ "$err" = "$4" ] && [ "$code" -eq "$5" ]
  report $? "call: $1"
}

E1='{"level":"nit","file":"server/x.ts","line":12,"claim":"Rename q to query"}'
E2='{"level":"nit","file":"README.md","line":null,"claim":"Typo in heading"}'

entry_row "nit with line" "$E1" '- nit · server/x.ts:12 · Rename q to query'
entry_row "null line" "$E2" '- nit · README.md · Typo in heading'
entry_row "should-fix with evidence" '{"level":"should-fix","file":"server/y.ts","line":40,"claim":"Null id crashes","evidence":"pnpm exec vitest --run y.test.ts"}' '- should-fix · server/y.ts:40 · Null id crashes · evidence: `pnpm exec vitest --run y.test.ts`'
entry_row "empty evidence" '{"level":"should-fix","file":"server/y.ts","line":41,"claim":"No guard","evidence":""}' '- should-fix · server/y.ts:41 · No guard'
entry_row "nit with evidence" '{"level":"nit","file":"b.ts","line":7,"claim":"Weak name","evidence":"grep -n foo b.ts"}' '- nit · b.ts:7 · Weak name · evidence: `grep -n foo b.ts`'
entry_row "sentToFix" '{"level":"should-fix","file":"c.ts","line":9,"claim":"Off by one","evidence":"pnpm exec vitest --run c.test.ts","sentToFix":1}' '- should-fix · c.ts:9 · Off by one · evidence: `pnpm exec vitest --run c.test.ts` · addressed in round 1'
entry_row "equivalent mutant" '{"level":"nit","file":"a.ts","line":3,"claim":"Mutant kept","evidence":"pnpm test:mutate --mutate a.ts:3-3","equivalentMutant":"x > 0 → x >= 0: x is never 0","sentToFix":2}' '- nit · a.ts:3 · Mutant kept · evidence: `pnpm test:mutate --mutate a.ts:3-3` · equivalent: `x > 0 → x >= 0: x is never 0` · addressed in round 2'
entry_row "newline in claim" '{"level":"nit","file":"d.ts","line":2,"claim":"First\nsecond"}' '- nit · d.ts:2 · First second'
entry_row "double newline" '{"level":"nit","file":"f.ts","line":6,"claim":"A\n\nB"}' '- nit · f.ts:6 · A  B'
entry_row "CRLF" '{"level":"nit","file":"h.ts","line":1,"claim":"A\r\nB"}' '- nit · h.ts:1 · A B'
entry_row "trailing newline" '{"level":"nit","file":"i.ts","line":2,"claim":"Tail\n"}' '- nit · i.ts:2 · Tail'
entry_row "newline in evidence" '{"level":"should-fix","file":"j.ts","line":5,"claim":"Split","evidence":"a\nb"}' '- should-fix · j.ts:5 · Split · evidence: `a b`'
entry_row "blocker passed by mistake" '{"level":"blocker","file":"g.ts","line":8,"claim":"Passed by mistake"}' '- blocker · g.ts:8 · Passed by mistake'
entry_row "absent keys" '{"level":"nit","file":"e.ts","line":4,"claim":"Absent keys"}' '- nit · e.ts:4 · Absent keys'

entry_row "empty claim" '{"level":"nit","file":"e.ts","line":4,"claim":""}' '- nit · e.ts:4'
entry_row "null claim" '{"level":"nit","file":"e.ts","line":4,"claim":null}' '- nit · e.ts:4'
entry_row "absent claim" '{"level":"nit","file":"e.ts","line":4}' '- nit · e.ts:4'
entry_row "whitespace claim" '{"level":"nit","file":"e.ts","line":4,"claim":"  "}' '- nit · e.ts:4'
entry_row "empty claim with evidence and sentToFix" '{"level":"should-fix","file":"e.ts","line":4,"claim":"","evidence":"cmd","sentToFix":1}' '- should-fix · e.ts:4 · evidence: `cmd` · addressed in round 1'
entry_row "claim present" '{"level":"nit","file":"e.ts","line":4,"claim":"Rename q"}' '- nit · e.ts:4 · Rename q'
entry_row "newline in file with line" '{"level":"nit","file":"dir\nx.ts","line":3,"claim":"c"}' '- nit · dir x.ts:3 · c'
entry_row "newline in file with null line" '{"level":"nit","file":"x\ny.md","line":null,"claim":"c"}' '- nit · x y.md · c'
entry_row "newline in equivalentMutant" '{"level":"nit","file":"a.ts","line":3,"claim":"c","equivalentMutant":"p\nq"}' '- nit · a.ts:3 · c · equivalent: `p q`'
entry_row "newline-only equivalentMutant" '{"level":"nit","file":"a.ts","line":3,"claim":"c","equivalentMutant":"\n"}' '- nit · a.ts:3 · c'

two="$tmp/two.json"
printf '{"bead":"gr-abc.1","pr":190,"nonBlocking":[%s,%s]}' "$E1" "$E2" >"$two"
call_row "two entries" "$two" "$(printf 'PR #190 nits: gr-abc.1\n\n- nit · server/x.ts:12 · Rename q to query\n- nit · README.md · Typo in heading')" "" 0

order="$tmp/order.json"
printf '{"bead":"gr-o.1","pr":2,"nonBlocking":[{"level":"should-fix","file":"z.ts","line":30,"claim":"c1"},{"level":"nit","file":"a.ts","line":5,"claim":"c2"},{"level":"should-fix","file":"m.ts","line":17,"claim":"c3"}]}' >"$order"
call_row "order kept" "$order" "$(printf 'PR #2 nits: gr-o.1\n\n- should-fix · z.ts:30 · c1\n- nit · a.ts:5 · c2\n- should-fix · m.ts:17 · c3')" "" 0

empty="$tmp/empty-nb.json"
printf '{"bead":"gr-abc.1","pr":190,"nonBlocking":[]}' >"$empty"
call_row "empty nonBlocking" "$empty" "" "no non-blocking findings" 0

call_row "no argument" "" "" "usage: nits-bead.sh <result.json>" 1
call_row "missing file" "/nope.json" "" "nits-bead.sh: cannot read /nope.json" 1

bad_row() {
  local f="$tmp/bad-$1.json"
  printf '%s' "$2" >"$f"
  call_row "$3" "$f" "" "nits-bead.sh: $f needs bead, pr and nonBlocking" 1
}
bad_row 1 'not json' "not json"
bad_row 2 '{"bead":"gr-abc.1","nonBlocking":[]}' "no pr"
bad_row 3 '{"pr":190,"nonBlocking":[]}' "no bead"
bad_row 4 '{"bead":"","pr":190,"nonBlocking":[]}' "empty bead"
bad_row 5 '' "empty file"
bad_row 6 '{"bead":"gr-abc.1","pr":190}' "no nonBlocking"
bad_row 7 '{"bead":"gr-abc.1","pr":190,"nonBlocking":"x"}' "nonBlocking string"

# harness: trailing blank line is detected
blank="$tmp/blank-wrapper.sh"
printf '#!/usr/bin/env bash\n"%s" "$@"; echo\n' "$nits" >"$blank"
chmod +x "$blank"
printf '{"bead":"gr-t.1","pr":1,"nonBlocking":[%s]}' "$E1" >"$tmp/blank.json"
"$blank" "$tmp/blank.json" >"$tmp/blank-out" 2>/dev/null
stdout_matches "$tmp/blank-out" "$(printf 'PR #1 nits: gr-t.1\n\n- nit · server/x.ts:12 · Rename q to query')"
[ $? -ne 0 ]
report $? "harness: trailing blank line is detected"

exit "$fail"

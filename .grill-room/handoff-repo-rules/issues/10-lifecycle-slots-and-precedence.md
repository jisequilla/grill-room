# 10 Render repository delegation values, pending proposals and the precedence line in HANDOFF

Status: ready-for-agent
Blocked by: 02, 08
Bead: `gr-c0t.33`

## What to build

In `grill-room/server/handoff.ts`, keep the embedded lifecycle whole in both recipes and make four named slots take stored values (storage from ticket 2):

- **In-flight cap**: already reads `maxTicketsInFlight`; add the citation when the cap was confirmed from the repository.
- **Prune command**: the confirmed repository command replaces the fixed `git worktree remove` / `git worktree prune` text wherever the recipes name it.
- **Review rule**: the confirmed rule is cited in the review section.
- **Pre-flight procedure**: once confirmed, a cited pointer to the repository's own procedure replaces the embedded pre-flight prompt from ticket 8. Until confirmed, the embedded prompt renders.

For each slot with a pending, unconfirmed proposal, render the built-in default plus one line naming the proposed value and its citation.

Also render:

- one precedence line saying the repository's rule wins where HANDOFF differs, citing the file or files the confirmed or proposed delegation values were cited from;
- when the latest accepted grounding read the rule sources and proposed no delegation values, and none are confirmed, one line saying no repository delegation rules were found, and no precedence line. Before any grounding has read the rule sources, render neither line: "none found" must never stand for "not read".

Only values and citations are rendered; rule text is never copied into HANDOFF. The two delivery recipes are otherwise untouched. Update the out-of-scope line in `.grill-room/handoff-scout/spec.md` to the new boundary: HANDOFF takes named values from repository rules and cites them, and rule text is still never copied.

## How it will be judged

In `grill-room/server/handoff.test.ts`, for both recipes:

- each slot renders its default with no stored value, its confirmed value when confirmed, and the default plus the pending-proposal line when proposed but unconfirmed;
- the confirmed prune command replaces every occurrence of the default prune text;
- a confirmed pre-flight pointer replaces the embedded prompt, so only one pre-flight procedure is on the page; with pre-flight switched off neither renders;
- the precedence line cites exactly the files the values came from;
- the no-rules line appears only after a grounding that read the rule sources found no delegation values; with no grounding yet, neither the no-rules line nor the precedence line renders;
- the same stored inputs render the same text twice.

The handoff snapshot is updated.

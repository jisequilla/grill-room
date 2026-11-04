# 03 Readiness takes depth; Sharpening takes depth and level

Status: ready-for-agent
Blocked by: 01
Implements: user stories 22, 28, 34, 36, 54
Implements decisions: `readiness-reads-depth`, `readiness-warns-never-blocks`, `readiness-only-before-first-round`, `sharpening-pre-round-one-in-session`, `when-a-depth-change-during-sharpening-re-9a07c0e6`, `do-sharpening-s-cards-also-take-the-owne-7e84439c`, `for-migrated-sessions-whose-readiness-ju-f836229c`

Give `grill-room/server/readiness.ts` a `depth` input. The prompt states the depth and the bar per step: proof of concept needs only a clear thing to try; first working version needs the user and the core flows; full spec keeps today's bar. The stored judgment records the `depth` it was made at. `grill-room/actions/assess-readiness.ts` reads the session's depth and passes it. Readiness still warns, never blocks, and is only requested before round 1. `grill-room/app/components/workspace/readiness-panel.tsx` shows 'judged before depth existed' when the field is empty.

`grill-room/server/sharpening.ts` receives the same depth and the owner's technical level (live via `getTechnicalLevel`, default `DEFAULT_TECHNICAL_LEVEL`) and applies the same wording and recommendation rules as the grill (see ticket 6's level section; share the prompt fragment). When a re-judge arriving during Sharpening finds the idea ready, Sharpening lets its open round finish and then stops.

Judged by: extend `grill-room/server/readiness.test.ts` so the same thin idea is ready at proof-of-concept and not ready at full spec and the judgment carries depth; `grill-room/server/sharpening.test.ts` shows level in the Sharpening prompt and the open round completing with no further round after a ready judgment; `grill-room/app/components/workspace/readiness-panel.test.tsx` covers the empty-depth label.
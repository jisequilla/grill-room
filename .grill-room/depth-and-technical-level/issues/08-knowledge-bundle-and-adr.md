# 08 Record the decisions in the knowledge bundle and an ADR

Status: ready-for-agent
Blocked by: none
Implements decisions: `scope-use-case-is-capture-point`, `one-idea-owner-technical-level-trait`, `profile-table-shape`, `depth-cadence`

Update `knowledge/product/use-cases/readiness/scope-how-deep-to-grill.md` to built: depth per session with three steps, level per owner with three values, skip defaults, the setup step before readiness, Sharpening pitched to both, and depth editable after done with the proposal withdrawn and artifacts marked stale. Update `knowledge/product/roles/idea-owner.md` with the three levels. Add decision records in `knowledge/interview/decisions/` in the style of `readiness-opens-the-interview.md`: owner profile keyed by the auth user id with no level on sessions; depth per session re-judging readiness before round 1 (override cleared, queued latest-wins, Sharpening finishes its round). Add `knowledge/interview/language/depth.md` and `technical-level.md`, linked from `knowledge/interview/index.md`. Add `docs/adr/0003-owner-profile-keyed-by-auth-user.md` following `docs/adr/0001-mutation-gate-on-evidence-covered-lines.md`. Use 'readiness', never 'preflight'.

Judged by: manifests list the new files and the repo's okf lint passes.
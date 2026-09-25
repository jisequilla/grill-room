# Grill Room and the SDLC artifact chain

What Grill Room should produce, what it should read before it produces it, and where it stops.

## Sources

- Anthropic's *AI-native SDLC playbook* (academy.claude.com, `/courses/ai-native-sdlc-playbook/`), read from the lessons themselves: capture-intent, requirements-and-design, plan-mode, give-claude-a-feedback-loop, ai-in-the-pr-review-loop, closing-the-loop-on-metrics. A video summary (YouTube `6CaQ9ZFuuKI`) pointed at it; nothing below rests on the video.
- Issue #11 on `jisequilla/grill-room`: a turn-visibility proposal grilled in Grill Room by a second user, checked against the code.
- A review of the "Agent Observability" export by the Claude Code session working in `ngine-monitor`, the repo the session was meant for. It read the bundle against the real code and changed nothing.

## The playbook's chain

Six stages, each ending in a committed artifact whose commit starts the next stage: `intent.md` (why; the product owner accepts or rejects) → `spec.md` (what; flagged concerns resolved before engineering sees it) → `plan.md` (files that change, order of work, risks, proof; written in plan mode after reading the codebase) → PR reviewed against `REVIEW.md` (bugs, security, and compliance with spec and plan) → deploy → a breach, ticket or incident writes a new `intent.md`, and the loop feeds itself.

The playbook's Stage 1 already describes the grilling interview: Claude "asks the questions an analyst would ask" until the idea is concrete.

## Principle: judgment and evidence

The chain holds two kinds of artifact.

- **Judgment** records why, what and how, and who agreed. Each has a human gate.
- **Evidence** records what happened: test output, a diff, a PR, a build log. The toolchain produces it; nobody authors it.

Grill Room is a decision workspace. It produces judgment artifacts and ingests evidence; it never fabricates evidence. It already owns the gates: readiness, the done gate and confirmation, export.

## What the ngine-monitor review measured

The export held 86 user stories, a spec and 18 tickets. The interviewer never saw the repo.

**The what survived.** About 25 stories shipped close to verbatim. Testing Decisions, Out of Scope and the evolution-agent guardrails were reused as written. The wave-and-dependency shape was right in principle.

**The how did not.**

- Already built: 4 tickets duplicated existing work (TimescaleDB since the first migration, TTL pricing fixed in NMON-013, secret masking, most of the dashboard as the Cockpit).
- Contradicted: the broker (RabbitMQ fanout, Redis rejected in NMON-001, so ticket 09's replay cursor is impossible), an imaginary collector service, a price table overturning NMON-009, host-as-identity rejected in NMON-014, retention, database exposure, an opt-out that never existed.
- Delegable as written: 0 of 18. Every brief's File boundaries and Codebase facts slots were empty (`grill-room/server/handoff.ts` leaves them for a human). The verify command skipped the only suite that runs migrations. The handoff's worktree and `gh pr` workflow is this repository's own and failed in a repo with no remote.

The peer rebuilt the reconciliation by hand with three agents, then planned three milestones from the harvested stories instead of executing the tickets.

The peer's minimum pre-read for an interviewer on that repo: `CLAUDE.md`, `docs/decisions/*`, the schema (`init/*.sql`), the event schema doc, `.claude/rules/*`, the `justfile`, and `git remote -v`.

## What issue #11 confirmed

A second user ran Grill Room on Grill Room (Opus, docs folder `.scratch/grill-room/`) and proposed making every model turn visible: a turn record with runs and attempts, 8 tickets. They flagged the one assumption themselves: the interviewer read the spec, not the code. Checked against the code, the retry model held (3 attempts, only tree-rule refusals retry, `rate-limited` and `malformed-output` stop the turn, the resume fallback hidden inside the adapter). The spec's gaps came from what docs mode could see:

- It named four turn kinds; six callers run through `askUntilAccepted`. `assess-readiness` and the supersession check lived outside the docs folder.
- It introduced a turn record without relating it to the turn state the session row already holds (`turnStatus`, `turnErrorCode`, `turnStartedAt`).

A different user, a different project, the same failure: the interview is only as grounded as what it can read.

## Conclusion

Grilling without the repo is sound for intent and stories and unsound for design and tickets. The missing piece is not an artifact at the end but a grounding stage in the middle.

## The chain for Grill Room

| Stage | Artifact | Gate | Today |
|---|---|---|---|
| Intent | `intent.md`: the idea in the user's words, the readiness verdict, a summary of the scout report | Starting the interview | Exported, rendered from the stored idea, readiness and scout report |
| Grounding | Scout report at a HEAD commit: current state (built, partial, gap) and proposed repo decisions, every item cited | Operator reviews the report during readiness | None |
| Grilling | The decision tree, seeded with the confirmed repo decisions; `decisions.md` records each decision's origin and citation | Done gate and confirmation | Exported as `decisions.md`; the next scout reads it as recorded decisions, and a Supersedes entry retires the source it quotes |
| Spec | `spec.md`, listing every repo decision the interview reopened | Confirmation | Spec exists; overturned decisions are invisible |
| Plan | Tickets and briefs with File boundaries, Codebase facts and acceptance evidence (suite and scenario) filled and cited | Export | Tickets, waves, HANDOFF.md and briefs; the code slots are left for a human |
| Delivery | Handoff workflow rendered from the project's delivery mode, plus the project's own cited rules | Export | This repository's workflow, pasted |
| Outcome | A follow-up session opened from a build record or ticket | Starting the follow-up | Build records logged and summarized; nothing reads them |

## Decisions

**Grounding runs at readiness, whenever the session has a project.** The order is server facts, then the scout, then the readiness judge reading the scout report, then the operator's review. A session with no project keeps today's readiness unchanged. The scout report is its own artifact beside the idea, never merged into it: the idea stays in the user's words, and every piece of evidence names its source (the user said, or the repo shows at a path and line). This is the same line gr-htk draws for the goal sentence.

**Deterministic facts come from the server, judgment from the scout.** The server collects the HEAD commit, `git remote -v`, whether `CLAUDE.md`, a decisions folder or `.claude/rules/` exist, and the tracker's open items, through `server/git.ts`. The scout reads what only a model can: what exists relative to this idea, and which decisions constrain it.

**The scout is one more interviewer request kind**, like `assess-readiness`, sharing the turn lock, retries, schema validation and the fake interviewer. It uses docs mode's read-only Read, Glob and Grep with the project root as the folder, and it denies `.env*` and credential files. It always runs on `sonnet`, per the fact-finding rule, and its report records the model. The session's model lock covers interview turns only, so the per-session model comparison stays intact.

**Repo decisions enter the tree as settled nodes; current state stays context.** A settled node marked as coming from the repo carries its citation. The interviewer cannot contradict it; changing it is a reopen, and the reopen machinery marks its dependents stale. Current state (what is built, partial, missing) reaches the interviewer and the readiness judge as context and never becomes nodes. This is how "overturned NMON-009 without saying so" becomes impossible: overturning is a reopen, and the spec lists it.

**The scout proposes, the operator confirms.** It proposes only the decisions bearing on this idea, each with a one-line reason. The operator keeps or drops each one during the readiness review; dropped decisions still reach the interviewer as context, unenforced.

**Decisions are recorded or inferred.** The scout reads docs and code alike and labels each proposal: recorded (an ADR, `CLAUDE.md`, a rules file) or inferred (code or config, such as the database image in `docker-compose.yml`), each cited to a line. There is no per-convention parser. Confirming an inferred decision is often the first time it is written down.

**Drift warns; a re-scout reopens.** The report is tied to its HEAD commit and shows stale when HEAD moves. The operator re-runs the scout when they choose. A repo decision that changed between reports is reopened, so its dependents go stale; new repo decisions arrive as proposals.

**A handoff scout grounds the plan.** Generating the handoff runs a second grounded turn on the same machinery, reading the project at its current HEAD together with the tickets. It fills each brief's File boundaries, Codebase facts and acceptance evidence, with citations, once per handoff. The operator can edit the result before export. Reading HEAD at handoff time also catches drift since the interview.

**Delivery is a project setting.** It is either pull request or local merge, defaulting from `git remote -v` and editable like the tracker. `HANDOFF.md` renders from a fixed template per mode. The handoff scout only adds the project's own rules, cited from its `CLAUDE.md` or `.claude/rules/`. No model writes the git workflow.

**After export the repo owns the artifact.** Grill Room owns an artifact until it is exported. Provenance lives in the export manifest, not in the files: session id, export revision, the scout's commit, HEAD at export, and a hash of every file it writes. The exported files carry no headers, so a re-export does not churn them and git stays the history. A re-export treats any file whose hash no longer matches, or that the manifest never listed, as edited in the repo, and keeps it unless the operator ticks it to overwrite or remove. Nothing is read back into the database; a departure from the plan comes back through the build record.

**Turn visibility comes first.** Issue #11's turn record is where every scout run is recorded: turn kind is an open list covering every request kind, including both scouts, and each turn records the model it ran on. Building it before the scout gives the scout's cost on a real repo a measured baseline instead of a guess.

**The export carries `intent.md` and `decisions.md`** beside the spec, tickets, handoff and briefs.

**An outcome starts a follow-up session.** A follow-up action on a build record or ticket creates a session on the same project, linked to its parent. The idea is prefilled with sourced evidence: the ticket, the build notes, what the prompt was missing, the defect. It then runs the normal flow. The parent's decisions need no special link: `decisions.md` sits in the repo, and the next scout finds it as recorded decisions.

## Still open

- **Lessons outside the repo.** The ngine-monitor review named lessons already paid for that live only in the user's auto-memory. The scout reads the project root only. Whether the operator can attach such sources, or they must first be written into the repo, is undecided.
- **Risks and seams between tickets.** Ticket 04 silently depended on a table no ticket created. Whether the handoff scout names the seam between dependent tickets and the check that proves the join is undecided.
- **The scout report's schema**: its fields, their limits, and how the review screen shows them.
- **A second user.** Another person wants Grill Room for their own products, which means repos whose decisions are recorded differently, or not at all. The recorded-or-inferred rule is meant to cover that; it has not met such a repo yet.

## Not adopted

Continuous evals in CI, hooks as approval gates, CI/CD deployment, metric bands and Claude Tag: Grill Room is local and single-user with no production system to watch. `REVIEW.md`: a per-repository policy the main session already applies by hand, with no recorded miss.

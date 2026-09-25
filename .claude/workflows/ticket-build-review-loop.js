export const meta = {
  name: 'ticket-build-review-loop',
  description: 'Per ticket: a builder opens a draft PR from a worktree, one or more opus reviewer lenses judge it, up to 2 fix rounds; the main session verifies and merges',
  whenToUse: 'Delegating pre-flighted grill-room tickets through the review gate. Args carry the filled delegation templates, so the words match the hand loop',
  phases: [
    { title: 'Build', detail: 'builder in its own worktree opens a draft PR' },
    { title: 'Review', detail: 'fresh-context opus reviewers, one per lens, verdict as PR comment', model: 'opus' },
    { title: 'Fix', detail: 'fixer pushes a new commit to the PR branch' },
  ],
}

// args: [{
//   bead,
//   builder,    // builder.md with {{bead}}, {{ticket}}, {{title}} filled
//   reviewers,  // reviewer.md, one per lens, with {{ticket}} and {{lens}} filled; {{pr}}, {{branch}}, {{prior_round}} left for this script
//   fix,        // fix.md with {{bead}} and {{ticket}} filled; {{pr}}, {{branch}}, {{findings}} left for this script
//   start,      // optional { pr, branch, stage: 'review' | 'fix', round, findings }: pick up a ticket whose earlier stages already ran
// }]
//
// Resume replays only the unchanged prefix of agent calls, so a run that stops half way is continued with
// `start`, not with resumeFromRunId: finished builders and reviewers are never paid for twice.

const fill = (text, values) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, String(value)), text)

// A result written while a verify command still runs in the background is not a result.
const PENDING = /\b(IN[_ ]PROGRESS|still running|waiting on)\b/i
const settled = (verification) => typeof verification === 'string' && verification.trim() !== '' && !PENDING.test(verification)

const VERIFIED = {
  type: 'string',
  description: 'the exact final summary line of each verify command, each run to completion in the foreground',
  minLength: 1,
}
const BUILD = {
  type: 'object',
  properties: {
    pr: { type: ['integer', 'null'] },
    branch: { type: ['string', 'null'] },
    verification: VERIFIED,
    blocked: { type: ['string', 'null'], description: 'the exact blocked command and message, or null' },
    notes: { type: 'string' },
  },
  required: ['pr', 'branch', 'verification', 'blocked', 'notes'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approved', 'changes-requested', 'blocked'] },
    findings: { type: 'array', items: { type: 'string' }, description: 'numbered blocking findings with file:line; empty on approval' },
    nits: { type: 'array', items: { type: 'string' } },
    blocked: { type: ['string', 'null'] },
  },
  required: ['verdict', 'findings', 'nits', 'blocked'],
}
const FIX = {
  type: 'object',
  properties: {
    commit: { type: ['string', 'null'] },
    verification: VERIFIED,
    blocked: { type: ['string', 'null'] },
  },
  required: ['commit', 'verification', 'blocked'],
}

const NOT_SETTLED = `\n\nYour previous result was not final: it had no commit, or its verification said a command was still running. Run every verify command in the foreground, wait for each to finish, and report only then.`

async function askUntilSettled(prompt, opts, done) {
  const first = await agent(prompt, opts)
  if (!first || first.blocked || done(first)) return first
  log(`${opts.label}: result not final, asking once more`)
  return agent(prompt + NOT_SETTLED, { ...opts, label: `${opts.label}:again` })
}

const multiLens = (t) => t.reviewers.length > 1
const ONE_OF_SEVERAL = `\n\nYou are one of several reviewers, each with its own lens. Do not run gh pr ready; the main session marks the PR ready once every lens approves.`

async function review(t, pr, branch, round, priorFindings) {
  const prior = priorFindings
    ? `This is review round ${round}. Round ${round - 1} requested:\n${priorFindings.join('\n')}\nCheck that each is fixed, and look again for new defects.`
    : ''
  const verdicts = await parallel(
    t.reviewers.map((template, lens) => () =>
      agent(fill(template, { pr, branch, prior_round: prior }) + (multiLens(t) ? ONE_OF_SEVERAL : ''), {
        label: `review:${t.bead}:r${round}:lens${lens + 1}`,
        phase: 'Review',
        model: 'opus',
        schema: REVIEW,
      }),
    ),
  )
  if (verdicts.some((v) => !v)) return { verdict: 'reviewer-died', verdicts }
  if (verdicts.some((v) => v.verdict === 'blocked')) return { verdict: 'blocked', verdicts }
  const findings = verdicts.flatMap((v) => v.findings)
  return { verdict: findings.length ? 'changes-requested' : 'approved', findings, verdicts }
}

async function fixRound(t, pr, branch, round, findings) {
  return askUntilSettled(
    fill(t.fix, { pr, branch, findings: findings.join('\n') }),
    { label: `fix:${t.bead}:r${round}`, phase: 'Fix', model: 'sonnet', isolation: 'worktree', schema: FIX },
    (fix) => Boolean(fix.commit) && settled(fix.verification),
  )
}

const results = await pipeline(
  args,
  async (t) => {
    if (t.start) return { pr: t.start.pr, branch: t.start.branch, resumed: true }
    return askUntilSettled(
      t.builder,
      { label: `build:${t.bead}`, phase: 'Build', model: 'sonnet', isolation: 'worktree', schema: BUILD },
      // A builder that opened a PR is not re-asked: a fresh worktree would build it again. The reviewers re-run verification.
      (build) => Boolean(build.pr),
    )
  },
  async (build, t) => {
    if (!build) return { bead: t.bead, outcome: 'builder-died' }
    if (build.blocked || !build.pr) return { bead: t.bead, outcome: 'build-blocked', build }
    const { pr, branch } = build
    const rounds = []
    let round = t.start?.round ?? 1
    let pendingFix = t.start?.stage === 'fix' ? t.start.findings : null
    let priorFindings = t.start?.stage === 'review' ? t.start.findings ?? null : null

    for (; round <= 2; round++) {
      if (pendingFix) {
        const fix = await fixRound(t, pr, branch, round - 1, pendingFix)
        rounds.push({ round: round - 1, fix })
        if (!fix || fix.blocked || !fix.commit || !settled(fix.verification)) {
          return { bead: t.bead, pr, branch, outcome: 'fix-failed', rounds }
        }
        priorFindings = pendingFix
      }
      const verdict = await review(t, pr, branch, round, priorFindings)
      rounds.push({ round, review: verdict })
      if (verdict.verdict !== 'changes-requested' || round === 2) break
      pendingFix = verdict.findings
    }

    const last = rounds.filter((r) => r.review).at(-1)?.review
    const outcome = !last
      ? 'reviewer-died'
      : last.verdict === 'approved'
        ? multiLens(t) ? 'approved-mark-ready' : 'approved'
        : last.verdict === 'changes-requested'
          ? 'operator-decides'
          : last.verdict
    const buildVerified = build.resumed || settled(build.verification)
    return { bead: t.bead, pr, branch, outcome, buildVerified, rounds }
  },
)
return results

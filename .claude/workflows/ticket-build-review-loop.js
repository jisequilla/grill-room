export const meta = {
  name: 'ticket-build-review-loop',
  description: 'Per ticket: a builder opens a draft PR from a worktree, one or more opus reviewer lenses judge it after a mutation run, up to 2 fix rounds; the main session verifies and merges',
  whenToUse: 'Delegating pre-flighted grill-room tickets through the review gate. Args carry the filled delegation templates, so the words match the hand loop',
  phases: [
    { title: 'Build', detail: 'builder in its own worktree opens a draft PR' },
    { title: 'Mutate', detail: 'sonnet runs Stryker on the PR diff before each review round', model: 'sonnet' },
    { title: 'Review', detail: 'fresh-context opus reviewers, one per lens, verdict as PR comment', model: 'opus' },
    { title: 'Fix', detail: 'fixer pushes a new commit to the PR branch' },
  ],
}

// args: [{
//   bead,
//   builder,    // builder.md with {{bead}}, {{ticket}}, {{title}} filled
//   reviewers,  // reviewer.md, one per lens, with {{ticket}} and {{lens}} filled; {{pr}}, {{branch}}, {{prior_round}} and {{mutation}} left for this script
//   fix,        // fix.md with {{bead}} and {{ticket}} filled; {{pr}}, {{branch}}, {{findings}} left for this script
//   model,      // optional 'sonnet' | 'opus', default 'sonnet': the builder and fixer model
//   start,      // optional { pr, branch, stage: 'review' | 'fix', round, findings }: pick up a ticket whose earlier stages already ran; findings are fix-list lines.
//               // round may be 3 only with stage 'fix': the restart that fixes a round-2 approval's should-fix items
// }]
//
// Resume replays only the unchanged prefix of agent calls, so a run that stops half way is continued with
// `start`, not with resumeFromRunId: finished builders and reviewers are never paid for twice.

const fill = (text, values) =>
  text.replace(/\{\{(\w+)\}\}/g, (match, key) => (Object.hasOwn(values, key) ? String(values[key]) : match))

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
const LEVELS = ['blocker', 'should-fix', 'nit']
const FINDING = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: LEVELS },
    file: { type: 'string' },
    line: { type: ['integer', 'null'] },
    claim: { type: 'string' },
    evidence: { type: ['string', 'null'], description: 'the command that shows the finding' },
    equivalentMutant: { type: ['string', 'null'], description: 'the quoted mutant and why no test can kill it' },
  },
  required: ['level', 'file', 'line', 'claim', 'evidence', 'equivalentMutant'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approved', 'changes-requested', 'blocked'] },
    findings: { type: 'array', items: FINDING },
    blocked: { type: ['string', 'null'] },
  },
  required: ['verdict', 'findings', 'blocked'],
}
const FIX = {
  type: 'object',
  properties: {
    commit: { type: ['string', 'null'] },
    bodyEdited: { type: 'boolean', description: 'the fixer changed the PR body with gh pr edit' },
    verification: VERIFIED,
    note: { type: ['string', 'null'], description: 'how a finding was fixed, or why it differs from the request; never stops the loop' },
    blocked: { type: ['string', 'null'], description: 'only when a finding could not be fixed: the exact reason' },
  },
  required: ['commit', 'bodyEdited', 'verification', 'note', 'blocked'],
}
const MUTATION = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'truncated', 'overrun', 'runner-failed', 'no-scope'] },
    mutants: { type: ['integer', 'null'] },
    score: { type: ['number', 'null'] },
    survivors: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'integer' }, mutator: { type: 'string' }, status: { type: 'string' } },
        required: ['file', 'line', 'mutator', 'status'],
      },
    },
    elapsedMs: { type: ['integer', 'null'] },
    dropped: { type: 'array', items: { type: 'string' } },
    blocked: { type: ['string', 'null'] },
    preferNotCovered: { type: ['array', 'null'], items: { type: 'string' } },
  },
  required: ['status', 'mutants', 'score', 'survivors', 'elapsedMs', 'dropped', 'blocked', 'preferNotCovered'],
}

const MUTATE = [
  'You run one mutation-testing command for PR branch {{branch}} and return its summary. You change no file, commit nothing and never use port 8082.',
  '1. Run `git fetch origin main {{branch}}`, then `git checkout --detach origin/{{branch}}`.',
  '2. Run `cd grill-room && pnpm install --frozen-lockfile --prefer-offline`.',
  "3. From grill-room/, read the PR body with `gh pr view {{branch}} --json body -q .body`. In its `## Evidence` section, collect the source ranges each entry says its test covers. Write each as a range relative to grill-room/, like `server/a.ts:10-20`: drop a leading `grill-room/`, write a single line `:N` as `:N-N`, give a bare `:start-end` the file named earlier in the same entry, split `path:a-b,c-d` into `path:a-b` and `path:c-d` (each further `,c-d` or `,N` takes the file before it, and a single `N` after a comma becomes `N-N`), and resolve a bare file name to the one tracked file of that name under grill-room/ (`git ls-files`). Skip a range you cannot resolve to a file; a bare file name that matches more than one tracked file resolves to nothing and is skipped. Run `pnpm test:mutate --base origin/main`, adding `--prefer` with the ranges joined by commas with no spaces when there are any, in the foreground, with no run_in_background, passing the Bash tool's timeout of 600000: the run stops itself within 9.5 minutes, so it always finishes inside that call. Do not return before the command has exited.",
  '4. Read grill-room/.scratch/mutation/summary.json and return its status, mutants, score, survivors, elapsedMs, dropped and preferNotCovered unchanged, with blocked null.',
  'If any step fails, return blocked with the exact command and its error, status runner-failed, and null or empty values for the rest.',
].join('\n')

const NOT_SETTLED = `\n\nYour previous result was not final: it had no commit, or its verification said a command was still running. Run every verify command in the foreground, wait for each to finish, and report only then.`
const FIX_NOT_SETTLED = `\n\nYour previous result was not final: it had no commit and no PR-body edit, or its verification said a command was still running. Run every verify command in the foreground, wait for each to finish, and report only then.`

const PLACEHOLDERS = new Set(['', 'null', '<null>', 'none'])
const isPlaceholder = (v) => typeof v === 'string' && PLACEHOLDERS.has(v.trim().toLowerCase())
const nullable = (spec) => Array.isArray(spec?.type) && spec.type.includes('string') && spec.type.includes('null')

// A placeholder string in a field typed ['string', 'null'] means null; routing tests these fields for truthiness.
function normalizeNulls(value, schema) {
  if (!value || typeof value !== 'object' || !schema?.properties) return value
  const out = { ...value }
  for (const [key, spec] of Object.entries(schema.properties)) {
    if (nullable(spec) && isPlaceholder(out[key])) out[key] = null
    else if (spec.type === 'array' && Array.isArray(out[key]) && spec.items?.properties)
      out[key] = out[key].map((item) => normalizeNulls(item, spec.items))
  }
  return out
}

async function ask(prompt, opts) {
  return normalizeNulls(await agent(prompt, opts), opts.schema)
}

async function askUntilSettled(prompt, opts, done, note = NOT_SETTLED) {
  const first = await ask(prompt, opts)
  if (!first || first.blocked || done(first)) return first
  log(`${opts.label}: result not final, asking once more`)
  return ask(prompt + note, { ...opts, label: `${opts.label}:again` })
}

const multiLens = (t) => t.reviewers.length > 1
const ONE_OF_SEVERAL = `\n\nYou are one of several reviewers, each with its own lens. Do not run gh pr ready; the main session marks the PR ready.`
const MAIN_MARKS_READY = `\n\nDo not run gh pr ready; the main session marks the PR ready.`
const BUILDER_BLOCKED = `\n\nThe builder reported a block it could not get past: {{blocked}}. Check whether it left any acceptance line unproved or any verification step unrun, and report each one you find as a finding.`
const buildModel = (t) => t.model ?? 'sonnet'

const MUTATION_GATE_SKIPPED = 'The gate is skipped for this round; say so in the verdict.'
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function mutationText(round, m) {
  const head = `Mutation run (round ${round}):`
  if (!m) return `${head} the mutation agent died. ${MUTATION_GATE_SKIPPED}`
  if (m.blocked) return `${head} blocked: ${m.blocked}. ${MUTATION_GATE_SKIPPED}`
  const seconds = m.elapsedMs == null ? 'n/a' : `${Math.round(m.elapsedMs / 1000)} s`
  if (m.status === 'overrun' || m.status === 'runner-failed') return `${head} ${m.status} after ${seconds}. ${MUTATION_GATE_SKIPPED}`
  if (m.status === 'no-scope') return `${head} no-scope, nothing to mutate.`
  const survivors = m.survivors ?? []
  const mutants = m.mutants == null ? 'n/a mutants' : plural(m.mutants, 'mutant')
  const score = m.score == null ? 'n/a' : m.score.toFixed(1)
  return [
    `${head} ${m.status}, ${mutants}, score ${score}, ${seconds}, ${plural(survivors.length, 'survivor')}.`,
    ...survivors.map((x) => `- ${x.file}:${x.line} ${x.mutator} (${x.status})`),
    ...(m.dropped.length ? [`Dropped over the cap: ${m.dropped.join(', ')}`] : []),
    ...(m.preferNotCovered?.length ? [`Preferred ranges not covered by the scope: ${m.preferNotCovered.join(', ')}`] : []),
  ].join('\n')
}

const where = (f) => (f.line == null ? f.file : `${f.file}:${f.line}`)
const hasEvidence = (f) => typeof f.evidence === 'string' && f.evidence.trim() !== ''
const lacksEvidence = (f) => f.level !== 'nit' && !hasEvidence(f)
const fixLine = (f, n) => `${n}. [${f.level}] ${where(f)}: ${f.claim}${hasEvidence(f) ? ` (evidence: ${f.evidence})` : ''}`

async function askLens(prompt, label) {
  const opts = { phase: 'Review', model: 'opus', schema: REVIEW }
  const first = await ask(prompt, { ...opts, label })
  if (!first || first.verdict === 'blocked') return first
  const missing = first.findings.filter(lacksEvidence)
  if (!missing.length) return first
  const note = `\n\nThese findings need evidence, the command that shows them: ${missing.map(where).join(', ')}. Return all your findings again with evidence filled in.`
  return ask(prompt + note, { ...opts, label: `${label}:again` })
}

function mutate(t, branch, round) {
  return ask(fill(MUTATE, { branch }), {
    label: `mutate:${t.bead}:r${round}`,
    phase: 'Mutate',
    model: 'sonnet',
    effort: 'low',
    isolation: 'worktree',
    schema: MUTATION,
  })
}

async function review(t, pr, branch, round, priorFindings, mutation, buildBlocked) {
  const prior = priorFindings
    ? `This is review round ${round}. Round ${round - 1} requested:\n${priorFindings.join('\n')}\nCheck that each is fixed, and look again for new defects.`
    : ''
  const mutationFill = mutationText(round, mutation)
  const ending = (multiLens(t) ? ONE_OF_SEVERAL : MAIN_MARKS_READY) + (buildBlocked ? fill(BUILDER_BLOCKED, { blocked: buildBlocked }) : '')
  const verdicts = await parallel(
    t.reviewers.map((template, lens) => () =>
      askLens(
        fill(template, { pr, branch, prior_round: prior, mutation: mutationFill }) + ending,
        `review:${t.bead}:r${round}:lens${lens + 1}`,
      ),
    ),
  )
  if (verdicts.some((v) => !v)) return { verdict: 'reviewer-died', verdicts }
  if (verdicts.some((v) => v.verdict === 'blocked')) return { verdict: 'blocked', verdicts }
  const findings = verdicts.flatMap((v, i) => v.findings.map((f) => ({ ...f, lens: i + 1 })))
  const ofLevel = (level) => findings.filter((f) => f.level === level)
  const blockers = ofLevel('blocker')
  const fixList = blockers.length ? [...blockers, ...ofLevel('should-fix')] : []
  return { verdict: blockers.length ? 'changes-requested' : 'approved', findings, verdicts, fixList }
}

const fixSettled = (fix) => (Boolean(fix.commit) || fix.bodyEdited === true) && settled(fix.verification)

async function fixRound(t, pr, branch, round, findings) {
  return askUntilSettled(
    fill(t.fix, { pr, branch, findings: findings.join('\n') }),
    { label: `fix:${t.bead}:r${round}`, phase: 'Fix', model: buildModel(t), isolation: 'worktree', schema: FIX },
    fixSettled,
    FIX_NOT_SETTLED,
  )
}

function collectNonBlocking(rounds, sentTo) {
  return rounds
    .filter((r) => r.review?.findings)
    .flatMap((r) =>
      r.review.findings
        .filter((f) => f.level !== 'blocker')
        .map((f) => ({ ...f, round: r.round, sentToFix: sentTo.get(f) ?? null })),
    )
}

const results = await pipeline(
  args,
  async (t) => {
    if (t.start) return { pr: t.start.pr, branch: t.start.branch, resumed: true }
    return askUntilSettled(
      t.builder,
      { label: `build:${t.bead}`, phase: 'Build', model: buildModel(t), isolation: 'worktree', schema: BUILD },
      // A builder that opened a PR is not re-asked: a fresh worktree would build it again. The reviewers re-run verification.
      (build) => Boolean(build.pr),
    )
  },
  async (build, t) => {
    if (!build) return { bead: t.bead, outcome: 'builder-died', nonBlocking: [] }
    if (!build.pr) return { bead: t.bead, outcome: 'build-blocked', build, nonBlocking: [] }
    const { pr, branch } = build
    // A builder that opened a PR and then hit a block still goes to review; the reviewers are told about the block.
    const buildBlocked = build.blocked || null
    const rounds = []
    const sentTo = new Map()
    let round = t.start?.round ?? 1
    let pendingFix = t.start?.stage === 'fix' ? t.start.findings : null
    let pendingItems = []
    let priorFindings = t.start?.stage === 'review' ? t.start.findings ?? null : null

    // Round 3 exists only as a restart at stage fix, to fix a round-2 approval's should-fix items.
    const lastRound = t.start?.stage === 'fix' && t.start.round === 3 ? 3 : 2
    for (; round <= lastRound; round++) {
      if (pendingFix) {
        pendingItems.forEach((f) => sentTo.set(f, round - 1))
        const fix = await fixRound(t, pr, branch, round - 1, pendingFix)
        rounds.push({ round: round - 1, fix })
        if (!fix || fix.blocked || !fixSettled(fix)) {
          return {
            bead: t.bead,
            pr,
            branch,
            outcome: 'fix-failed',
            buildBlocked,
            rounds,
            nonBlocking: collectNonBlocking(rounds, sentTo),
            shouldFix: [],
          }
        }
        priorFindings = pendingFix
      }
      const mutation = await mutate(t, branch, round)
      const { fixList, ...record } = await review(t, pr, branch, round, priorFindings, mutation, buildBlocked)
      rounds.push({ round, mutation, review: record })
      if (record.verdict !== 'changes-requested' || round === lastRound) break
      pendingItems = fixList
      pendingFix = fixList.map((f, i) => fixLine(f, i + 1))
    }

    const last = rounds.filter((r) => r.review).at(-1)?.review
    const lastShouldFix = (last?.findings ?? []).filter((f) => f.level === 'should-fix')
    // No reviewer marks the PR ready in a workflow run: the main session does, or asks the owner first about should-fix items.
    const outcome = !last
      ? 'reviewer-died'
      : last.verdict === 'approved'
        ? lastShouldFix.length ? 'approved-with-should-fix' : 'approved-mark-ready'
        : last.verdict === 'changes-requested'
          ? 'operator-decides'
          : last.verdict
    const shouldFix = outcome === 'approved-with-should-fix' ? lastShouldFix.map((f, i) => fixLine(f, i + 1)) : []
    const buildVerified = build.resumed || settled(build.verification)
    return {
      bead: t.bead,
      pr,
      branch,
      outcome,
      buildVerified,
      buildBlocked,
      rounds,
      nonBlocking: collectNonBlocking(rounds, sentTo),
      shouldFix,
    }
  },
)
return results

# Session workspace — UX review

Screen under review: `app/routes/sessions.$sessionId.tsx`, with
`app/components/workspace/round-card.tsx`, `round-panel.tsx`, `design-tree.tsx`.
Observed live at 1852×1073 and 1280×800, light and dark, on a real session in
both the answered and unanswered card states.

Measurements quoted below are from the running app, not from reading the
Tailwind classes.

## What the screen already gets right

The three-zone composition (round cards / design tree / previous rounds) is the
correct shape for this product, and the tree is genuinely good: the outline
indent reads, the `+N more` dependency marker is a tidy solution to a graph
rendered as a tree, and the state colours mean something (settled green,
frontier blue, blocked grey) rather than decorating. The answered block's
orange-vs-green split — a steering move is *not* dressed as a settled answer —
is a real piece of design thinking and should survive every change below.

The unanswered card is also close to right. The problems are concentrated in
what happens *after* an answer exists, and in the relative weight of the four
ways to answer.

## Critique

### 1. The card never re-ranks itself by state — one cause, three annotations

This is the unifying diagnosis. The card renders all four answer paths
simultaneously at fixed visual weight, and that weight never changes when the
decision is settled. Measured on the answered card at 1852×1073:

| Element | Height | Type | Colour | Weight |
|---|---|---|---|---|
| **Accept** (recommendation) | 36px | 14px | `#fff` on `#262626` | 500 |
| **Change** (the answer given) | 36px | 14px | `#1a1a1a` on transparent | 500 |
| Choice chips | 28px | 12px | `#262626` on `#f2f2f2` | 400 |
| Steering moves | 28px | 12px | `#737373` on `#fff` | 400 |

After the user has answered, the loudest control on the card — the only
solid-fill, ~15:1-contrast button in the whole column — is still the one asking
them to answer. The control that operates on the decision they actually made
(`Change`) is a ghost button with roughly 1.1:1 background contrast against the
card. The hierarchy is inverted against the state.

**Anti-patterns:** *undemoted primary CTA* (a primary action that keeps primary
styling after its job is done); *equal-weight alternatives* (four paths of very
different frequency and consequence rendered as one flat menu); *destination
without a state machine* (the card has states in the data — `draft`,
`leavesOpen`, `state` — but only one layout).

### 2. The answer flow buries the mechanism and promotes the prose

On the unanswered round-2 card the recommendation reads *"Hooks for tool-call
events plus the OTel exporter for token/cost metrics, since each covers what the
other misses"* and the chips read *Hooks only / Transcript tailing only / OTel
exporter only / Hooks + OTel combined*. The recommendation **is** the fourth
chip, restated as a sentence — but nothing on screen says so. The user has to
read prose, map it onto a chip row 80px further down, and notice they are two
renderings of one decision.

This produces a correctness bug, not only a visual one. `round-card.tsx:217`
routes a chip click through `choice === card.recommendedAnswer ?
save("accepted-recommendation") : save("own-answer", choice)`. Because the
interviewer writes the recommendation as a sentence and the choices as short
labels, that equality is false in practice. **A user who clicks the chip the
interviewer recommended is recorded as having given their own answer.** For a
PoC whose whole output is a record of where the user accepted versus diverged,
that silently corrupts the data.

### 3. The escape hatches are styled as though the product does not want them

The five steering moves are 12px, weight 400, `#737373`, 28px tall, separated by
`gap-0.5` (2px). `I don't know` and `Defer` commit immediately on click with no
confirmation step. So the two instant-commit, state-changing controls are the
smallest, faintest, most tightly packed targets on the card — an inverted
risk/affordance relationship. In a product whose premise is that disagreement
produces better decisions, the path of least resistance is a black **Accept**
button and the friction paths are grey 12px text.

`Write my own` is also mis-grouped: it is an *answer*, sitting in a row of
*non-answers*, distinguished only by an icon and `font-medium`.

### 4. The page does not use the viewport; the tree stops 419px short

At 1852×1073 the container is capped at `max-w-7xl` = **1280px** inside a
1576px main area, and `main.agent-native-app-main` does not scroll at all
(`scrollHeight` 1009 = `clientHeight` 1009). The tree aside is 336px wide and
**524px tall, ending at y=654** against a 1073px viewport — its `max-height`
resolves to 913px but the content only fills 497px. Everything below y≈660 on
both columns is dead canvas. The user is reacting to a real waste.

Caveat for the fix: stretching the tree card to `h-full` while its content still
fills 60% just trades dead page for a dead *box*, which reads worse (*stretched
empty container*). The tree needs to fill the height **and** be given something
at the bottom that earns it.

### 5. The idea is rendered as metadata

`session.idea` is a `max-w-md truncate text-sm text-muted-foreground` span, third
in a row after a badge, a model name and a `·`. Measured: **448px shown of
1839px of content — 24%.** The sentence dies at *"…where i can mo…"*. It is the
subject of the entire session and the thing every question is grilling; it is
styled exactly like the model label beside it.

**Anti-pattern:** *truncation as layout* — truncating the most important string
on the screen to fit a decorative single-line meta row.

### 6. Craft and accessibility notes

- **Steering text contrast:** `#737373` on `#fff` is 4.74:1 — passes AA for
  normal text, but at 12px with 28px targets it is the floor, not a choice.
  Dark mode is `#999` on `#181818`, comparable. Not a violation; not a margin
  worth keeping for the product's most consequential controls.
- **Target spacing:** 28px tall with 2px gaps between five adjacent controls,
  two of which commit instantly. WCAG 2.5.8 (24×24) passes; the misclick cost
  does not.
- **Sticky footer translucency:** the submit bar is `bg-background/85
  backdrop-blur` with no scroll padding beneath the card stack. Mid-scroll at
  1280×800 the choice chips render as legible ghosts *through* the bar, which
  reads as a rendering fault.
- **Multi-card rounds:** a single card measures 591px (1852px wide) / 695px
  (1280px wide) and answered cards do not collapse. A five-card round is ~3,000
  px of uniform-height scroll with no way to see which cards are still open
  except the dot strip in the footer.
- **`Change` is mislabelled:** it always opens `own-answer` mode
  (`round-card.tsx:161`). From an `accepted-recommendation` or `deferred` draft
  it therefore means "replace this with a typed answer", not "change this".

## The five annotations

### 1. "once i decided the Option A the recommended still hangs in our face"

**Reacting to:** the solid-black `Accept` button surviving at full strength
below their green answer block.

**Underlying problem:** §1 — the card has no answered layout. The recommendation
block keeps `border-dashed bg-muted/40`, full prose and a primary-variant button
whether or not the decision is settled.

**Fix:** make the recommendation collapse when `draft !== null`. Render it as a
single muted line inside a `<details>`/disclosure — `RECOMMENDED · A) Claude
Code sessions only…` truncated to one line, `text-xs text-muted-foreground`, no
dashed border — and demote its button to `variant="outline" size="sm"` with copy
that admits the new context: **"Accept instead"**. Simultaneously promote the
answered block: give `Change` `variant="outline"` so the control that operates
on the live decision outranks the one that would replace it. Keep the green/
orange split exactly as it is.

### 2. "This options to select are not quite visible, is like they are hiding there at the bottom"

**Reacting to:** 12px/400-weight 28px chips sitting 135px below the Accept
button, under an 11px uppercase label identical in styling to `RECOMMENDED`. At
1280×800 they are below the fold entirely.

**Underlying problem:** §2 — the chips are the actual answering mechanism, but
they are rendered as a footnote restating the prose above them.

**Fix (shares a cause with #1 and #3):**
- **Order:** move the choices row *above* the recommendation block, so the card
  reads question → pick one → why the interviewer suggests one of them.
- **Weight:** `h-7 text-xs font-normal` → `h-9 px-3.5 text-[13px] font-medium`,
  `variant="outline"`, `hover:border-foreground/40 hover:bg-accent`.
- **Connect them:** mark the recommended chip — `ring-1 ring-primary/40
  border-primary/50` plus a `Recommended` micro-tag — so the prose and the chips
  are visibly one decision. This requires the interviewer to return which choice
  it recommends (or a server-side match), which also fixes the
  `accepted-recommendation` fidelity bug in §2.
- **Label:** `Offered choices` → **`Choose one`**. The current string names the
  interviewer's act; the new one names the user's.

### 3. "We should highlight this more, i like the options here but is like they are not important"

**Reacting to:** the steering row reading as a disabled toolbar.

**Underlying problem:** §3 — escape hatches styled as de-emphasis, and
`Write my own` mixed in with non-answers.

**Fix:**
- Split the row. `Write my own` leaves the group and becomes an
  `variant="outline" size="sm"` button adjacent to the choice chips — it is a
  fifth way to answer, not a way to decline.
- Give the remaining four a named container instead of a bare `border-t`: a
  muted sub-block with its own micro-label, **`Or steer the interview`**, so the
  row is announced rather than left over.
- Raise them: `text-xs font-normal text-muted-foreground` → `text-[13px]
  font-medium text-foreground/75`, `h-7` → `h-8`, `gap-0.5` → `gap-1.5`, and
  `variant="ghost"` → `variant="outline"` with a transparent background so they
  read as real controls.
- Drop the `|` divider once `Write my own` has moved out; it exists only to
  separate the two classes currently sharing a row.

### 4. "maybe should go until the bottom since there is still more room in the page"

**Reacting to:** 419px of empty canvas below a 524px tree in a 1073px viewport.

**Underlying problem:** §4 — a sticky aside sized to its content inside a page
capped at 1280px, with nothing claiming the remaining height.

**Fix, in this order:**
1. Widen the page: `max-w-7xl` → `max-w-[1600px]` (or `2xl:max-w-[96rem]`) and
   the grid `lg:grid-cols-[minmax(0,1fr)_21rem]` →
   `lg:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]`.
   This alone unwraps most tree titles from two lines to one.
2. Make the aside a full-height column: `lg:sticky lg:top-6 lg:self-start` →
   add `lg:h-[calc(100dvh-7rem)]`, and turn the inner box into
   `flex h-full min-h-0 flex-col` with the outline `ul` in
   `flex-1 overflow-y-auto`.
3. **Earn the height** — do not ship an empty stretched box. Pin a footer row
   inside the tree card: loose-end count and settled/total, sourced from the
   data already in `get-tree` (`isLooseEnd` is already imported by
   `design-tree.tsx`). That gives the bottom of the panel a job and answers
   "how far am I" without opening the sheet.

If the footer is out of scope for the ticket, keep the tree content-height and
do only step 1 — a shorter well-filled panel beats a tall empty one.

### 5. "We should treat this more as a first class citizen, is the main idea"

**Reacting to:** 24% of the idea visible, at metadata weight.

**Underlying problem:** §5.

**Fix:** break the header into two rows. Row one keeps the meta chips
(`SessionStateBadge`, model) and drops the `·`. Row two is the idea, promoted:

```
<p className="max-w-3xl text-[15px] leading-relaxed text-foreground/90 line-clamp-2">
```

with a `Show more` / `Show less` ghost toggle when it overflows (or a
`<details>` — no clamp needed at two lines for most ideas). Do **not** make it
the `<h1>`: the shell header already carries the session title, and two competing
titles is a worse problem than a truncated one. Its job is to be readable,
quotable and complete — not to outrank the title.

## Prioritized fix list

Each item is one ticket. "Model" = changes the card's interaction model;
"Cheap" = styling, layout or copy only.

| # | Fix | Cost | Acceptance criteria (screenshot-verifiable) |
|---|---|---|---|
| 1 | **Idea as a first-class header block** (annotation 5) | Cheap | Header renders two rows. The idea is ≥15px at `text-foreground/90`, spans ≥`max-w-3xl`, and shows ≥2 lines. At 1852×1073 the string `…where i can monitor agents behaviour, tool calls…` is legible on screen. No `truncate` on the idea. |
| 2 | **Recommendation demotes once answered** (annotation 1) | Model | With a draft present: the recommendation block has no dashed border and no solid-fill button; its button is `outline` and reads "Accept instead"; the recommendation prose is one clamped line. `Change` in the answer block is `outline`. In a screenshot of an answered card, no element outranks the green answer block in contrast. Unanswered cards are unchanged from today. |
| 3 | **Choices become the primary selector** (annotation 2) | Model | Choice chips render *above* the recommendation block, ≥36px tall, ≥13px text, `font-medium`, `outline` variant. The chip matching the recommendation carries a visible `Recommended` marker. At 1280×800 at least one chip is above the fold on an unanswered card. |
| 4 | **`accepted-recommendation` is recorded correctly** (from #3) | Cheap, correctness | Clicking the chip marked `Recommended` produces the `Recommendation accepted` answer block, not `Own answer`. Verifiable in a screenshot of the answer block after the click. |
| 5 | **Steering moves promoted and regrouped** (annotation 3) | Cheap | `Write my own` sits with the choices as an `outline` button, not in the steering row. The four moves sit under a `Or steer the interview` label, ≥32px tall, ≥13px, `text-foreground/75`, ≥6px apart, with visible borders. No `\|` divider remains. |
| 6 | **Page width and tree column height** (annotation 4) | Cheap | Container ≥1600px at a 1852px viewport; tree column ≥24rem. The tree panel's bottom edge sits within 80px of the viewport bottom at 1852×1073. Tree titles that wrapped to two lines now fit one where the string allows. |
| 7 | **Tree footer: loose ends and settled count** (annotation 4) | Cheap | A pinned footer row inside the tree card shows settled/total and the loose-end count. Visible without scrolling the tree. The panel bottom is not empty. |
| 8 | **Answered cards collapse in multi-card rounds** | Model | In a round of ≥2 cards, a card with a draft renders as question + answer block + `Change` only, at ≤160px tall, expandable. A 5-card round fits in roughly one viewport at 1852×1073. |
| 9 | **Sticky footer opacity and scroll padding** | Cheap | The submit bar is opaque (`bg-background`, or `/95` plus a border). No content is legible through it mid-scroll at 1280×800. The card stack has bottom padding ≥ the bar's height. |
| 10 | **`Change` opens the draft's own mode** | Cheap | `Change` on an `accepted-recommendation` draft returns to the choice/recommendation row rather than a blank textarea; on `deferred` it offers the steering row. Or relabel to `Write my own instead` and leave behaviour alone. |

Sequencing note: **3 → 4 → 2** in that order. #3 establishes which chip is the
recommendation, #4 consumes that, and #2's demotion only makes sense once the
chips can carry the answer. #1, #6, #9 are independent and can ship immediately.

## What I would not change

- **The tree's visual language.** The indent, the hairline connectors, the
  `+N more` marker and the state colours work, and the user said so. Widening
  it and letting it fill the height is the whole intervention. Do not add
  expand/collapse, icons or row dividers.
- **The green/orange answered-block split.** The distinction between a settled
  answer and an answered-but-still-open steering move is the sharpest idea on
  the screen. The comment at `round-card.tsx:121` explains it correctly. Every
  fix above preserves it.
- **The footer dot strip.** Five 20×6px dots coloured by draft state is a good,
  quiet progress indicator. It becomes more useful once #8 lands, not less.
- **Making the idea an `<h1>`.** The shell header already owns the session
  title. Promoting the idea to a second heading creates two competing titles.
  Readable and complete is the goal, not dominant.
- **The 11px uppercase micro-labels as a system.** They are consistent and
  quiet, which suits the "quiet conversation library" direction in `DESIGN.md`.
  The problem is not that `OFFERED CHOICES` is 11px uppercase — it is that the
  *controls beneath it* are also 12px and faint. Fix the controls, keep the
  label system.
- **The interviewer's prose recommendation.** It carries the reasoning ("since
  each covers what the other misses") that the chips cannot. It should be
  demoted relative to the chips, never removed.
- **The indented outline as the only tree layout.** The user tried a
  columns-by-state layout and a dependency node graph against the real
  72-decision tree and kept the outline. The aside is too narrow for either,
  and neither earned a full-width view.

## Verification

Checked against the running app at 1852×1073 and 1280×800, light and dark. The
session advanced through several rounds during the pass, which gave five
different live cards — including, usefully, both an unanswered and an answered
one.

**1. Idea as a first-class header block — PASS.** The idea is its own row at
15px, `foreground/0.9`, `max-w-3xl` (768px), `line-clamp-2` with a working
`Show more` (scrollHeight 73 vs clientHeight 49, so it is genuinely clamped, not
cut). It now reads through *"…monitor agents behaviour, tool calls, token usage,
model usage and cost usage, interactive. The system stores session of all
project details, and has …"* — against 448px of 1839px before. No `truncate`.
Identical in dark.

**2. Recommendation demotes once answered — PASS.** On the answered *Homebrew
tap* card the block is one 52px row, `bg-muted/30`, no dashed border, the
recommendation truncated to a single muted line, and the button is `outline`
reading **Accept instead**. `Change` is `outline` with an explicit border. No
solid-fill control remains inside an answered card, so the green *Accepted the
recommendation* block is the most prominent element — the inversion is gone.
Unanswered cards still show the dashed block and the solid `Accept`, as
specified.

**3. Choices as the primary selector — PASS WITH NOTE.** Order, size and weight
all pass: chips render above the recommendation (chips y=453, block y=505), 36px
tall, 13px, `font-medium`, outline with explicit borders; at 1280×800 the entire
choice row plus `Write my own` sits above the fold. **The marker is the note.**
It renders correctly when it fires — `Homebrew tap` carried a visible
`RECOMMENDED` pill and `border-primary/50` against plain chips — but across five
live rounds it fired on **one**. `recommendedChoiceIndex` is a prefix/label
matcher and the interviewer paraphrases: *"Version field per event, collector
accepts…"* does not prefix-match the chip *"Version field, collector accepts
current and previous"*, and *"pgx with sqlc…"* does not match *"pgx + sqlc…"*.
Separately, `ring-1 ring-primary/40` computes to a fully transparent box-shadow;
the visible differentiation comes from the border and the pill, which is
sufficient, but the ring class is dead and should be dropped or fixed.

**4. `accepted-recommendation` recorded correctly — PASS.** Observed live, not
inferred: the marked `Homebrew tap` chip was clicked and the answer block reads
**Accepted the recommendation**, not *Own answer*. The fidelity bug is fixed on
the path that matters. It inherits item 3's note — on a round where the matcher
misses, every chip still records `own-answer`, so the original bug survives
there untouched.

**5. Steering moves promoted and regrouped — PASS.** `Write my own` has moved out
and sits with the choices as an outline chip. The four moves sit under an
`OR STEER THE INTERVIEW` label at 32px, 13px, `font-medium`, `text-foreground/75`,
explicit 1px borders, 6px apart (measured 419→425, 512→518, 574→580). The `|`
divider is gone. Dark-mode borders (`rgb(61,61,61)`) read clearly.

**6. Page width and tree column height — PASS WITH NOTE.** `max-w-[1600px]`
renders 1576px — the whole main area with the 276px shell sidebar open, so the
container is no longer the constraint, which is what the item was for. The
deviation is correct and I would not chase the literal number. Grid is 1048px +
a 448px aside (28rem, up from 21rem), and tree titles that wrapped to two lines
now fit one (rows at 33px). Tree bottom 1050 in a 1073 viewport — a 23px gap.
**Note:** the height is `lg:h-[calc(100dvh-15rem)]`, tuned to the unscrolled
header offset; once scrolled the panel pins at top=113 and leaves 152px empty
below it. Deriving the height from the sticky offset rather than a fixed 15rem
would hold the fit at every scroll position.

**7. Tree footer — PASS.** A pinned footer inside the tree card reads
`39 of 53 settled` with `14 loose ends` in orange. The outline scrolls
internally (scrollHeight 2703 against a 770px client) with the footer fixed, so
the panel is full-height and full — not a stretched empty box. Visible at both
viewports without scrolling the tree.

**8. Answered cards collapse — NOT VERIFIABLE LIVE; code-verified.**
`foldable={cards.length > 1}` at `round-panel.tsx:145`, and the folded branch
drops the question body, choices, recommendation and steering row, clamping the
answer to two lines. Every live round during this pass was a single card (the
session is in one-at-a-time mode), so no fold ever rendered, and forcing one
needs a state change I was told not to make. The ≤160px height criterion is
unmeasured — worth confirming on a whole-round session before calling it done.

**9. Sticky footer opacity and scroll padding — PASS.** The bar computes
`rgb(255, 255, 255)` with `backdrop-filter: none` (was `/85` plus blur), and the
card stack carries `pb-20` (80px measured). At 1280×800 mid-scroll nothing is
legible through the bar. **Note:** on a short single-card round the 80px
clearance reads as an empty band between the card and the bar; it is doing its
job, but `pb-20` could be conditional on the stack overflowing.

**10. `Change` opens the draft's own mode — NOT VERIFIABLE LIVE; code-verified.**
`change()` at `round-card.tsx:160-167` reopens a typed move's own field
pre-filled with what was typed, and for `accepted-recommendation`, `unknown` and
`deferred` clears `move` and expands, returning to the chip and recommendation
rows rather than a blank textarea. Exercising it on the live answered card would
have changed a draft.

### What the rebuild made worse, or left open

- **The matcher is the one substantive gap.** Items 3 and 4 are implemented
  correctly and fail only on their input. A string-prefix matcher is being asked
  to solve a paraphrase problem. The durable fix is at the port: have the
  interviewer return the index of the choice it recommends, rather than
  recovering it from prose afterwards.
- **No selected state on the chosen chip.** On the answered card the accepted
  `Homebrew tap` chip looks identical to the two it was chosen over; only the
  green block records the choice. An `aria-pressed` / filled state on the chosen
  chip would close the loop and costs almost nothing.
- **Two fixed measurements that only hold in one state:** the tree's `15rem`
  calc (item 6) and the unconditional `pb-20` (item 9).
- **Dead `ring-1 ring-primary/40`** on the recommended chip.

Nothing on the original "what I would not change" list was damaged. The
green/orange settled-versus-still-open split survives and now renders *Accepted
the recommendation* correctly; the dot strip is intact; the tree's visual
language is unchanged apart from width; the idea is a paragraph rather than a
competing `<h1>`; and the new `Choose one` and `Or steer the interview` labels
reuse the existing 11px micro-label system rather than inventing a second one.

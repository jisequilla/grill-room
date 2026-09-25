# Visual Design Contract

Grill Room is a decision workbench. It interrogates a loose idea, one round of
decision cards at a time, until the owner and the interviewer share an
understanding, and then turns the settled record into a spec, tickets and a
handoff that agents build from. Every screen serves one of two jobs: answer the
question on the grill, or trust the record of what was decided.

## Brand

### Name treatment

- The name is **Grill Room**: two words, title case in prose and page titles.
- The wordmark is lowercase `grill room` in JetBrains Mono Medium, 15px in the
  sidebar, tracking 0. The monospace face says "record": the same face carries
  ids, paths, commits and citations everywhere else in the app.
- Never "GrillRoom", "grill-room" (except as the package name), or an emoji.

### Mark: the Grate

- A 20×20 square with a 4px radius and a 2px frame, crossed by three
  horizontal bars, each 2px thick and 1.5px apart. The bars run wall to wall
  and fuse with the frame. Floating bars would read as a hamburger-menu glyph;
  bars welded to the frame read as a grate.
- The top bar is Ember; the frame and the two bars below it are the current
  text colour. The source is `docs/design/brand/grill-room-mark.svg`; its top bar is hard-coded to Ember Lit and should take `var(--primary)` when it enters the app.
- The bars read two ways, and both are the product. They are the grate an idea
  is held over, and they are the ruled lines of a ledger. The one hot bar is
  the question under heat, with the settled record beneath it.
- The mark replaces `AgentNativeIcon` in the sidebar header. It is also the
  favicon (Ember bar on a Charcoal square), and the collapsed sidebar shows
  the mark alone.
- The flame icon (`IconFlame`) leaves the navigation. Fire reads as barbecue.
  The heat in this brand is a single colour on a single element, never a glyph.

### Voice

- **Interrogator, not concierge.** The copy asks and states. It does not
  cheer. "Nothing is open: every decision has a real answer or was set aside"
  is on voice. "Great job! 🎉" is not.
- **Name the actor.** Say who did it: "You pushed back", "The interviewer
  proposes you are done", "Recorded in the repo". Provenance lives in the
  sentence, not only in a badge.
- **Verbs over nouns** on controls: Accept, Push back, Defer, Set aside,
  Confirm shared understanding, Export.
- **No hedging on refusals.** Say what blocks the action and what clears it:
  "1 loose end has to be resolved first."
- The existing `en-US.ts` vocabulary is already on voice. Keep it, and apply the
  same register to new strings.

### Why it fits

"Grill" means relentless questioning until both sides understand the same
thing. The brand holds that in one place: a quiet, warm-neutral ledger with a
single point of heat on whatever is currently being questioned. It is a
workbench a technical owner returns to for real features, so it looks like an
instrument for keeping records. It must not look like a chat toy: no bubbles,
no avatars, no gradient hero, no mascot.

## Product mode

- Mode: `operate`.
- Audience and cadence: one technical owner, running several planning sessions
  per week against real repositories. They decide fast, and they come back
  later to check why something was decided.
- Primary workflow: open a session, answer the round in front of them, clear
  the loose ends, confirm, and carry the output into the project's repo.
- Secondary workflow: audit provenance. Who decided this, what it superseded,
  and which file in the repo it cites.

## Visual direction

- Direction name: **Ember on the Ledger**.
- Palette family: warm charcoal and paper neutrals, one brand heat (Ember),
  and four semantic colours drawn from the decision lifecycle (settled, owed,
  repo provenance, destructive). No other hues.
- Type treatment: IBM Plex Sans for reading and controls; JetBrains Mono for
  labels, ids, paths, commits, citations and counts. Two families, two jobs.
- Dials: DESIGN_VARIANCE 4, MOTION_INTENSITY 2, VISUAL_DENSITY 6. It is a
  dense instrument, quiet in motion and structured in layout. The only
  departure from the scaffold is identity, not layout novelty.
- Heat budget: at most one Ember-filled element in view (the page's primary
  action), plus Ember marks on the frontier (the cards currently being asked).
  The sidebar's New session is a secondary button with an Ember plus glyph, so
  it never competes with the page. If two things glow, neither is hot.

## Composition

- **Shell.** A persistent left rail (sidebar) and a content canvas. The header
  carries the page title (with a project breadcrumb on a session), the state,
  and at most two visible actions; everything else collapses into an overflow
  menu (`…`) below `lg`.
- **Session workspace ("the bench").** Two columns at `lg` and wider: the
  bench (flexible) and the ledger (the design tree, 22rem, 26rem at `2xl`).
  - The bench always opens on the current ask: the round, the done panel, or
    the confirmed panel. The project scout report and the readiness judgment
    fold into a one-line **Brief** strip above it ("Scout: read 0c00712 · 2
    kept, 6 dropped · Ready"). The strip expands in place and starts
    collapsed once a round exists.
  - Round history sits below the current ask, collapsed by default.
  - The submit bar is sticky to the bench's bottom edge, not the viewport, so
    it never covers the ledger.
- **Ledger.** The design tree, with a footer that counts settled decisions and
  loose ends. Below `lg` it becomes a sheet opened from a header button that
  shows the loose-end count.
- **Output (spec, tickets, handoff, export).** A single reading column (max
  48rem) with a sticky section index on the left at `xl` (Spec, Tickets,
  Handoff, Build records, Export). Each section opens with a status line
  (current, stale, or missing) before its content.
- **Project page.** A header with the name, git root, branch and HEAD. Then a
  one-line configuration strip (verify command, tracker, delivery recipe,
  review, visibility), then tabs: Sessions, Exports, Settings.
- **Narrow width (< 768px).** Single column. The sidebar is a sheet. Header
  actions collapse to one overflow button, so the session title always keeps
  at least 60% of the header. Choice rows keep full width. Steering moves wrap
  in a 2×2 grid. The submit bar spans the width, with the progress count above
  the button.

## Shape language

- **Ledger, not bubbles.** Cards are 8px radius (`rounded-lg`), controls 6px
  (`rounded-md`), and tags and state stamps 4px (`rounded-sm`). No `rounded-xl`
  and no `rounded-full` pills, except the 8px state dot.
- **Rules over boxes.** Separate sections with hairline rules and whitespace.
  A card is used only for the thing being acted on (the round card, the done
  summary, the export plan). Cards never nest. A proposal inside a row is an
  inset band with a background tint, not a second bordered card.
- **State is carried by shape and colour together**, so it survives
  greyscale and colour blindness:
  - settled: a solid dot;
  - frontier: an Ember ring;
  - loose end: a hollow Ochre ring;
  - stale: a dashed Ochre border;
  - unplaced: a dashed Ash border;
  - withdrawn: struck-through text;
  - blocked: a muted lock glyph.
- **Mono stamps.** State and provenance labels are 12px JetBrains Mono,
  uppercase, tracking 0.04em, on a 4px-radius tint. They never go smaller than
  12px.
- **Elevation.** Flat. Only the popover, dialog and sheet cast a shadow,
  tinted toward the warm neutral: `0 8px 24px hsl(24 20% 5% / 0.18)`.

## Anti-references

- A chat app: message bubbles, avatars, typing dots, a composer as the primary
  surface. The interview is cards and answers, not messages.
- Flames, fire emoji, grill-marks textures, or barbecue imagery.
- Purple or violet accents (the current `unplaced` violet goes), gradients,
  glow in dark mode, gradient text.
- Icon-tile feature grids, hero eyebrow chips, and any marketing composition
  inside the app.
- Scaffold leftovers: the agent-native logo, "Dev's workspace" as the most
  prominent footer item, and Database as a peer of Sessions.
- `side-tab` accents (a thick coloured left border on a card), including for
  the recommended choice.
- Labels under 12px, and 10–13px sizes stacked within 3px of each other.
- Burying the current ask: nothing may render above the round except the
  one-line Brief strip.

## Tokens

The app's theme is shadcn/ui CSS variables in `app/global.css`, stored as HSL
triplets and mapped by `@agent-native/core`'s `@theme inline`
(`--color-x: hsl(var(--x))`). Every token below is an HSL triplet for that
file. Contrast ratios were computed against the stated surface (WCAG 2.x).

### Colour: light (`:root`)

| Variable | Name | Hex | HSL triplet | Role | Contrast |
| --- | --- | --- | --- | --- | --- |
| `--background` | Paper | #F7F5F2 | `36 24% 95.9%` | canvas | |
| `--foreground` | Char | #1C1917 | `24 10% 10%` | text | 16.1 on Paper |
| `--card` | Sheet | #FDFCFA | `40 43% 98.6%` | cards, popovers | |
| `--card-foreground` | Char | #1C1917 | `24 10% 10%` | | 17.1 on Sheet |
| `--popover` | Sheet | #FDFCFA | `40 43% 98.6%` | | |
| `--popover-foreground` | Char | #1C1917 | `24 10% 10%` | | |
| `--primary` | Ember | #C23B12 | `14 83% 41.6%` | primary action, frontier ring, focus | 4.9 on Paper |
| `--primary-foreground` | Ember Ash | #FFF8F4 | `22 100% 97.8%` | text on Ember | 5.1 |
| `--secondary` | Linen | #EFECE8 | `34 18% 92.4%` | secondary buttons | |
| `--secondary-foreground` | Char | #1C1917 | `24 10% 10%` | | |
| `--muted` | Linen | #EFECE8 | `34 18% 92.4%` | quiet fills, bands | |
| `--muted-foreground` | Smoke | #6B635C | `28 8% 39%` | secondary text | 5.4 on Paper, 5.0 on Linen |
| `--accent` | Linen Deep | #E4DFD8 | `35 18% 87.1%` | hover and selected rows | |
| `--accent-foreground` | Char | #1C1917 | `24 10% 10%` | | 13.2 |
| `--destructive` | Crimson | #B42318 | `4 76% 40%` | delete, irreversible | 6.4 on Sheet |
| `--destructive-foreground` | Ember Ash | #FFF8F4 | `22 100% 97.8%` | | |
| `--border` | Rule | #E2DDD7 | `33 16% 86.5%` | hairlines (decorative) | |
| `--input` | Rule Strong | #948B82 | `30 8% 54.5%` | form field borders | 3.3 on Sheet |
| `--ring` | Ember | #C23B12 | `14 83% 41.6%` | focus ring | 5.2 on Sheet |
| `--sidebar-background` | Linen | #EFECE8 | `34 18% 92.4%` | rail | |
| `--sidebar-foreground` | Smoke Deep | #5E5750 | `30 8% 34.1%` | rail text | 6.0 |
| `--sidebar-primary` | Ember | #C23B12 | `14 83% 41.6%` | active-row indicator, New session plus glyph | |
| `--sidebar-primary-foreground` | Ember Ash | #FFF8F4 | `22 100% 97.8%` | | |
| `--sidebar-accent` | Linen Deep | #E4DFD8 | `35 18% 87.1%` | active row | |
| `--sidebar-accent-foreground` | Char | #1C1917 | `24 10% 10%` | | |
| `--sidebar-border` | Rule | #E2DDD7 | `33 16% 86.5%` | | |
| `--sidebar-ring` | Ember | #C23B12 | `14 83% 41.6%` | | |

### Colour: dark (`.dark`)

| Variable | Name | Hex | HSL triplet | Contrast |
| --- | --- | --- | --- | --- |
| `--background` | Charcoal | #151311 | `30 11% 7.5%` | |
| `--foreground` | Bone | #ECE7E1 | `33 22% 90.4%` | 15.1 on Charcoal |
| `--card` / `--popover` | Coal | #1D1A17 | `30 12% 10.2%` | |
| `--card-foreground` | Bone | #ECE7E1 | `33 22% 90.4%` | 14.1 on Coal |
| `--primary` / `--ring` | Ember Lit | #F26B38 | `16 88% 58.4%` | 6.1 on Charcoal, 5.7 on Coal |
| `--primary-foreground` | Soot | #1A0D07 | `19 58% 6.5%` | 6.3 on Ember Lit |
| `--secondary` / `--muted` | Cinder | #26221E | `30 12% 13.3%` | |
| `--muted-foreground` | Smoke Lit | #A39A91 | `30 9% 60.4%` | 6.7 on Charcoal, 5.7 on Cinder |
| `--accent` | Cinder Deep | #2E2924 | `30 12% 16%` | |
| `--accent-foreground` | Bone | #ECE7E1 | `33 22% 90.4%` | |
| `--destructive` | Crimson Lit | #F26D6D | `0 84% 68.8%` | 5.9 on Coal |
| `--destructive-foreground` | Soot | #1A0D07 | `19 58% 6.5%` | |
| `--border` | Rule Dark | #35302A | `33 12% 18.6%` | |
| `--input` | Rule Dark Strong | #6E655C | `30 9% 39.6%` | 3.0 on Coal |
| `--sidebar-background` | Pit | #100E0C | `30 14% 5.5%` | |
| `--sidebar-foreground` | Smoke Lit | #A39A91 | `30 9% 60.4%` | 7.0 on Pit |
| `--sidebar-primary` | Ember Lit | #F26B38 | `16 88% 58.4%` | |
| `--sidebar-primary-foreground` | Soot | #1A0D07 | `19 58% 6.5%` | |
| `--sidebar-accent` | Cinder | #231F1B | `30 13% 12.2%` | |
| `--sidebar-accent-foreground` | Bone | #ECE7E1 | `33 22% 90.4%` | 13.3 |
| `--sidebar-border` / `--sidebar-ring` | Rule Dark / Ember Lit | | `33 12% 18.6%` / `16 88% 58.4%` | |

### Colour: decision semantics (new variables)

Add these to both `:root` and `.dark`, and register them next to the
framework's `@theme inline` block in `global.css`:
`--color-settled: hsl(var(--settled));` and likewise for the others. Tints are
the same variable at an alpha (`bg-settled/10`, `border-settled/30`). They
replace every hard-coded `emerald-*`, `orange-*`, `amber-*`, `sky-*` and
`violet-*` class in `decision-state-badge.tsx`, `round-card.tsx`,
`export-visibility-report.tsx` and their siblings.

| Variable | Name | Light | Dark | Role | Contrast (on card) |
| --- | --- | --- | --- | --- | --- |
| `--settled` | Tempered | #2B7A51 `149 48% 32.4%` | #5FBF8A `147 43% 56.1%` | settled, accepted, tracked | 5.1 / 7.7 |
| `--owed` | Ochre | #8F5F00 `40 100% 28%` | #E0A93B `40 73% 55.5%` | loose end, stale, untracked, deferred | 5.4 / 8.2 |
| `--repo` | Steel | #39617F `206 38% 36.1%` | #86ADCE `207 42% 66.7%` | repo provenance, citations, commits | 6.4 / 7.3 |
| `--frontier` | Ember text | #B23610 `14 84% 38%` | #F58A5E `17 88% 66.5%` | frontier labels and ring as text | 6.0 / 7.2 |
| `--unplaced` | Ash | = `--muted-foreground` | = `--muted-foreground` | unplaced, withdrawn, blocked | 5.4 / 6.3 |

Loose end and stale share Ochre because both are what the session still owes.
Shape tells them apart: a hollow ring for a loose end, a dashed border for
stale.

### Type

- Families: `--font-sans: "IBM Plex Sans Variable", "IBM Plex Sans",
  ui-sans-serif, system-ui, sans-serif` and `--font-mono: "JetBrains Mono
  Variable", ui-monospace, monospace`, self-hosted through
  `@fontsource-variable/ibm-plex-sans` and
  `@fontsource-variable/jetbrains-mono`, replacing Inter.
- Scale: a 1.25 ratio on a 16px base, with 14px for dense UI. There are no
  sizes between the steps.

| Token | Size / line height | Weight | Family | Use |
| --- | --- | --- | --- | --- |
| `label` | 12 / 16 | 500, uppercase, +0.04em | mono | section labels, state stamps, counts |
| `meta` | 12 / 18 | 400 | mono | ids, paths, commits, citations, timestamps |
| `ui` | 14 / 20 | 400–500 | sans | controls, rows, rationales, tree items |
| `body` | 16 / 26 | 400 | sans | question body, recommendation, summaries, spec |
| `question` | 20 / 28 | 600, −0.01em | sans | round card question title |
| `title` | 25 / 32 | 600, −0.015em | sans | page and session titles, the done lede |
| `display` | 31 / 38 | 600, −0.02em | sans | empty states only |

- Body copy measure is at most 68ch. Headings use `text-wrap: balance`, and
  numbers use `tabular-nums`.

### Spacing (4pt base)

| Token | px | Tailwind | Use |
| --- | --- | --- | --- |
| `space-1` | 4 | `1` | icon to label |
| `space-2` | 8 | `2` | inside stamps, between chips |
| `space-3` | 12 | `3` | between choice rows, list row padding-y |
| `space-4` | 16 | `4` | card padding-x (narrow), between related blocks |
| `space-6` | 24 | `6` | card padding (wide), between card sections |
| `space-8` | 32 | `8` | between cards, between column sections |
| `space-12` | 48 | `12` | between page regions |

Rhythm: inside a card 12 → 24, between cards 32, between regions 48. Uniform
16 everywhere (`monotonous-spacing`) is the failure to avoid.

### Radius

- `--radius: 0.5rem` (8px, unchanged). So `rounded-lg` is 8px for cards and
  sheets, `rounded-md` is 6px for buttons, inputs and choice rows, and
  `rounded-sm` is 4px for stamps and tags.
- `rounded-xl` and `rounded-full` are not used, except the 8px state dot and
  avatars.

### Motion

- 120ms for colour and opacity; 180ms for disclosure (height via
  `grid-template-rows`, not `height`). Easing is `cubic-bezier(0.16, 1, 0.3,
  1)`.
- There is no entrance animation on cards.
- The working turn shows a 2px Ember progress hairline at the top of the bench
  and the elapsed time in mono. There is no spinner larger than 16px.
- Honour `prefers-reduced-motion`: hover and disclosure transitions become
  instant.

### Focus and states

- Every interactive element gets `focus-visible:ring-2 ring-ring
  ring-offset-2 ring-offset-background` (Ember). The ring is never removed, and
  hover never replaces it.
- Disabled uses `opacity-50` plus `cursor-not-allowed`, and always keeps a
  visible reason nearby (the confirm button already does this; hold every
  gated action to it).
- Hit targets are at least 36px tall on desktop and 44px on touch
  (`pointer: coarse`).

## Core components

Each item names the shadcn primitive it builds on. No new component library.

### Round card (`Card`)

- Anatomy, top to bottom:
  1. **Stamp row:** the index in mono (`01`), the provenance stamp
     (`INTERVIEWER`, `YOU`, or `REPO · RECORDED` in Steel), and the state
     stamp, right-aligned.
  2. **Question:** 20px, then the body at 16px/26 in Smoke, at most 68ch.
  3. **Choices.**
  4. **Recommendation.**
  5. **Steering row.**
- Frontier card: `border-primary/40` plus a 2px Ember ring on the index
  numeral, with no side stripe.
- Answered card: `border-border`. In a multi-card round it folds to the stamp
  row, the question and the answer band.
- Padding is 24px (16px below `sm`). The gap between cards is 32px.

### Choice (`button`, `aria-pressed`)

- A full-width row with a 6px radius, a 1px `border-input` border, and 12px by
  16px padding. The label is `ui` 500 and the rationale is `ui` 400 in Smoke.
- Hover: `bg-accent`.
- Selected: `border-foreground`, `bg-accent`, and a leading check.
- Keyboard: arrow keys move between choices, and Enter or Space picks.
  Number keys `1`–`9` pick the nth choice while the card has focus.

### Recommendation

- Marked **on the choice itself** and not repeated in a separate block. The
  recommended row gets an Ember `RECOMMENDED` stamp beside the label and a
  `border-primary/50` border.
- The interviewer's reasoning for it sits directly under that row, as an inset
  band (`bg-muted`, 6px radius, `body` size, no border), with the primary
  **Accept** button at the band's right.
- When there are no choices, the recommendation band stands alone with Accept.
- When there is no recommendation, the band says "No recommendation" in Smoke,
  without italics.
- After an answer, the band collapses to one line ("Recommended: …") with
  **Accept instead** as a ghost button.

### Answer states (answer band inside the card)

| State | Icon | Colour | Label (existing key) | Settles? |
| --- | --- | --- | --- | --- |
| Accepted recommendation | check | Tempered | `workspace.kindAcceptedRecommendation` | yes |
| Own answer | pencil | Tempered | `workspace.kindOwnAnswer` | yes |
| I don't know | hollow ring | Ochre | `workspace.kindUnknown` | no, loose end |
| Pushed back | corner-up-left | Ochre | `workspace.kindPushedBack` | no, loose end |
| Deferred | clock | Ochre | `workspace.kindDeferred` | no, loose end |
| Needs a prototype | flask | Ochre | `workspace.kindPrototypeFlagged` | no, loose end |
| Set aside | archive | Smoke | `workspace.kindDispositioned` | yes, out of scope or open question |
| From the repo | git-commit | Steel | `workspace.kindRepoEstablished` | yes, carries a citation |

- The band has a 10% tint of its colour, a 30% border, the label as a mono
  stamp, the answer at `body` size, and **Change** as a ghost button.
- The icon and the label both carry the state, never colour alone.

### Steering moves

- Heading: `label` "OR STEER THE INTERVIEW".
- Four `Button variant="outline" size="sm"` controls: I don't know, Push back,
  Defer, Needs a prototype.
- The row sits under a hairline rule and wraps into a 2×2 grid on narrow
  widths.
- Push back and Needs a prototype open an inline `Textarea` inside the card.
  Nothing opens in a dialog.

### Submit bar

- Sticky to the bench's bottom edge.
- Contents: a segmented progress track (one segment per card, coloured by
  answer state), the mono count `2 / 6 answered`, and **Submit round**
  (primary, Ember).
- Disabled until every card is answered, with the reason inline.

### Loose-end row (list item, not a card)

- A hairline-separated row with a hollow Ochre ring and the question title as a
  link. The reason (`workspace.reason*`) is in Smoke, and actions sit
  right-aligned: **Answer now** (outline) and **Set aside** (ghost).
- Rows are grouped under two labels: `YOURS TO RESOLVE` and `THE
  INTERVIEWER'S` (stale, unplaced, never answered), the second with **Continue
  the interview**.

### Supersession proposal (inset band inside a loose-end row)

- A `bg-repo/8` band with a 6px radius and no border.
- Contents: a link glyph with "Answered by: {title}" (the title is a link to
  the decision), the proposed answer at `body` size, the reason in Smoke, then
  **Accept** (primary) and **Not the same** (ghost).
- It reads as an offer inside the row, never as a replacement answer.

### Done panel

1. **Lede:** a flag glyph and a `label` "THE INTERVIEWER PROPOSES YOU ARE
   DONE", then the summary at `title` size (25px) when it is under 140
   characters, or `body` when longer.
2. **Tally** (a mono strip): `12 settled · 1 loose end · 2 set aside`.
3. **Loose ends** (above), with "Check for answered loose ends" as a ghost
   action beside the heading.
4. **Confirm bar:** the blocking sentence on the left and **Confirm shared
   understanding** (primary) on the right. Disabled while any loose end
   remains.

The confirmed state swaps the lede to a Tempered check with "Shared
understanding confirmed" and the primary action to **Open the output**.

### Spec view (output)

- A status line comes first: `SPEC · current · written 4 min ago from 14
  decisions` in mono, plus **Regenerate** (outline).
- Rendered markdown at `body` size, 68ch, `h2` at `question` size.
- Each decision reference in the spec links back to the tree.

### Ticket view (output)

- A table with columns `#` (mono), title, blocked-by (mono chips), wave,
  status, and build record.
- Waves group the rows under `label` headers ("WAVE 1 · no blockers").
- A stale ticket set shows an Ochre dashed banner: "Tickets were cut from an
  earlier spec" with **Re-cut tickets**.

### Export status (output and project page)

- The plan lists every file as a row: its mono relative path, and a stamp for
  what will happen to it (`WRITE`, `KEEP · edited`, or `REMOVE`).
- A visibility stamp comes after the write, from its git standing:

  | Standing | Colour |
  | --- | --- |
  | tracked | Tempered |
  | ignored | Smoke |
  | untracked | Ochre |
  | unchecked | Smoke, dashed border |

- A gate banner explains a blocked export (`handoff-missing`,
  `handoff-stale`) before the button is pressed. **Export to
  {project}** is the primary action.
- The last export shows as `Exported 2 h ago · 9 files · HEAD 0c00712`.

### Turn attempt log and batch progress

- Attempt kinds: `tree-rule-refusal` and `rate-limit` are Ochre, `schema-invalid` and `error` are Crimson, and each kind's label, not its colour, tells `schema-invalid` apart from `error`.
- A running batch is a neutral `muted` panel with the 2px Ember working hairline at its top edge, the same treatment as a running interviewer turn, and no fill colour. Each processed segment of its track takes its own outcome: Tempered when answered and settled, Ochre when answered as a loose end, Smoke when skipped, Crimson when failed.

### State stamp (`Badge` restyled)

- 12px mono uppercase on a 4px-radius tint with a leading shape glyph (see
  Shape language).
- It replaces the current 10px `rounded-full` pill. Sizes in
  `decision-state-badge.tsx` rise from 10px to 12px.

## Information architecture

```
Sidebar
  [grate] grill room                    [search] [collapse]
  [+ New session]                       (secondary fill, Ember plus glyph)
  Sessions                              all sessions, filterable
  Projects                              registry and project pages
  RECENT                                5 most recent unconfirmed sessions,
    • Offline training log   owed 1       each with a state dot and an owed count
    • Decisions.md export    2/6
  ────────
  footer: workspace / account menu      (Database and Observability live here)
```

- `/` shows the Sessions list: a project filter (All · each project ·
  Unassigned), the project as a mono column, the state, and the owed count.
- `/projects` is the registry. `/projects/:id` is a project page with the tabs
  Sessions · Exports · Settings. "New session in this project" pre-fills the
  project.
- `/sessions/:id` stays flat. The header shows a breadcrumb,
  `marathon-tracker / Offline training log`, when a project is set.
- Settings keeps the account, workspace, agent tabs, language and default
  model. Project registration and editing move to Projects, and the Settings
  search entry "projects" links there.

## Guardrails

- Preserve the scaffold's semantic token names and shared component seams.
  Every colour above arrives through a variable, and no hex values appear in
  components.
- The design tree, rounds and loose ends stay wired to the existing actions.
  The sidebar's Recent list reads `list-sessions` and is not a second store.
- Keep domain pages distinct from the AgentSidebar. The interview is not a
  chat, and the agent chat is not the interview.
- Every new visual state lands with a Playwright scenario under `e2e/`.

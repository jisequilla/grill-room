# Session record: the founding decisions and where decisions live

Claude Code session of 2026-10-26, working bead `gr-ehur`. The owner (Jeremias De Isequilla) with Claude (claude-opus-5-5). Written by Claude at the time of capture. The owner's words are quoted literally; everything else is Claude's summary.

## The evidence

`gr-ehur` asks to distil the founding spec's stories 81-86 and 78, and whatever of Pipe's review and meeting is not yet in the bundle. A sonnet agent checked those stories against the code, and Claude confirmed the one it found false by running the server.

- **78**, the Orchestrating agent writes a build record without the browser: true. `grill-room/actions/set-build-record.ts` is callable as `pnpm action set-build-record` or over HTTP at `/_agent-native/actions/set-build-record`, and HANDOFF.md renders the exact command (`grill-room/server/handoff.ts:1357`).
- **81**, Claude through the Claude Code CLI on the subscription, no API key: true for every call the app makes (`claude -p`, `grill-room/server/interviewer/claude-cli.ts:92`). The framework's own key-based chat plugin and provider packages are still installed.
- **82**, a clear error when the CLI is missing or logged out: true, with a message and a hint for each (`grill-room/app/i18n/en-US.ts:364`).
- **83**, an interviewer with no tools: true without a docs folder (`--allowed-tools ""`, `claude-cli.ts:259`). With a docs folder the interviewer gets Read, Grep and Glob, and the scouts always have them, restricted and with secret files denied. No call can run a command or write.
- **84**, localhost with no login: false. Auth is off only because the local `.env` sets `AUTH_DISABLED=true`, and the dev server listens on every interface: a throwaway instance listened on `*:8391` and answered on the machine's LAN address. Filed as `gr-3u9i`.
- **85**, a local embedded database: true by default (PGlite at `./data/pglite`); `DATABASE_URL` can point elsewhere. The app's own code makes no network call but the CLI's.
- **86**, the grilling skill text unmodified: true for the text, which a test pins byte-identical to the repository's copy (`grill-room/server/interviewer/instructions.test.ts:26`). The app wraps it in an opening line, an addendum of six rules, an optional docs-folder addendum and a JSON schema for the output.

Pipe's review is in the bundle only in part: export defects 1-4 in "Trust the exported bundle", and the review protocol and briefs in the roles. Defects 5-7 and the interview-depth gaps are not. Pipe's meeting also covers tooling, the open-source or service question, domains, a landing page, the ambassador programme and collaborator access, none of it about what Grill Room does today.

## The owner's answers

On how stories 81-86 enter the bundle, offered as founding decisions in `memory/product/decisions/`, as Idea owner use cases, or as one constraints page: "founding decision, i would say product, i am questioning the memory domeain, i think this is an anti pattern".

On their granularity: "Grouped, ~4 files": runs on the Claude subscription (81, 82); the interviewer has no tools (83); everything stays on the owner's machine (84, 85); the grilling skill is the method, unmodified (86).

On Pipe's meeting material that is not about Grill Room today: "Keep fragment not ingested".

On what to do first, offered as fixing `gr-3u9i`, restructuring `memory/` or finishing `gr-ehur`: "Restructure memory/ first".

On where decisions and open questions live instead of `memory/`: "In the module they decide", with the decisions about the bundle itself in a root `decisions/` folder.

On the founding decision that everything stays on the owner's machine while the code breaks it: "In force, with a known breach", citing `gr-3u9i` until the fix merges.

On Pipe's review leftovers: "Yes, then mark it ingested": defects 5-7 join "Trust the exported bundle", the interview-depth gaps become one Idea owner use case, and the review fragment is marked ingested.

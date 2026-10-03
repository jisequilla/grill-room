# 04 Refuse scout reports with bad or missing rule claims

Status: ready-for-agent
Blocked by: 01, 03
Bead: `gr-c0t.27`

## What to build

Server checks on rule claims in `grill-room/server/brief-grounding.ts`, alongside the existing citation, file, blocker and reach checks. After the scout reports a ticket's `filesToChange`, match the rule sources against them with the matcher from ticket 1, then refuse and retry the whole report when:

- a rule citation points outside the collected rule sources, or names a line that does not exist;
- a claim cites a rule file that has `paths:` globs and none of them match the ticket's `filesToChange`;
- a required file does not exist in the repository;
- a rule file matched to the ticket by a `paths:` glob has no claim. An explicit, cited "requires no files" claim satisfies this.

Silence on a source without `paths:` frontmatter is allowed. A claim made from such a source is still checked for a real citation and existing required files. Match only against `filesToChange`, never reach or builds-on files. Refusals use the existing refuse-and-retry flow and messages style.

## How it will be judged

In `grill-room/server/brief-grounding.test.ts`, one test per case:

- citation outside the collected sources is refused;
- bad line is refused;
- claim for a rule whose globs do not match the ticket is refused;
- required file that does not exist is refused;
- silence on a glob-matched rule is refused;
- silence on a frontmatter-less source is accepted;
- an explicit "requires no files" claim on a glob-matched rule is accepted;
- a file in reach only does not make a rule mandatory.

A refused report is retried the same way as other refused scout reports.

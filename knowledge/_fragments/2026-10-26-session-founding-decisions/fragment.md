---
type: Fragment
title: Session on the founding decisions and where decisions live
description: The owner settles how the founding spec's running-locally stories enter the bundle, removes the memory module so decisions live in the module they decide, and folds Pipe's review leftovers into the use cases.
tags: [conversation, claude-code, decisions, modules]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-26T12:00:00+01:00
# ── fragment ───────────────────────────
date: 2026-10-26
origin: conversation
tool: claude-code
ingested: true
in_git: true
material:
  - file: material/acta.md
    sha256: b9821d579a52df2dace42e04fd5db43da6842e9f877713736ddba543237346a1
---

# Session on the founding decisions and where decisions live

Working bead `gr-ehur`, a sonnet agent checked the founding spec's stories 78 and 81-86 against the code, and Claude confirmed by running the server that the app is not bound to localhost. The owner chose founding decisions in the product module for stories 81-86, grouped by what they protect, and called the memory module an anti-pattern: decisions move to the module they decide, with the bundle's own at the root. Pipe's review leftovers join the use cases; Pipe's meeting stays not ingested.

## Log

* **2026-10-26 · Capture**: Record written by Claude after the owner's answers, quoting them literally.
* **2026-10-26 · Ingestion**: One bundle [decision](/decisions/decisions-live-in-their-module.md), and every decision and open question moved out of the memory module into the module it decides.
* **2026-10-27 · Ingestion**: Four founding [decisions](/product/index.md), the Orchestrating agent's build-record use case, and Pipe's review leftovers in two use cases.

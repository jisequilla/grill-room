# Session record: committing the bundle and choosing DDD for its boundaries

Claude Code session of 2026-10-17 in `poc-grill-me`, the owner (Jeremias De Isequilla) with Claude (claude-opus-5-5), after the owner's flight. Written by Claude at the time of capture. The owner's words are quoted literally; everything else is Claude's summary.

## Committing the bundle

Before committing `knowledge/`, Claude found four files that quoted the private meeting transcript word for word: the Idea owner role, the decision on technical level, the use case on depth, and the record of the roles session. The repository is public. Offered to commit the meeting card and paraphrase the quotes, keep the quotes, or change the card, the owner chose "Card OK, paraphrase quotes". Claude paraphrased the four files and re-hashed the roles record before it was ever committed.

The bundle reached `main` through pull request #233, which the owner chose to merge.

## Domain-driven boundaries

With the Pipe grill prepared for a fresh conversation, the owner said:

> we should use DD Domain Dreaven Design principles to druve our knowledge boundries and bounded scope

Claude agreed, with evidence: OKF gives the bundle layers (what arrived, what we understand, what we derive) but no boundaries between areas of knowledge, and the repository shows the signs of contexts never drawn. `GLOSSARY.md` gives "proposal" four meanings (Proposal, Round proposal, Delegation proposal, Scout proposal); "preflight" means both the check before a grill and the check before a ticket launches; the specs used ten names for three or four roles; and `docs/agents/domain.md` records "Single-context: one GLOSSARY.md", a setup default rather than a choice. Claude proposed three candidate contexts as a hypothesis (Interview, Project knowledge, Delivery), one OKF module per context, and warned against two things: tactical DDD (aggregates, entities) inside the bundle, and two homes for the same vocabulary (`GLOSSARY.md` and `docs/adr/` beside `knowledge/`).

Asked which should be the source of truth, the owner answered:

> either glossary or ubiquitouse language, i think this last one has more track than glossary, what do you think?

Claude's answer: the two are not alternatives. Ubiquitous language is the discipline, one strict vocabulary per bounded context used alike in talk, documents and code; a glossary is only the document that records it. Ubiquitous language is the better frame because it is per context and binds the code. Claude proposed that each context module hold `language/` with one Term per file (definition, terms to avoid, where it lives in the code) as the canonical language, retiring the Concept type, and that `GLOSSARY-MAP.md` and one glossary per context be generated from it for the engineering skills, which read `GLOSSARY.md`. The owner chose "Yes, language/ is canonical".

On when to draw the contexts, the owner chose "Before the Pipe grill", so the grill's decisions land in the right context. Bead `gr-vtnq` tracks it; `gr-2sw` depends on it.

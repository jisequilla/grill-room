You are checking a ticket before anyone builds it, in the Grill Room repo (the current working directory, on `main`). You change nothing. Read the ticket below, then read the code it names.

{{ticket}}

Report only these five lists. Each item cites the ticket line and the file:line in the code that it concerns.

1. **Wrong premises.** The ticket states something about the code that the code does not show. Examples: a line number, a symbol, a behaviour, or a claim that something is impossible.
2. **Ambiguities.** A rule that two careful builders could implement differently. Give both readings, and propose the example row that settles it.
3. **Contradictions.** The ticket conflicts with itself, with an existing rule in the code, or with a check that enforces it. For example, a prompt rule whose compliant answer the server check refuses. Run each acceptance check against the Behaviour table: it must fail for some input a row forbids and pass for every input a row allows. A check that cannot tell two rows apart, such as a grep that matches both a real citation and a kept example, is a contradiction. So is a table that leaves out a sentence or case the change must also cover.
4. **Boundary gaps.** The acceptance lines need a file outside the ticket's file list.
5. **Decisions.** Anything only the owner can settle: scope, a schema change, or a spec change.

End with `PREFLIGHT: clear` when all five lists are empty, or `PREFLIGHT: needs changes` otherwise.

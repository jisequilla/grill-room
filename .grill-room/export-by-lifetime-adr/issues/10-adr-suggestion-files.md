# 10 Render one ADR suggestion file per ADR-worthy decision into the working root

Status: ready-for-agent
Blocked by: 07, 08

Add a suggestions folder under the working root, named to say it holds suggestions, with one file per ADR-worthy decision keyed by decision key. Each file is in Grill Room's own built-in shape regardless of repo convention: Status (Proposed), Context from the question and evidence, Decision from the accepted answer, Alternatives from the unchosen options and any superseded answers, Consequences from the stored field, Tickets from the implementing issues (empty list allowed), and Amends when the decision supersedes a repo decision cited from an existing ADR. Register these files in the working manifest so they are guarded and deleted with the working folder. Grill Room writes nothing into the repo's decisions folder and allocates no numbers.

Judged by: rendering tests for every section, a superseded-answer alternative, an Amends line, an empty Tickets list; a plan test that suggestions sit under the working root and appear in the working manifest only.
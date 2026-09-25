# 07 Link issues to the decisions they implement

Status: ready-for-agent
Blocked by: 06

Add a list of implemented decision keys to issues, filled by the interviewer at planning time and editable in the UI. At export, validate that every key resolves to a settled decision. Derive the reverse index (decision to issues). Emit a warning for any ADR-worthy decision with no implementing issue; issues with no keys are accepted without warning. Render each issue's decision references in its exported file.

Judged by: tests for key validation, reverse index derivation, warning on an orphan ADR-worthy decision, no warning on a keyless issue, and decision references present in the rendered issue.
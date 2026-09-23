# 05 Post-export visibility report with remedy and flag mismatch warning

Status: ready-for-agent
Blocked by: 04

After export, classify every written file as tracked, ignored or untracked using read-only git (check-ignore, ls-files, status). Show the report in the UI. When any file is ignored or untracked, show a plain warning that worktree agents will not see it and name the exact manual command the operator would run. When the observed state of the export directory disagrees with the project's visibility flag, show a mismatch warning naming both values. The app never stages or commits.

Judged by: tests against fixture repos covering tracked, ignored and untracked files; the warning text contains the remedy command; the mismatch warning appears only when flag and reality differ; no git write commands are ever invoked.
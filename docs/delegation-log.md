# Delegation Log

One row per delegated task. Bead close comments hold the detail; this table is the summary.

| Task | Model | First attempt passed | Escalated | What the prompt was missing |
|------|-------|----------------------|-----------|-----------------------------|
| Spike: Claude Code harness (`docs/spikes/claude-code-harness.md`) | opus | Yes: all six questions answered with evidence; the fallback claim reproduced independently by the main session | No | No limit on the permissions of the nested agent under test, which ran `kill` and `rm` on the host. No instruction to keep provisioned tokens out of command output; one was exposed and rotated. No instruction to remove throwaway files, so the main session cleaned up. |
| gr-01 App shell, chat removal, test harness | opus | Yes: tests 4/4, typecheck 0, live route and action checks by the main session | No | No leads on how the framework resolves its database handle. The agent asked the spike agent, which supplied unexecuted source-reading that turned out right. Peer help, not the prompt, closed the gap, so this pass overstates the prompt. |

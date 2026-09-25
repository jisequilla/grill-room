# 08 Render ADR-worthy mark, Amends target and Consequences in decisions.md

Status: ready-for-agent
Blocked by: 06

Extend decisions.md rendering so each ADR-worthy entry is marked, shows its Amends target when its decision supersedes a repo decision cited from an existing ADR, and renders its consequences. Carry no path to any suggestion file or repo ADR. Non-ADR-worthy entries render as today so decisions.md remains the full record. Keep the supersession parser working on the new format.

Judged by: rendering tests for a marked entry with and without Amends, an entry with consequences, an unmarked entry unchanged, and no file paths present; supersession parser round-trip still passes.
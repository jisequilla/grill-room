# 08 Export gate on current handoff and secondary generate-all action

Status: ready-for-agent
Blocked by: 07

Disable the export action until a handoff exists and is not stale, with an explanatory message. Add a secondary generate-all option that generates tickets, then handoff, then opens the export preview, while the separate steps remain the primary actions. Regenerating the handoff alone stays available.

Judged by: export disabled with no handoff, disabled with a stale handoff, enabled after regeneration; generate-all ends at the export preview without writing until confirmed; the individual actions remain visible and functional.
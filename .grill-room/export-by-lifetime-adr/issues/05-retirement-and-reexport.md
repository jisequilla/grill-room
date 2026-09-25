# 05 Detect a deleted working folder, mark the export retired, gate re-export

Status: ready-for-agent
Blocked by: 03

On project or session open, detect that a previously exported session's working root no longer exists and mark the session's export as retired. Grill Room never deletes the folder itself. Re-export of a retired session refuses by default with a message explaining that the build is done; an explicit override recreates the working folder from the plan and clears the retired mark. HANDOFF states that cleanup is a manual repo commit.

Judged by: tests that a missing working root sets the retired mark; a retired session's export is refused; the override recreates the working half and clears the mark; a session whose working root still exists is unaffected.
# 03 Plan and write the export bundle across two roots with one manifest per root

Status: ready-for-agent
Blocked by: 01

Extend the export plan so it remains the single source of truth for layout across both roots. Assign spec, decisions and intent to the durable root and issues, HANDOFF, briefs and the manifest to the working root, each under the same session slug as the leaf folder. Write one manifest per root. Run the edited-file guard, containment checks and export gate per root using that root's own manifest, so hand edits in the durable root are protected even after the working root is deleted. All links between the two halves (HANDOFF and briefs to spec and decisions, spec to tickets) are repo-root-relative.

Judged by: plan tests asserting file-to-root assignment and shared slug; manifest tests showing two manifests with the right entries; guard tests showing a hand-edited durable file is kept on re-export when the working manifest is absent; link tests asserting repo-root-relative paths in HANDOFF, briefs and spec.
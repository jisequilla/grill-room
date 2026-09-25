# 01 Replace exportFolder with durable and working export roots

Status: ready-for-agent
Blocked by: none

Replace the single project export folder setting with two repo-relative roots named by lifetime: a durable export folder (default the docs specs folder) and a working export folder (default `.grill-room`). Rename the existing field rather than keeping it alongside. Validate both identically and refuse two roots that are equal or nested one inside the other. Keep the names free of the word 'docs' so they cannot collide with the session-level read-only docs folder in schema, refusal codes or UI. Update the project settings UI to show and edit both fields. Update every caller of the old field so the build stays green, even where downstream export behaviour is still single-root for now.

Judged by: settings validation tests covering two roots accepted, equal roots refused, nested roots refused (both directions), defaults applied; no remaining references to the old field; build and existing test suite green.
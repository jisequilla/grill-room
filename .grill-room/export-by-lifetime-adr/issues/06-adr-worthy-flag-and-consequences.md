# 06 Add the ADR-worthy flag and consequences to decisions and proposals

Status: ready-for-agent
Blocked by: 03

Add two fields to decisions: an ADR-worthy flag and a user-editable consequences text. Extend the interviewer proposal schema so each proposed decision may carry the flag and consequences; extend the scout's repo decision proposal so it may carry the flag; user-added decisions default to unmarked with no consequences. Add a toggle on settled decisions in the tree UI to flip the flag and an editor for consequences. Persist both through the existing decision storage.

Judged by: schema and validation tests for all three proposal shapes; a test that toggling on a settled decision persists; a test that user-added decisions default unmarked; build green with the interviewer prompt updated to describe the new fields.
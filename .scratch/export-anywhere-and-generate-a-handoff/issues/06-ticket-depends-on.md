# 06 Ticket depends-on field, editing with cycle check, and wave derivation

Status: ready-for-agent
Blocked by: 04

Add a structured depends-on column to tickets and extend ticket generation so each ticket carries explicit dependencies on other tickets in the session. Render depends-on as YAML front-matter in exported ticket files. Provide per-ticket dependency editing in the UI with a cycle check on save that refuses with a clear message. Provide a wave computation (topological sort, stable ordering) usable by the handoff.

Judged by: migration applies cleanly; generated tickets include dependencies; exported ticket files carry the front-matter; the editor rejects a cycle; wave order is deterministic across repeated computations for the same input.
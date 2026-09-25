# 11 Generate the final 'record ADRs' ticket and the HANDOFF convention section

Status: ready-for-agent
Blocked by: 09, 10

When at least one ADR-worthy decision exists, export generates one issue sequenced last that records the ADRs. Its body is self-contained: the list of suggestion files, the detected convention (folder, numbering pattern, template, next-free-number hint) phrased as overridable hints, the Amends targets, and a done condition that every listed suggestion has a corresponding ADR in the repo folder. HANDOFF gains a section restating the convention hint, or stating that no convention was found and placement is the repo owner's call, and states that this ticket must close before the working folder is deleted.

Judged by: tests that the ticket is generated only when ADR-worthy decisions exist, is sequenced last, contains every listed element; HANDOFF tests for the found and not-found convention cases and the cleanup ordering statement.
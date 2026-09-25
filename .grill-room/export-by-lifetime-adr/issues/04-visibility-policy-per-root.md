# 04 Refuse export on an ignored durable root, warn on an ignored working root

Status: ready-for-agent
Blocked by: 03

Extend the export gate and post-export visibility classification to two roots. Export refuses with a clear message when the durable root is gitignored. Export proceeds with a warning when the working root is gitignored. Post-export classification and its warnings cover paths under both roots.

Judged by: gate tests for ignored durable root (refused), ignored working root (warned, export written), both tracked (no warning); classification tests over a mixed set of paths under both roots.
# 03 just recipe to register projects from the command line

Status: ready-for-agent
Blocked by: 01

Add a just recipe and backing CLI command that registers a project with flags for every registry field, root defaulting to the current directory's git root. It must call the shared validation module from ticket 1 so required fields, git-root resolution, verify-command suggestion and visibility-flag seeding behave identically to the UI form. Errors print the same messages the form shows.

Judged by: running the recipe from inside a fixture repo with only the required flags creates the same row the UI would; running outside a git repo fails with the refusal message; the recipe is documented in the justfile help.
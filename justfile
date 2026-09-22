set shell := ["bash", "-cu"]
set working-directory := "grill-room"

port := env("PORT", "8080")
lock := "data/pglite.agent-native-pglite.lock"

default:
    @just --list

# Install dependencies
setup:
    pnpm install

# Start the dev server against the real Claude CLI (refuses if one already owns the database)
dev: _guard
    pnpm exec agent-native dev --port {{port}} --strictPort

# Start the dev server with the fake interviewer: UI work without spending the Claude subscription
dev-fake: _guard
    GRILL_ROOM_INTERVIEWER=fake pnpm exec agent-native dev --port {{port}} --strictPort

# Show whether a server owns the database, and where it listens
status:
    #!/usr/bin/env bash
    pid=$(just _owner)
    if [ -z "$pid" ]; then echo "Grill Room is not running"; exit 0; fi
    url="http://localhost:$(just _port "$pid")/"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
    echo "Grill Room running: pid $pid, $url (HTTP $code)"

# Open the running instance in the browser
open:
    #!/usr/bin/env bash
    pid=$(just _owner)
    if [ -z "$pid" ]; then echo "Grill Room is not running; start it with 'just dev'"; exit 1; fi
    open "http://localhost:$(just _port "$pid")/"

# Stop the server that owns the database
stop:
    #!/usr/bin/env bash
    pid=$(just _owner)
    if [ -z "$pid" ]; then echo "Grill Room is not running"; exit 0; fi
    kill "$pid"
    for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || { echo "Stopped pid $pid"; exit 0; }; sleep 0.25; done
    echo "pid $pid did not exit; run 'kill -9 $pid' if it is stuck" >&2
    exit 1

# Stop any running instance, then start fresh
restart: stop dev

# Unit and action-boundary tests
test:
    pnpm test

# Browser smoke test (own port and throwaway database; safe alongside dev)
e2e:
    pnpm test:e2e

typecheck:
    pnpm typecheck

# Everything that should pass before a merge
check: typecheck test e2e

doctor:
    pnpm doctor

# Remove Agent-tool worktrees whose branch is merged into main (dirty or unmerged ones are kept and reported)
prune-worktrees:
    #!/usr/bin/env bash
    cd "$(git rev-parse --show-toplevel)"
    git fetch -q origin main
    shopt -s nullglob
    for path in .claude/worktrees/agent-*; do
      branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
      if ! git merge-base --is-ancestor "$branch" main && ! git merge-base --is-ancestor "$branch" origin/main; then
        echo "kept    $path ($branch is not merged)"
        continue
      fi
      if [ -n "$(git -C "$path" status --porcelain)" ]; then
        echo "kept    $path (uncommitted changes)"
        continue
      fi
      git worktree remove "$path" && git branch -D "$branch" >/dev/null && echo "removed $path ($branch)"
    done
    git worktree prune

# PID of the live process holding the PGlite lock, empty if none
_owner:
    #!/usr/bin/env bash
    [ -f {{lock}} ] || exit 0
    pid=$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' {{lock}})
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; fi

# Lowest TCP port a process listens on (the app port; the rest are internal)
_port pid:
    @lsof -nP -a -p {{pid}} -iTCP -sTCP:LISTEN -Fn | sed -n 's/^n.*:\([0-9]*\)$/\1/p' | sort -n | head -1

_guard:
    #!/usr/bin/env bash
    pid=$(just _owner)
    if [ -n "$pid" ]; then
      echo "Grill Room already running (pid $pid) at http://localhost:$(just _port "$pid")/" >&2
      echo "Use 'just open' to view it or 'just restart' to replace it." >&2
      exit 1
    fi

set shell := ["bash", "-cu"]
set working-directory := "grill-room"

port := env("PORT", "8080")
lock := "data/pglite.agent-native-pglite.lock"

default:
    @just --list

# Install dependencies
setup:
    pnpm install

# Register a project for session exports: flags for every registry field (see grill-room/actions/register-project.ts), root defaults to the current git top-level
[positional-arguments]
register-project *args:
    #!/usr/bin/env bash
    set -euo pipefail
    invocation_dir="{{invocation_directory()}}"
    declare -a call_args=("$@")
    root_index=-1
    for i in "${!call_args[@]}"; do
      if [ "${call_args[$i]}" = "--root" ]; then
        root_index=$i
      fi
    done
    if [ "$root_index" -ge 0 ]; then
      value_index=$((root_index + 1))
      if [ "$value_index" -ge "${#call_args[@]}" ]; then
        echo "register-project: --root requires a value" >&2
        exit 1
      fi
      raw_root="${call_args[$value_index]}"
      case "$raw_root" in
        /*|~*) resolved_root="$raw_root" ;;
        *) resolved_root="$invocation_dir/$raw_root" ;;
      esac
      call_args[$value_index]="$resolved_root"
    else
      # Not a git repo: fall through with the invocation directory itself, so
      # the action's own git-root resolution produces the same refusal the UI shows.
      default_root="$(git -C "$invocation_dir" rev-parse --show-toplevel 2>/dev/null || true)"
      if [ -n "$default_root" ]; then
        call_args=(--root "$default_root" "${call_args[@]}")
      else
        call_args=(--root "$invocation_dir" "${call_args[@]}")
      fi
    fi
    pnpm action register-project "${call_args[@]}"

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

# Browser smoke test: picks a free E2E_PORT when unset, so two worktrees running this at once don't collide.
# Scoped to the "chromium" project (playwright.config.ts) so the slow, video-recording
# "demo" project never runs here — use `just demo` for that.
e2e:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${E2E_PORT:-}" ]; then
      export E2E_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')"
    fi
    pnpm exec playwright test --project=chromium

# Record and compress the demo video: replays the `demo` scenario end to end with Playwright
# video on, then shrinks the result into docs/media/demo.webm (target under 5 MB), replacing
# any previous file. See e2e/demo.spec.ts for the walk and e2e/fixtures/ for its recording.
demo:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${E2E_PORT:-}" ]; then
      export E2E_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')"
    fi
    rm -rf e2e/artifacts
    pnpm exec playwright test --project=demo
    raw="$(find e2e/artifacts -name '*.webm' -print -quit)"
    if [ -z "$raw" ]; then
      echo "demo: Playwright produced no video" >&2
      exit 1
    fi
    mkdir -p ../docs/media
    /opt/homebrew/bin/ffmpeg -y -i "$raw" \
      -c:v libvpx-vp9 -crf 34 -b:v 0 -deadline good -cpu-used 2 -an \
      ../docs/media/demo.webm
    size=$(stat -f%z ../docs/media/demo.webm 2>/dev/null || stat -c%s ../docs/media/demo.webm)
    echo "docs/media/demo.webm: ${size} bytes"

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

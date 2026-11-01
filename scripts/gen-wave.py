"""Build a wave script: the saved workflow with WAVE_ARGS filled from the delegation templates.

usage: gen-wave.py <spec.json> <out.js> [--root <repo>]
spec: [{"bead", "ticket" (path), "title", "lenses": [str, ...], "model" (optional: "sonnet" or "opus"), "start" (optional: {"pr", "branch", "stage", "round" (optional), "findings"})}]
"""
import json
import os
import re
import sys

USAGE = "usage: gen-wave.py <spec.json> <out.js> [--root <repo>]"
SPEC_ENTRY_ERROR = "spec entry {} needs bead, ticket, title and lenses"
MODEL_ERROR = "spec entry {} model must be sonnet or opus"
START_ERROR = (
    "spec entry {} start needs pr, branch, stage (review or fix), "
    "round (1-2, or 3 with fix) and findings (required with fix)"
)
START_KEYS = ("pr", "branch", "stage", "round", "findings")
MODELS = ("sonnet", "opus")


def die(message):
    print(f"gen-wave.py: {message}", file=sys.stderr)
    sys.exit(1)


def usage():
    print(USAGE, file=sys.stderr)
    sys.exit(1)


def fill(text, values):
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)] if m.group(1) in values else m.group(0), text)


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        die(f"cannot read {path}")


def parse_args(argv):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    positional = []
    i = 0
    while i < len(argv):
        if argv[i] == "--root":
            if i + 1 >= len(argv):
                usage()
            root = argv[i + 1]
            i += 2
        elif argv[i].startswith("-"):
            usage()
        else:
            positional.append(argv[i])
            i += 1
    if len(positional) != 2:
        usage()
    return positional[0], positional[1], root


def non_empty_string(value):
    return isinstance(value, str) and value != ""


def whole_number(value):
    return isinstance(value, int) and not isinstance(value, bool)


def valid_start(start):
    if not isinstance(start, dict) or any(k not in START_KEYS for k in start):
        return False
    if not (whole_number(start.get("pr")) and start["pr"] > 0):
        return False
    if not non_empty_string(start.get("branch")):
        return False
    stage = start.get("stage")
    if not isinstance(stage, str) or stage not in ("review", "fix"):
        return False
    if "round" in start:
        r = start["round"]
        if not (whole_number(r) and (r in (1, 2) or (r == 3 and stage == "fix"))):
            return False
    if "findings" in start:
        f = start["findings"]
        if not (isinstance(f, list) and all(non_empty_string(x) for x in f)):
            return False
        if stage == "fix" and not f:
            return False
    elif stage == "fix":
        return False
    return True


def load_spec(path):
    text = read(path)
    try:
        spec = json.loads(text)
    except ValueError:
        die(f"{path} is not valid JSON")
    if not isinstance(spec, list):
        die(f"{path} must be a list")
    if not spec:
        die(f"{path} has no entries")
    for i, entry in enumerate(spec):
        valid = (
            isinstance(entry, dict)
            and all(non_empty_string(entry.get(k)) for k in ("bead", "ticket", "title"))
            and isinstance(entry.get("lenses"), list)
            and len(entry["lenses"]) > 0
            and all(isinstance(lens, str) for lens in entry["lenses"])
        )
        if not valid:
            die(SPEC_ENTRY_ERROR.format(i))
        if "model" in entry and entry["model"] not in MODELS:
            die(MODEL_ERROR.format(i))
        if "start" in entry and not valid_start(entry["start"]):
            die(START_ERROR.format(i))
    return spec


def anchor_index(lines, path):
    p = next((i for i, l in enumerate(lines) if "await pipeline(" in l), None)
    if p is None or p + 1 >= len(lines) or lines[p + 1] != "  args,":
        die(f'{path} has no "  args," line after "await pipeline("')
    return p


def rewrite_workflow(lines, path, anchor, wave):
    lines[anchor + 1] = "  WAVE_ARGS,"
    end = next((i for i, l in enumerate(lines) if l.startswith("}")), None)
    if end is None:
        die(f"{path} has no line closing the meta block")
    lines.insert(end + 1, "\nconst WAVE_ARGS = " + json.dumps(wave))
    return "\n".join(lines)


def main(argv):
    spec_path, out_path, root = parse_args(argv)
    spec = load_spec(spec_path)

    templates = os.path.join(root, ".claude", "templates", "delegation")
    builder, reviewer, fix = (read(os.path.join(templates, n + ".md")) for n in ("builder", "reviewer", "fix"))
    workflow_path = os.path.join(root, ".claude", "workflows", "ticket-build-review-loop.js")
    workflow_lines = read(workflow_path).split("\n")
    anchor = anchor_index(workflow_lines, workflow_path)
    tickets = [read(t["ticket"]) for t in spec]

    wave = []
    for t, ticket in zip(spec, tickets):
        entry = {
            "bead": t["bead"],
            "builder": fill(builder, {"bead": t["bead"], "ticket": ticket, "title": t["title"]}),
            "reviewers": [fill(reviewer, {"ticket": ticket, "lens": lens}) for lens in t["lenses"]],
            "fix": fill(fix, {"bead": t["bead"], "ticket": ticket}),
        }
        if "model" in t:
            entry["model"] = t["model"]
        if "start" in t:
            entry["start"] = t["start"]
        wave.append(entry)

    script = rewrite_workflow(workflow_lines, workflow_path, anchor, wave)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(script)
    print(f"wrote {out_path}: " + " ".join(f"{t['bead']}={len(t['lenses'])}" for t in spec))


if __name__ == "__main__":
    main(sys.argv[1:])

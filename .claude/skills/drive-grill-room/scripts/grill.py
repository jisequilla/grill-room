#!/usr/bin/env python3
"""Drive a Grill Room server through its HTTP actions.

  grill.py call <action> '<json body>' [out.json]   POST an action, print or save the result
  grill.py get <action> key=value ... [out.json]    GET a read action (get-session, preview-export, ...)
  grill.py answer <round.json> <answers.json> <out.json>
      Save one draft answer per card, then submit the round. answers.json maps
      each card's key to [answerKind, text-or-null]. out.json receives the
      submit-round result, which carries the next round or the done proposal.

The server is GRILL_ROOM_URL (default http://localhost:8082).
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("GRILL_ROOM_URL", "http://localhost:8082").rstrip("/") + "/_agent-native/actions/"
# Spec synthesis, handoff and grounding each take minutes; ground-briefs has taken close to forty.
TIMEOUT = 2400


def request(req):
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{req.full_url} -> {e.code}: {e.read().decode()[:2000]}")


def post(action, body):
    return request(urllib.request.Request(
        BASE + action, data=json.dumps(body).encode(), headers={"content-type": "application/json"}))


def get(action, params):
    return request(urllib.request.Request(BASE + action + "?" + urllib.parse.urlencode(params)))


def emit(result, out):
    if out:
        with open(out, "w") as f:
            json.dump(result, f, indent=1)
        print(f"saved {out}; keys: {list(result)[:10] if isinstance(result, dict) else type(result).__name__}")
    else:
        print(json.dumps(result, indent=1))


def answer(round_file, answers_file, out):
    with open(round_file) as f:
        rnd = json.load(f)["round"]
    with open(answers_file) as f:
        answers = json.load(f)
    ids = {d["key"]: d["id"] for d in rnd["decisions"]}
    missing = set(ids) - set(answers)
    if missing:
        sys.exit(f"no answer for cards: {sorted(missing)}")
    for key, (kind, text) in answers.items():
        body = {"decisionId": ids[key], "answerKind": kind}
        if text:
            body["answer"] = text
        post("save-draft-answer", body)
        print("saved", key, kind)
    result = post("submit-round", {"id": rnd["id"]})
    emit(result, out)
    print("state:", result.get("state"))


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd = argv[1]
    if cmd == "call":
        emit(post(argv[2], json.loads(argv[3])), argv[4] if len(argv) > 4 else None)
    elif cmd == "get":
        rest = argv[3:]
        out = rest.pop() if rest and "=" not in rest[-1] else None
        emit(get(argv[2], dict(p.split("=", 1) for p in rest)), out)
    elif cmd == "answer":
        answer(argv[2], argv[3], argv[4])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)

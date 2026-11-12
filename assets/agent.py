"""The agent behind the profile.

Someone opens an issue titled "agent: <question>". A workflow runs this, the
answer lands on the sheet, and the issue gets a reply and is closed.

It works the same way the fashion assistant does. A rule based router handles
the question on its own, and if GROQ_API_KEY happens to be set in the repo
secrets the answer is written by a model instead. No key means no failure, just
the shorter path, which is the whole point of the second principle on the sheet.
A model that cannot be reached, answers with nothing, or answers in a shape we
do not recognise is treated the same way: the router's answer is used and the
path taken is printed so the workflow log says which one it was.

Nothing here trusts the issue body. The question is taken from the title, cut to
length, stripped of markup, and only ever used as data. A title that has no
question left after cleaning writes nothing: asked.json is left untouched and
the issue still gets a reply, so a blank or markup-only issue can never blank
out the panel.
"""

import json
import os
import pathlib
import re
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).parent
LOG = HERE / "asked.json"
MAX_Q = 120
MAX_A = 320
KEEP = 4

EMPTY_REPLY = ("Ask me something after the colon, like: "
               "agent: what is Forge Mentor")

FACTS = {
    "forge": ("Forge Mentor is a Claude Code plugin. It teaches the architectural "
              "decision, waits for your call, records it to .claude/forge, and blocks "
              "code until the question is answered. 1,216 tests at full coverage."),
    "news": ("The AI News Aggregator reads 164 sites and 36 YouTube channels and emails "
             "five picks every morning. Groq writes the summaries, Gemini covers the "
             "outages."),
    "skyelite": ("SkyElite AI took 3rd at the National AI Hackathon. Seven node LangGraph "
                 "pipeline, ranks destinations against passport and budget, and runs with "
                 "zero API keys because every call degrades to a mock."),
    "bitmadwall": ("BitMadWall carries encrypted messages and Bitcoin across a mesh of "
                   "phones. Bluetooth LE, Wi-Fi Direct and LoRa, up to seven hops, no "
                   "servers anywhere in the path."),
    "employeeos": ("AI Employee OS turns one plain English request into a dependency "
                   "aware workflow, routes each piece to the agent that owns it, and "
                   "hands back the full execution trace."),
    "stack": ("Python, TypeScript and C++ mostly. LangGraph and LangChain for "
              "orchestration, FastAPI and Pydantic v2 on the backend, Postgres and "
              "Supabase underneath, Docker and Vercel to ship."),
    "hire": ("Currently at Arbisoft, open to contract work and startup collaborations "
             "around AI agents and backend systems. Email is on the sheet above."),
    "guardrails": ("Rate limiting, input validation and row level security land before "
                   "the features do, because that is the part a client ends up "
                   "depending on."),
    "agent": ("This answer came from a router in assets/agent.py, triggered by the issue "
              "you opened, written back onto the sheet by a workflow. If GROQ_API_KEY is "
              "set it uses a model instead. It is the same fallback pattern the projects "
              "use."),
}

ROUTES = [
    (r"forge|plugin|claude code|decision|gate", "forge"),
    (r"news|aggregat|digest|scrape|rss", "news"),
    (r"skyelite|travel|hackathon|passport|visa", "skyelite"),
    (r"bitmad|mesh|lora|bluetooth|offline|bitcoin", "bitmadwall"),
    (r"employee|orchestrat|dag|workflow|multi.?agent", "employeeos"),
    (r"stack|tech|language|framework|tool|python|fastapi|langgraph", "stack"),
    (r"hire|hiring|available|freelance|contract|job|work with|remote", "hire"),
    (r"guardrail|security|rls|rate limit|validation|production", "guardrails"),
    (r"how does this work|how do you work|are you real|bot|this agent", "agent"),
]

FALLBACK = ("Not sure I have a good answer for that one. Try asking about a project by "
            "name, the stack, how the guardrails work, or whether he is available.")


def clean(question):
    """Take the question as data. Never as markup, never as instructions.

    The agent: prefix comes off once, markup characters become spaces so no
    half marker can survive a later cut, whitespace collapses to single
    spaces, and the result is capped at MAX_Q characters. The final strip
    means truncation never leaves a dangling space or a partial marker.
    """
    q = re.sub(r"^\s*agent\s*:\s*", "", question, flags=re.I)
    q = re.sub(r"[`<>|*_\[\]\(\)#]", " ", q)
    q = re.sub(r"\s+", " ", q).strip()
    return q[:MAX_Q].strip()


def route(question):
    low = question.lower()
    for pattern, key in ROUTES:
        if re.search(pattern, low):
            return FACTS[key], key
    return FALLBACK, "none"


def via_model(question, key):
    """Optional. Only reached when a key exists, and any failure falls back.

    Raises on transport trouble and on an unexpected response shape, so the
    caller's single fallback path covers a dead endpoint, an HTTP error, an
    empty choices list, a missing message, and a non-string body alike.
    """
    system = ("You answer questions about Muhammad Hassaan-ul-Mustafa, an AI engineer in "
              "Islamabad. Facts you may use: " + " ".join(FACTS.values()) +
              " Answer in at most 40 words, plainly, no marketing language. If the facts "
              "do not cover it, say so.")
    payload = json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": question}],
        "max_tokens": 120,
        "temperature": 0.3,
    }).encode()
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions", data=payload,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        out = json.load(r)
    # Validate the whole structure before touching it. A 200 response with an
    # error body, an empty choices list, or a missing message is still a
    # failure to answer, not an answer.
    if not isinstance(out, dict):
        raise ValueError("model response was not an object")
    choices = out.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("model response carried no choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise ValueError("model response message had an unexpected shape")
    content = message.get("content")
    if not isinstance(content, str):
        raise ValueError("model response content had an unexpected shape")
    return content.strip()


def answer(question):
    """Return (cleaned question, reply, path label).

    The router always runs first so its answer is in hand. When a key is set
    the model is tried, but any failure, empty text, or malformed response
    drops back to the router answer. A router miss is the FALLBACK answer with
    path "none"; both still record normally.
    """
    q = clean(question)
    if not q:
        return "", FALLBACK, "empty"
    fallback, key = route(q)
    api = os.environ.get("GROQ_API_KEY", "").strip()
    if not api:
        print("  no GROQ_API_KEY set, answering via the router (%s)"
              % ("fallback" if key == "none" else key))
        return q, fallback, key
    try:
        text = via_model(q, api)
        if not text:
            raise ValueError("the model returned empty text")
    except Exception as e:
        print("  model unavailable (%s: %s), falling back to the router"
              % (type(e).__name__, e))
        return q, fallback, key
    print("  answered via the Groq model (router would have used %s)"
          % ("fallback" if key == "none" else key))
    return q, text[:MAX_A], key + "+model"


def load():
    """The history, newest first. A missing, corrupt, or non-array file is
    treated as an empty history rather than a reason to crash, so one bad
    write can never block the next question from being recorded."""
    if LOG.exists():
        try:
            data = json.loads(LOG.read_text(encoding="utf-8"))
        except ValueError:
            return []
        if isinstance(data, list):
            return data
    return []


def record(question, reply, who, when):
    items = load()
    items.insert(0, {"q": question, "a": reply, "who": who, "when": when})
    items = items[:KEEP]
    LOG.write_text(json.dumps(items, indent=1), encoding="utf-8", newline="\n")
    return items


if __name__ == "__main__":
    import sys
    title = sys.argv[1] if len(sys.argv) > 1 else ""
    who = sys.argv[2] if len(sys.argv) > 2 else "someone"
    when = sys.argv[3] if len(sys.argv) > 3 else ""
    q, a, path = answer(title)
    if not q:
        # Nothing usable after cleaning: leave asked.json and every existing
        # record untouched, but still reply so the issue does not hang open.
        print("REPLY::" + EMPTY_REPLY)
        raise SystemExit(0)
    record(q, a, who, when)
    print("  recorded under path: %s" % path)
    print("REPLY::" + a)

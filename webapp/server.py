"""FastAPI backend that wraps the outreach agent as a connected web workflow.

Run:  python -m webapp.server        (then open http://localhost:8000)
  or  uvicorn webapp.server:app --port 8000

Design: single-user local tool. One background job runs at a time; the frontend
polls /api/logs for a live stream of progress. Every step maps to the same
`outreach` package the CLI uses, so the UI and CLI stay in lock-step.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime
from pathlib import Path

import yaml
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from outreach.config import Config
from outreach.store import Store
from outreach.linkedin import LinkedIn
from outreach.email_finder import find_email
from outreach.mailer import Mailer
from outreach import templates

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="LinkedIn Outreach Agent")


# ─────────────────────────────────────────────────────────────
#  Job manager — one job at a time, log buffer polled by the UI
# ─────────────────────────────────────────────────────────────
class Job:
    def __init__(self):
        self.lines: list[dict] = []
        self.running = False
        self.kind = ""
        self.lock = threading.Lock()

    def log(self, msg: str, level: str = "info"):
        with self.lock:
            self.lines.append({
                "t": datetime.now().strftime("%H:%M:%S"),
                "msg": msg, "level": level,
            })

    def start(self, kind: str, target, *args):
        if self.running:
            return False
        self.running = True
        self.kind = kind

        def _wrap():
            try:
                target(*args)
            except Exception as e:  # noqa
                self.log(f"error: {e}", "error")
            finally:
                self.running = False
                self.log(f"[{kind}] finished", "done")

        threading.Thread(target=_wrap, daemon=True).start()
        return True


JOB = Job()
# in-memory email verification results keyed by profile_url
EMAIL_INFO: dict[str, dict] = {}


def cfg() -> Config:
    return Config.load(CONFIG_PATH)


def store() -> Store:
    return Store(str(ROOT / "outreach_state.db"))


# ─────────────────────────────────────────────────────────────
#  Static + index
# ─────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC / "index.html").read_text()


# ─────────────────────────────────────────────────────────────
#  State + logs
# ─────────────────────────────────────────────────────────────
@app.get("/api/state")
def state():
    c = cfg()
    # is the automation profile logged in? cheap check: profile dir exists
    prof = Path(c.get("linkedin", "chrome_user_data_dir", default="")).expanduser()
    return {
        "running": JOB.running,
        "kind": JOB.kind,
        "profile_exists": prof.exists(),
        "hunter": bool(_hunter_present(c)),
        "smtp_user": c.get("smtp", "username"),
    }


def _hunter_present(c) -> bool:
    key = (c.get("email", "hunter_api_key") or "").strip()
    if key:
        return True
    kf = c.get("email", "hunter_api_key_file")
    return bool(kf and Path(kf).expanduser().exists())


@app.get("/api/logs")
def logs(since: int = 0):
    with JOB.lock:
        lines = JOB.lines[since:]
        total = len(JOB.lines)
    return {"lines": lines, "next": total, "running": JOB.running, "kind": JOB.kind}


@app.post("/api/logs/clear")
def clear_logs():
    with JOB.lock:
        JOB.lines.clear()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────
#  Config read/write
# ─────────────────────────────────────────────────────────────
@app.get("/api/config")
def get_config():
    c = cfg()
    return {
        "me": c.get("me", default={}),
        "limits": c.get("limits", default={}),
        "target_titles": c.get("linkedin", "target_titles", default=[]),
        "min_confidence_to_send": c.get("email", "min_confidence_to_send", default=0.6),
    }


@app.post("/api/config")
async def set_config(req: Request):
    body = await req.json()
    with open(CONFIG_PATH) as fh:
        data = yaml.safe_load(fh) or {}
    if "me" in body:
        data.setdefault("me", {}).update(body["me"])
    if "limits" in body:
        data.setdefault("limits", {}).update(body["limits"])
    if "target_titles" in body:
        data.setdefault("linkedin", {})["target_titles"] = body["target_titles"]
    if "min_confidence_to_send" in body:
        data.setdefault("email", {})["min_confidence_to_send"] = \
            float(body["min_confidence_to_send"])
    with open(CONFIG_PATH, "w") as fh:
        yaml.safe_dump(data, fh, sort_keys=False, allow_unicode=True)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────
#  Step 2 — LinkedIn login
# ─────────────────────────────────────────────────────────────
def _do_login():
    c = cfg()
    JOB.log("Opening Chrome for LinkedIn login…")
    with LinkedIn(c) as li:
        JOB.log("Log into LinkedIn in the Chrome window that opened (finish any 2FA).")
        ok = li.wait_for_login(timeout_minutes=10)
        JOB.log("Login detected. Session saved." if ok else "Login timed out.",
                "done" if ok else "error")


@app.post("/api/login")
def login():
    if not JOB.start("login", _do_login):
        return JSONResponse({"error": "another job is running"}, 409)
    return {"started": True}


# ─────────────────────────────────────────────────────────────
#  Step 3 — Find people at a company
# ─────────────────────────────────────────────────────────────
def _do_search(company: str, limit: int):
    c = cfg()
    st = store()
    JOB.log(f"Searching LinkedIn for people at “{company}”…")
    with LinkedIn(c) as li:
        if not li.is_logged_in():
            JOB.log("Not logged in. Do Step 2 (Connect LinkedIn) first.", "error")
            return
        cands = li.search(company, limit=limit)
        for cand in cands:
            st.upsert_person(cand.as_dict())
        JOB.log(f"Found {len(cands)} people at {company}.", "done")


@app.post("/api/search")
async def search(req: Request):
    b = await req.json()
    company = (b.get("company") or "").strip()
    limit = int(b.get("limit") or 10)
    if not company:
        return JSONResponse({"error": "company required"}, 400)
    if not JOB.start("search", _do_search, company, limit):
        return JSONResponse({"error": "another job is running"}, 409)
    return {"started": True}


# ─────────────────────────────────────────────────────────────
#  Step 4 — Find & verify emails
# ─────────────────────────────────────────────────────────────
def _do_find_emails(company: str):
    c = cfg()
    st = store()
    q = "SELECT * FROM people"
    args = []
    if company:
        q += " WHERE company=?"
        args.append(company)
    rows = [dict(r) for r in st.db.execute(q, args).fetchall()]
    JOB.log(f"Verifying emails for {len(rows)} people via Hunter.io…")
    for p in rows:
        info = find_email(p, c)
        EMAIL_INFO[p["profile_url"]] = info
        if info["email"]:
            st.set_email(p["profile_url"], info["email"])
            JOB.log(f"  {p['name']}: {info['email']} "
                    f"({info['source']}, {info['confidence']:.0%})")
        else:
            JOB.log(f"  {p['name']}: no email found", "warn")
    JOB.log("Email verification done.", "done")


@app.post("/api/find-emails")
async def find_emails(req: Request):
    b = await req.json()
    company = (b.get("company") or "").strip()
    if not JOB.start("find-emails", _do_find_emails, company):
        return JSONResponse({"error": "another job is running"}, 409)
    return {"started": True}


# ─────────────────────────────────────────────────────────────
#  People list (for the review table)
# ─────────────────────────────────────────────────────────────
@app.get("/api/people")
def people(company: str = ""):
    st = store()
    q = "SELECT * FROM people"
    args = []
    if company:
        q += " WHERE company=?"
        args.append(company)
    q += " ORDER BY name"
    out = []
    for r in st.db.execute(q, args).fetchall():
        p = dict(r)
        info = EMAIL_INFO.get(p["profile_url"], {})
        out.append({
            "profile_url": p["profile_url"],
            "name": p["name"],
            "title": p["title"],
            "company": p["company"],
            "email": info.get("email") or p.get("email"),
            "confidence": info.get("confidence"),
            "source": info.get("source"),
            "connected": bool(p.get("connected_at")),
            "emailed": bool(p.get("emailed_at")),
        })
    return {"people": out}


@app.get("/api/companies")
def companies():
    st = store()
    rows = st.db.execute(
        "SELECT company, COUNT(*) n FROM people GROUP BY company ORDER BY company"
    ).fetchall()
    return {"companies": [{"company": r["company"], "n": r["n"]} for r in rows]}


# ─────────────────────────────────────────────────────────────
#  Step 5 — Send (connect + email) for selected people
# ─────────────────────────────────────────────────────────────
def _do_send(selected: list[str], do_connect: bool, do_email: bool):
    c = cfg()
    st = store()
    me = c.get("me", default={})
    min_conf = c.get("email", "min_confidence_to_send", default=0.6)
    import random
    lo = c.get("limits", "min_delay_seconds", default=40)
    hi = c.get("limits", "max_delay_seconds", default=110)

    rows = [dict(st.get_person(u)) for u in selected if st.get_person(u)]
    JOB.log(f"Starting send for {len(rows)} people "
            f"(connect={do_connect}, email={do_email}).")

    mailer = Mailer(c) if do_email else None
    li = None
    if do_connect:
        li = LinkedIn(c).start()
        if not li.is_logged_in():
            JOB.log("Not logged in — skipping connections, emails only.", "warn")
            li.stop(); li = None; do_connect = False

    try:
        for p in rows:
            JOB.log(f"\n{p['name']} — {p.get('title') or ''}")
            # connect
            if do_connect and li is not None:
                if p.get("connected_at"):
                    JOB.log("  already connected — skip")
                else:
                    note = templates.connection_note(p, me)
                    res = li.connect_with_note(_as_candidate(p), note)
                    JOB.log(f"  connection: {res}",
                            "done" if res == "sent" else "warn")
                    if res == "sent":
                        st.mark_connected(p["profile_url"], note)
                        time.sleep(random.uniform(lo, hi))
            # email
            if do_email:
                if p.get("emailed_at"):
                    JOB.log("  already emailed — skip")
                else:
                    info = EMAIL_INFO.get(p["profile_url"]) or find_email(p, c)
                    email = info.get("email")
                    conf = info.get("confidence") or 0
                    if not email:
                        JOB.log("  no email — skip", "warn")
                    elif conf < min_conf:
                        JOB.log(f"  email {email} conf {conf:.0%} < "
                                f"{min_conf:.0%} — skip", "warn")
                        st.set_email(p["profile_url"], email)
                    else:
                        subj, body = templates.outreach_email({**p, "email": email}, me)
                        mailer.send(email, subj, body, from_name=me.get("name", ""))
                        st.mark_emailed(p["profile_url"])
                        JOB.log(f"  email sent to {email}", "done")
                        time.sleep(random.uniform(lo, hi))
    finally:
        if li is not None:
            li.stop()
    JOB.log("Send complete.", "done")


def _as_candidate(p: dict):
    from outreach.linkedin import Candidate
    return Candidate(name=p["name"], title=p.get("title") or "",
                     profile_url=p["profile_url"], company=p.get("company") or "")


@app.post("/api/send")
async def send(req: Request):
    b = await req.json()
    selected = b.get("selected") or []
    do_connect = bool(b.get("connect", True))
    do_email = bool(b.get("email", True))
    if not selected:
        return JSONResponse({"error": "no one selected"}, 400)
    if not JOB.start("send", _do_send, selected, do_connect, do_email):
        return JSONResponse({"error": "another job is running"}, 409)
    return {"started": True}


def main():
    import uvicorn
    print("Open http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()

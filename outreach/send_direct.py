"""Send outreach emails DIRECTLY from stored candidates — no browser.

Use when LinkedIn connecting is off/limited but you still want to email the
people already discovered in the DB.

  python -m outreach.send_direct                 # all pending, any company
  python -m outreach.send_direct "Acme"          # only this company
  python -m outreach.send_direct "Acme" --dry-run
"""
from __future__ import annotations

import argparse
import random
import time

from rich.console import Console

from .config import Config
from .store import Store
from .email_finder import find_email
from .mailer import Mailer
from . import templates

console = Console()


def run(company=None, cfg_path="config.yaml", dry=False):
    cfg = Config.load(cfg_path)
    store = Store("outreach_state.db")
    me = cfg["me"]
    min_conf = cfg.get("email", "min_confidence_to_send", default=0.6)
    max_run = cfg.get("limits", "max_emails_per_run", default=12)
    max_day = cfg.get("limits", "max_emails_per_day", default=25)
    lo = cfg.get("limits", "min_delay_seconds", default=40)
    hi = cfg.get("limits", "max_delay_seconds", default=110)

    mailer = None if dry else Mailer(cfg)

    q = "SELECT * FROM people WHERE emailed_at IS NULL"
    args = []
    if company:
        q += " AND company = ?"
        args.append(company)
    rows = [dict(r) for r in store.db.execute(q, args).fetchall()]

    console.rule(f"[bold]Direct Email Sender[/] "
                 f"({'DRY RUN' if dry else 'LIVE'}) — {len(rows)} pending")

    sent = 0
    for p in rows:
        if sent >= max_run:
            console.print("[yellow]per-run cap reached[/]"); break
        if store.count_today("email") >= max_day:
            console.print("[yellow]daily cap reached[/]"); break

        console.print(f"\n[bold]{p['name']}[/] — {p.get('title') or ''}")
        info = find_email(p, cfg)
        email = info["email"]
        if not email:
            console.print("  [yellow]no email found — skip[/]"); continue
        store.set_email(p["profile_url"], email)
        console.print(f"  {email}  ([{info['source']}] conf {info['confidence']:.0%})")

        if info["confidence"] < min_conf:
            console.print(f"  [yellow]below {min_conf:.0%} threshold — skip send[/]")
            continue

        subj, body = templates.outreach_email({**p, "email": email}, me)
        if dry:
            console.print(f"  [dim](dry-run) would send: {subj}[/]"); continue
        try:
            mailer.send(email, subj, body, from_name=me["name"])
            store.mark_emailed(p["profile_url"])
            sent += 1
            console.print("  [green]sent[/]")
            d = random.uniform(lo, hi)
            console.log(f"  …waiting {d:.0f}s")
            time.sleep(d)
        except Exception as e:
            console.print(f"  [red]failed: {e}[/]")

    console.rule("[green]Done[/]")
    console.print(f"Emails sent this run: [bold]{sent}[/]")


def main(argv=None):
    p = argparse.ArgumentParser(description="Email stored candidates directly")
    p.add_argument("company", nargs="?", default=None)
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    run(company=a.company, cfg_path=a.config, dry=a.dry_run)


if __name__ == "__main__":
    main()

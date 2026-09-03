"""Orchestrator + CLI.

Flow per company:
  1. Search LinkedIn for SWEs / recent grads at the company.
  2. For each new candidate (respecting daily + per-run caps):
       a. send connection request WITH a personalized note
       b. find/guess their work email
       c. send the interview-prep outreach email
  3. Everything paced with random human-like delays; all state persisted so
     we never double-contact the same person.

Usage:
  python -m outreach.main "Google"
  python -m outreach.main "Google" "Stripe" --limit 15
  python -m outreach.main "Google" --dry-run
  python -m outreach.main "Google" --no-email          (LinkedIn connect only)
  python -m outreach.main "Google" --no-connect        (email only)
"""
from __future__ import annotations

import argparse
import random
import sys
import time

from rich.console import Console

from .config import Config
from .store import Store
from .linkedin import LinkedIn, Candidate
from .email_finder import find_email
from .mailer import Mailer
from . import templates

console = Console()


def _sleep(cfg):
    lo = cfg.get("limits", "min_delay_seconds", default=40)
    hi = cfg.get("limits", "max_delay_seconds", default=110)
    d = random.uniform(lo, hi)
    console.log(f"  …waiting {d:.0f}s (human pace)")
    time.sleep(d)


def run(companies, cfg_path="config.yaml", limit=None,
        do_connect=True, do_email=True, dry_run_override=None):
    cfg = Config.load(cfg_path)
    store = Store(cfg.get("_state_path", default="outreach_state.db"))
    dry = cfg.dry_run() if dry_run_override is None else dry_run_override
    me = cfg["me"]

    max_conn_run = cfg.get("limits", "max_connects_per_run", default=12)
    max_mail_run = cfg.get("limits", "max_emails_per_run", default=12)
    max_conn_day = cfg.get("limits", "max_connects_per_day", default=20)
    max_mail_day = cfg.get("limits", "max_emails_per_day", default=25)
    search_limit = limit or 25

    mailer = None
    if do_email and not dry:
        try:
            mailer = Mailer(cfg)
        except Exception as e:
            console.print(f"[yellow]Email disabled — mailer init failed: {e}[/]")
            do_email = False

    banner = "DRY RUN — nothing will be sent" if dry else "LIVE — will connect/email"
    console.rule(f"[bold]LinkedIn Outreach Agent[/]  ({banner})")

    connects_this_run = 0
    emails_this_run = 0

    with LinkedIn(cfg) as li:
        if not li.ensure_logged_in():
            console.print("[red]Aborting: not logged into LinkedIn.[/]")
            return

        for company in companies:
            console.rule(f"[cyan]{company}[/]")
            candidates = li.search(company, limit=search_limit)
            console.print(f"Found [bold]{len(candidates)}[/] candidates at {company}.")

            for c in candidates:
                # ── caps ──
                if connects_this_run >= max_conn_run and emails_this_run >= max_mail_run:
                    console.print("[yellow]Per-run caps reached. Stopping.[/]")
                    return
                store.upsert_person(c.as_dict())

                console.print(f"\n[bold]{c.name}[/] — {c.title or 'SWE'}")
                console.print(f"  {c.profile_url}")

                # ── 1. connect ──
                if do_connect and connects_this_run < max_conn_run:
                    if store.already_connected(c.profile_url):
                        console.print("  [dim]already connected — skipping[/]")
                    elif store.count_today("connect") >= max_conn_day:
                        console.print("  [yellow]daily connect cap hit — skipping connects[/]")
                    else:
                        note = templates.connection_note(c.as_dict(), me)
                        console.print(f"  note: [italic]{note}[/]")
                        if dry:
                            console.print("  [dim](dry-run) would send connection request[/]")
                        else:
                            res = li.connect_with_note(c, note)
                            console.print(f"  connect -> [bold]{res}[/]")
                            if res == "sent":
                                store.mark_connected(c.profile_url, note)
                                connects_this_run += 1
                                _sleep(cfg)

                # ── 2 + 3. find email + send ──
                if do_email and emails_this_run < max_mail_run:
                    if store.already_emailed(c.profile_url):
                        console.print("  [dim]already emailed — skipping[/]")
                    elif store.count_today("email") >= max_mail_day:
                        console.print("  [yellow]daily email cap hit — skipping emails[/]")
                    else:
                        info = find_email(c.as_dict(), cfg)
                        email = info["email"]
                        min_conf = cfg.get("email", "min_confidence_to_send", default=0.6)
                        if not email:
                            console.print("  [yellow]no email found — skipping email[/]")
                        elif info["confidence"] < min_conf and not dry:
                            console.print(
                                f"  [yellow]email {email} conf {info['confidence']:.0%} "
                                f"< {min_conf:.0%} threshold — skipping send[/]"
                            )
                            store.set_email(c.profile_url, email)
                        else:
                            store.set_email(c.profile_url, email)
                            subj, body = templates.outreach_email(
                                {**c.as_dict(), "email": email}, me
                            )
                            console.print(
                                f"  email: [bold]{email}[/] "
                                f"([{info['source']}], conf {info['confidence']:.0%})"
                            )
                            if dry:
                                console.print(f"  [dim](dry-run) subject: {subj}[/]")
                            else:
                                try:
                                    mailer.send(email, subj, body, from_name=me["name"])
                                    store.mark_emailed(c.profile_url)
                                    emails_this_run += 1
                                    console.print("  email -> [green]sent[/]")
                                    _sleep(cfg)
                                except Exception as e:
                                    console.print(f"  [red]email failed: {e}[/]")

    console.rule("[green]Done[/]")
    console.print(f"Connections sent: [bold]{connects_this_run}[/]   "
                  f"Emails sent: [bold]{emails_this_run}[/]")


def main(argv=None):
    p = argparse.ArgumentParser(description="LinkedIn + email outreach agent")
    p.add_argument("companies", nargs="*", help="Company name(s)")
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--limit", type=int, default=None,
                   help="Max candidates to fetch per company")
    p.add_argument("--dry-run", action="store_true", help="Draft only, send nothing")
    p.add_argument("--no-connect", action="store_true", help="Skip LinkedIn connecting")
    p.add_argument("--no-email", action="store_true", help="Skip email outreach")
    p.add_argument("--login", action="store_true",
                   help="One-time: open Chrome to log into LinkedIn, then exit")
    args = p.parse_args(argv)

    if args.login:
        cfg = Config.load(args.config)
        with LinkedIn(cfg) as li:
            li.wait_for_login()
        return

    if not args.companies:
        p.error("give at least one company name (or use --login)")

    run(
        args.companies,
        cfg_path=args.config,
        limit=args.limit,
        do_connect=not args.no_connect,
        do_email=not args.no_email,
        dry_run_override=True if args.dry_run else None,
    )


if __name__ == "__main__":
    sys.exit(main())

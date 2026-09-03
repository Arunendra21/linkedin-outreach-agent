"""Message templates for connection notes and outreach emails.

Connection notes must stay <= 300 chars (LinkedIn's hard limit).
Keep everything natural and specific — no templated-sounding filler.
"""
from __future__ import annotations


def _first_name(full_name: str) -> str:
    return (full_name or "there").strip().split()[0] if full_name else "there"


def connection_note(person: dict, me: dict) -> str:
    """<=300 char note that rides along with the connection request."""
    first = _first_name(person.get("name"))
    company = person.get("company", "your team")
    me_line = me.get("headline", "a new grad SWE")
    note = (
        f"Hi {first}, I'm {me['name']}, {me_line}. I'm preparing to apply "
        f"at {company} and would love to learn a bit about the team and "
        f"interview process from someone actually there. Thanks for connecting!"
    )
    # Hard trim to 300 chars just in case a long company name blows the budget.
    if len(note) > 300:
        note = note[:297].rstrip() + "..."
    return note


def outreach_email(person: dict, me: dict) -> tuple[str, str]:
    """Return (subject, body) for the interview-prep outreach email."""
    first = _first_name(person.get("name"))
    company = person.get("company", "your company")
    role = person.get("title") or "your role"

    subject = f"Quick question about the {company} interview process"

    sig_lines = [me["name"]]
    if me.get("headline"):
        sig_lines.append(me["headline"])
    if me.get("linkedin"):
        sig_lines.append(me["linkedin"])
    if me.get("portfolio"):
        sig_lines.append(me["portfolio"])
    if me.get("phone"):
        sig_lines.append(me["phone"])
    signature = "\n".join(sig_lines)

    body = f"""Hi {first},

I hope you don't mind the cold email. I'm {me['name']}, {me.get('headline', 'a new grad software engineer')}, and I'm preparing to apply for a software role at {company}. I came across your profile ({role}) and thought you'd have a real sense of what it's actually like there.

If you have a couple of minutes, I'd really appreciate any pointers on:

  - What the team/work environment is genuinely like day to day
  - What the online assessment (OA) tends to look like — topics, format, difficulty
  - How you'd suggest preparing for the interview loop and what they weigh most

Even a couple of quick lines would help me a lot. Totally understand if you're busy — no pressure at all, and thanks either way.

Best,
{signature}
"""
    return subject, body

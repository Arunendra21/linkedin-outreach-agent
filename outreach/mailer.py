"""Send outreach email via Gmail SMTP (app password)."""
from __future__ import annotations

import smtplib
from email.message import EmailMessage


def strip_dashes(text: str) -> str:
    """Remove em/en dashes — the user never wants them in outgoing mail.
    ' — ' becomes ', ', a bare em/en dash becomes a plain hyphen."""
    if not text:
        return text
    for d in ("—", "–"):          # em dash, en dash
        text = text.replace(" " + d + " ", ", ")
        text = text.replace(d, "-")
    return text


class Mailer:
    def __init__(self, cfg):
        self.host = cfg.get("smtp", "host", default="smtp.gmail.com")
        self.port = int(cfg.get("smtp", "port", default=587))
        self.username = cfg.get("smtp", "username")
        self.password = cfg.smtp_password()

    def send(self, to_addr: str, subject: str, body: str, from_name: str = ""):
        msg = EmailMessage()
        msg["From"] = f"{from_name} <{self.username}>" if from_name else self.username
        msg["To"] = to_addr
        msg["Subject"] = strip_dashes(subject)
        msg.set_content(strip_dashes(body))

        with smtplib.SMTP(self.host, self.port, timeout=30) as s:
            s.ehlo()
            s.starttls()
            s.login(self.username, self.password)
            s.send_message(msg)
        return True

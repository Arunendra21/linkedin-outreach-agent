"""Discover a work email for a person given their name + company.

Strategy (best-effort, ranked):
  1. Hunter.io (if api key set) -> most reliable, gives verified email + pattern.
  2. Pattern guessing against the company domain (first.last@, flast@, ...).
  3. MX sanity check on the domain so we don't email into the void.

None of this is guaranteed correct — pattern guesses are marked as such and
the mailer/orchestrator decides whether to send. Cold-email responsibly.
"""
from __future__ import annotations

import re
import unicodedata

import requests

try:
    import dns.resolver  # dnspython
except Exception:  # pragma: no cover
    dns = None


COMMON_TLDS = ["com", "io", "ai", "co", "net", "in"]


def _ascii(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z]", "", s).lower()


def split_name(full_name: str) -> tuple[str, str]:
    parts = [p for p in re.split(r"\s+", (full_name or "").strip()) if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return _ascii(parts[0]), ""
    return _ascii(parts[0]), _ascii(parts[-1])


def has_mx(domain: str) -> bool:
    if dns is None:
        return True  # can't check -> don't block
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=6)
        return len(answers) > 0
    except Exception:
        return False


def guess_domain(company: str) -> str | None:
    """Very rough company -> domain guess. Prefer Hunter/manual override."""
    slug = _ascii(company)
    if not slug:
        return None
    for tld in COMMON_TLDS:
        d = f"{slug}.{tld}"
        if has_mx(d):
            return d
    return None


def pattern_candidates(first: str, last: str, domain: str) -> list[str]:
    if not first or not domain:
        return []
    f, l = first, last
    fi = first[0] if first else ""
    li = last[0] if last else ""
    raw = [
        f"{f}.{l}", f"{f}{l}", f"{fi}{l}", f"{f}{li}",
        f"{f}_{l}", f"{f}", f"{fi}.{l}", f"{l}.{f}", f"{l}{fi}",
    ]
    seen, out = set(), []
    for local in raw:
        local = local.strip(".").strip("_")
        if local and local not in seen:
            seen.add(local)
            out.append(f"{local}@{domain}")
    return out


# ── Hunter.io ────────────────────────────────────────────────
def hunter_domain(company: str, api_key: str) -> str | None:
    try:
        r = requests.get(
            "https://api.hunter.io/v2/domain-search",
            params={"company": company, "api_key": api_key, "limit": 1},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("data", {}).get("domain")
    except Exception:
        return None


def hunter_find(first: str, last: str, domain: str, api_key: str):
    try:
        r = requests.get(
            "https://api.hunter.io/v2/email-finder",
            params={
                "domain": domain,
                "first_name": first,
                "last_name": last,
                "api_key": api_key,
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        return data.get("email"), data.get("score")
    except Exception:
        return None, None


def _resolve_hunter_key(cfg) -> str:
    key = (cfg.get("email", "hunter_api_key") or "").strip()
    if key:
        return key
    key_file = cfg.get("email", "hunter_api_key_file")
    if key_file:
        from pathlib import Path
        p = Path(key_file).expanduser()
        if p.exists():
            return p.read_text().strip()
    return ""


def find_email(person: dict, cfg) -> dict:
    """Return {email, source, confidence, candidates}. email may be None."""
    name = person.get("name", "")
    company = person.get("company", "")
    first, last = split_name(name)

    api_key = _resolve_hunter_key(cfg)
    domain = person.get("domain")  # allow manual override upstream

    # 1) Hunter.io
    if api_key:
        if not domain:
            domain = hunter_domain(company, api_key)
        if domain:
            email, score = hunter_find(first, last, domain, api_key)
            if email:
                return {
                    "email": email,
                    "source": "hunter",
                    "confidence": (score or 0) / 100.0,
                    "candidates": [email],
                    "domain": domain,
                }

    # 2) Pattern guessing
    if not domain:
        domain = guess_domain(company)
    candidates = pattern_candidates(first, last, domain) if domain else []
    best = candidates[0] if candidates else None
    return {
        "email": best,
        "source": "pattern-guess" if best else "none",
        "confidence": 0.35 if best else 0.0,
        "candidates": candidates,
        "domain": domain,
    }

"""LinkedIn automation via Selenium using your REAL logged-in Chrome profile.

Design notes / reality check:
  * LinkedIn's ToS discourages automated connecting. This drives your own
    session at human pace with hard caps — it is *assistive*, not a scraper
    farm. Keep volumes low.
  * LinkedIn's DOM is obfuscated and changes often. Selectors here use several
    fallbacks; if LinkedIn ships a redesign you may need to tweak XPaths.
  * Run with headless=False. Headless is trivially detected and will get you
    challenged/blocked.
"""
from __future__ import annotations

import time
import urllib.parse
from dataclasses import dataclass, field

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    ElementClickInterceptedException,
)


@dataclass
class Candidate:
    name: str
    title: str
    profile_url: str
    company: str
    domain: str | None = field(default=None)

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "title": self.title,
            "profile_url": self.profile_url,
            "company": self.company,
            "domain": self.domain,
        }


class LinkedIn:
    def __init__(self, cfg):
        self.cfg = cfg
        self.driver = None

    # ── lifecycle ────────────────────────────────────────────
    def start(self):
        opts = Options()
        user_data = self.cfg.get("linkedin", "chrome_user_data_dir")
        profile = self.cfg.get("linkedin", "profile_directory", default="Default")
        if user_data:
            opts.add_argument(f"--user-data-dir={user_data}")
            opts.add_argument(f"--profile-directory={profile}")
        if self.cfg.get("linkedin", "headless", default=False):
            opts.add_argument("--headless=new")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        opts.add_argument("--start-maximized")
        opts.add_argument("--no-first-run")
        self.driver = webdriver.Chrome(options=opts)
        self.driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"},
        )
        return self

    def stop(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass

    def __enter__(self):
        return self.start()

    def __exit__(self, *a):
        self.stop()

    # ── login check ──────────────────────────────────────────
    def is_logged_in(self) -> bool:
        self.driver.get("https://www.linkedin.com/feed/")
        time.sleep(4)
        url = self.driver.current_url
        return not ("login" in url or "checkpoint" in url or "authwall" in url
                    or "signup" in url)

    def ensure_logged_in(self) -> bool:
        if self.is_logged_in():
            return True
        print("!! Not logged into LinkedIn in the automation profile.\n"
              "   Run once:  python -m outreach.main --login")
        return False

    def wait_for_login(self, timeout_minutes: int = 10) -> bool:
        """Open LinkedIn and block until the user finishes logging in."""
        self.driver.get("https://www.linkedin.com/login")
        print("\n>>> A Chrome window is open. Log into LinkedIn there "
              "(complete any 2FA). I'll detect it automatically.\n")
        deadline = time.time() + timeout_minutes * 60
        while time.time() < deadline:
            url = self.driver.current_url
            if "/feed" in url or ("/in/" in url and "login" not in url):
                print(">>> Login detected. Session saved to the automation profile.")
                return True
            time.sleep(3)
        print("!! Timed out waiting for login.")
        return False

    # ── search ───────────────────────────────────────────────
    def search(self, company: str, limit: int = 25) -> list[Candidate]:
        titles = self.cfg.get("linkedin", "target_titles", default=["Software Engineer"])
        keyword = f'{company} ({" OR ".join(titles)})'
        q = urllib.parse.quote(keyword)
        url = (f"https://www.linkedin.com/search/results/people/"
               f"?keywords={q}&origin=SWITCH_SEARCH_VERTICAL")
        self.driver.get(url)
        self._wait_results()

        found: dict[str, Candidate] = {}
        pages = 0
        while len(found) < limit and pages < 5:
            self._scroll_page()
            for c in self._parse_result_cards(company):
                if c.profile_url not in found:
                    found[c.profile_url] = c
                if len(found) >= limit:
                    break
            if len(found) >= limit or not self._go_next_page():
                break
            pages += 1
            self._wait_results()
        return list(found.values())[:limit]

    def _wait_results(self):
        try:
            WebDriverWait(self.driver, 12).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "a[href*='/in/']")
                )
            )
        except TimeoutException:
            pass
        time.sleep(2)

    def _scroll_page(self):
        for frac in (0.3, 0.6, 0.9, 1.0):
            self.driver.execute_script(
                f"window.scrollTo(0, document.body.scrollHeight*{frac});"
            )
            time.sleep(1.2)

    # LinkedIn's search DOM (2024+) no longer uses stable container classes.
    # Each result's whole text lives inside one /in/ profile anchor, e.g.:
    #   "Jane Doe\n • 2nd\nSoftware Engineer @ Acme\nIndia\n..."
    # while image/mutual-connection links repeat the href or carry only a name.
    # So: group anchors by profile href, keep the richest text per person, and
    # keep only those that look like real result rows (have a degree + title).
    _DEGREE_HINTS = ("• 1st", "• 2nd", "• 3rd", "1st", "2nd", "3rd",
                     "degree connection")

    def _parse_result_cards(self, company: str) -> list[Candidate]:
        anchors = self.driver.find_elements(By.CSS_SELECTOR, "a[href*='/in/']")
        richest: dict[str, str] = {}
        for a in anchors:
            try:
                href = (a.get_attribute("href") or "").split("?")[0]
                if "/in/" not in href:
                    continue
                txt = (a.text or "").strip()
                if len(txt) > len(richest.get(href, "")):
                    richest[href] = txt
            except Exception:
                continue

        out = []
        for href, txt in richest.items():
            name, title = self._parse_card_text(txt)
            if not name:
                continue
            out.append(Candidate(name=name, title=title,
                                 profile_url=href, company=company))
        return out

    def _parse_card_text(self, txt: str) -> tuple[str, str]:
        lines = [l.strip() for l in txt.split("\n") if l.strip()]
        if not lines:
            return "", ""
        name = lines[0]
        if name.lower() in ("linkedin member", "connect", "follow", "message"):
            return "", ""
        # Reject single-name links (mutual-connection / image links) — real
        # result rows carry a degree marker and a headline.
        has_degree = any(h in txt for h in self._DEGREE_HINTS)
        title = ""
        for i, l in enumerate(lines):
            if any(l == d or l.endswith(d) for d in ("• 1st", "• 2nd", "• 3rd")):
                if i + 1 < len(lines):
                    title = lines[i + 1]
                break
        if not title:
            for l in lines[1:]:
                if "@" in l or any(k in l for k in
                                   ("Engineer", "Developer", "SDE", "Intern",
                                    "Scientist", "Analyst", "Manager")):
                    title = l
                    break
        if not (has_degree or title):
            return "", ""      # not a genuine result row
        return name, title

    def _go_next_page(self) -> bool:
        try:
            btn = self.driver.find_element(
                By.CSS_SELECTOR, "button[aria-label='Next']"
            )
            if btn.is_enabled():
                self.driver.execute_script("arguments[0].click();", btn)
                time.sleep(2)
                return True
        except NoSuchElementException:
            pass
        return False

    # ── connect ──────────────────────────────────────────────
    def connect_with_note(self, candidate: Candidate, note: str) -> str:
        """Return 'sent' | 'already' | 'no_button' | 'error'."""
        try:
            self.driver.get(candidate.profile_url)
            time.sleep(4)
            btn = self._find_connect_button()
            if btn is None:
                return "no_button"
            self._click(btn)
            time.sleep(2)

            # "Add a note" -> textarea -> Send
            add_note = self._find_first([
                (By.XPATH, "//button[.//span[text()='Add a note']]"),
                (By.XPATH, "//button[@aria-label='Add a note']"),
            ], timeout=6)
            if add_note is not None:
                self._click(add_note)
                time.sleep(1.5)
                ta = self._find_first([
                    (By.CSS_SELECTOR, "textarea[name='message']"),
                    (By.ID, "custom-message"),
                    (By.CSS_SELECTOR, "textarea"),
                ], timeout=6)
                if ta is not None:
                    ta.send_keys(note[:300])
                    time.sleep(1)

            send = self._find_first([
                (By.XPATH, "//button[@aria-label='Send now']"),
                (By.XPATH, "//button[@aria-label='Send invitation']"),
                (By.XPATH, "//button[.//span[text()='Send']]"),
                (By.XPATH, "//button[.//span[text()='Send now']]"),
            ], timeout=6)
            if send is None:
                return "error"
            self._click(send)
            time.sleep(2)
            return "sent"
        except Exception as e:  # noqa
            print(f"  connect error: {e}")
            return "error"

    def _find_connect_button(self):
        # Direct Connect button in the top card
        direct = self._find_first([
            (By.XPATH, "//main//button[.//span[text()='Connect']]"),
            (By.XPATH, "//button[@aria-label][.//span[text()='Connect']]"),
        ], timeout=5)
        if direct is not None:
            return direct
        # Behind the "More" dropdown
        more = self._find_first([
            (By.XPATH, "//main//button[.//span[text()='More']]"),
            (By.XPATH, "//button[@aria-label='More actions']"),
        ], timeout=4)
        if more is not None:
            self._click(more)
            time.sleep(1.2)
            return self._find_first([
                (By.XPATH, "//div[@aria-label='Connect' or @role='button'][.//span[text()='Connect']]"),
                (By.XPATH, "//div[contains(@class,'artdeco-dropdown')]//span[text()='Connect']/ancestor::div[@role='button']"),
            ], timeout=4)
        return None

    # ── small helpers ────────────────────────────────────────
    def _find_first(self, locators, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            for by, sel in locators:
                els = self.driver.find_elements(by, sel)
                for el in els:
                    if el.is_displayed():
                        return el
            time.sleep(0.4)
        return None

    def _click(self, el):
        try:
            el.click()
        except (ElementClickInterceptedException, Exception):
            self.driver.execute_script("arguments[0].click();", el)

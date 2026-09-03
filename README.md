# 🔗 LinkedIn Outreach Agent

**Give it a company name. It finds software engineers and recent grads at that
company, sends each a personalized LinkedIn connection request, finds their work
email, and emails them asking the questions that actually help you prepare for
interviews** — what the team is like, what the online assessment (OA) covers, and
how to prepare for the interview loop.

It runs on **your own computer**, using **your own** LinkedIn login and **your own**
email, so nothing is hidden from you and no one else can use your accounts.

```
company name  →  find engineers + new grads  →  connect with a note  →  find & verify email  →  send interview-prep email
```

There are two ways to use it:

- 🖥️ **A web dashboard** (a website that opens in your browser) — easiest, recommended.
- ⌨️ **A command line** (typing commands) — for people comfortable with a terminal.

---

## 📑 Table of contents

1. [What you need before starting](#1-what-you-need-before-starting)
2. [Install the agent (one time)](#2-install-the-agent-one-time)
3. [Get your keys and passwords (one time)](#3-get-your-keys-and-passwords-one-time)
4. [Fill in your settings](#4-fill-in-your-settings)
5. [Use it — the web dashboard](#5-use-it--the-web-dashboard-recommended)
6. [Use it — the command line](#6-use-it--the-command-line)
7. [Safety limits (please read)](#7-safety-limits-please-read)
8. [Troubleshooting](#8-troubleshooting)
9. [How it works inside](#9-how-it-works-inside)
10. [Deploy the landing page as a website](#10-deploy-the-landing-page-as-a-website)
11. [Frequently asked questions](#11-frequently-asked-questions)

---

## 1. What you need before starting

You need four things. Don't worry — Section 3 shows exactly how to get the ones
you don't have.

| # | Thing | Why | Cost |
|---|-------|-----|------|
| 1 | A computer with **Google Chrome** installed | The agent controls Chrome to use LinkedIn | Free |
| 2 | **Python 3.10 or newer** | The agent is written in Python | Free |
| 3 | A **LinkedIn account** | To send connection requests | Free |
| 4 | A **Gmail (or Google Workspace) account** with an **App Password** | To send the emails | Free |
| 5 | *(Optional but recommended)* a **Hunter.io** account | To verify emails so they don't bounce | Free tier |

### Check if you already have Python

Open a terminal (on Windows: search "PowerShell"; on Mac: search "Terminal";
on Linux: "Terminal") and type:

```bash
python3 --version
```

If you see something like `Python 3.12.3`, you're good. If it says "command not
found" or a version below 3.10, install Python from
<https://www.python.org/downloads/> (tick **"Add Python to PATH"** on Windows).

---

## 2. Install the agent (one time)

Copy-paste these commands into your terminal, one block at a time.

**Step 2.1 — Download the code:**

```bash
git clone https://github.com/Arunendra21/linkedin-outreach-agent.git
cd linkedin-outreach-agent
```

> If you don't have `git`, download the project as a ZIP from the GitHub page
> (green **Code** button → **Download ZIP**), unzip it, and `cd` into the folder.

**Step 2.2 — Create a private workspace for the agent and install its parts:**

```bash
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

You'll know the workspace is active when your terminal line starts with `(.venv)`.
You need to run that `source ...` line **every time** you open a new terminal to
use the agent.

**Step 2.3 — Create your personal settings file:**

```bash
cp config.example.yaml config.yaml
```

This makes a file called `config.yaml` that only lives on your computer. You'll
fill it in during Section 4. (It's never uploaded anywhere — it's kept private.)

---

## 3. Get your keys and passwords (one time)

The agent needs permission to send email as you, and (optionally) a Hunter.io key
to verify addresses. Here's exactly how to get each one.

### 3.1 — Gmail App Password (required, to send emails)

A "App Password" is a special 16-character password that lets an app send email
without using your real password. It's safe and you can delete it anytime.

1. Turn on **2-Step Verification** for your Google account (required before app
   passwords appear): <https://myaccount.google.com/signinoptions/two-step-verification>
2. Go to **App Passwords**: <https://myaccount.google.com/apppasswords>
3. Type a name like `outreach` and click **Create**.
4. Google shows a **16-character code** (like `abcd efgh ijkl mnop`). Copy it.
5. Save it into a file the agent can read (replace the x's with your real code,
   **no spaces**):

   ```bash
   printf '%s' 'xxxxxxxxxxxxxxxx' > ~/.mail_app_pw && chmod 600 ~/.mail_app_pw
   ```

> **On a school/college Google account?** App Passwords may be turned off by your
> admin. If the App Passwords page says it's unavailable, use a personal Gmail
> instead, or ask your admin to enable it.

### 3.2 — Hunter.io API key (optional but strongly recommended)

Without this, the agent *guesses* email addresses from name + company patterns and
many will bounce. With it, addresses are looked up and verified.

1. Sign up (free): <https://hunter.io/users/sign_up> (free tier = 25–50 lookups/month)
2. Copy your key from <https://hunter.io/api-keys>
3. Save it:

   ```bash
   printf '%s' 'your-hunter-api-key-here' > ~/.hunter_api_key && chmod 600 ~/.hunter_api_key
   ```

---

## 4. Fill in your settings

Open `config.yaml` in any text editor (Notepad, TextEdit, VS Code…). Change the
values shown below. Everything else can stay as-is.

```yaml
me:
  name: "Your Full Name"                       # e.g. "Priya Sharma"
  headline: "final-year CS student / new grad SWE"   # one line about you
  linkedin: "https://www.linkedin.com/in/your-handle"

email:
  hunter_api_key_file: "/home/YOU/.hunter_api_key"   # path to the file from 3.2
  min_confidence_to_send: 0.60                 # only send emails Hunter is >=60% sure about

smtp:
  username: "you@gmail.com"                    # the Gmail address you make it send FROM
  password_file: "/home/YOU/.mail_app_pw"      # path to the file from 3.1
```

> Replace `/home/YOU/` with your real home folder. On Mac/Linux you can usually
> write `~/.mail_app_pw`. On Windows use the full path like
> `C:/Users/You/.mail_app_pw`.

You can also change these settings later right inside the web dashboard (Step 1),
so don't stress about getting everything perfect now.

**Tip:** if you're not using Hunter.io, the agent still works — it will just guess
emails and skip the ones it isn't confident about.

---

## 5. Use it — the web dashboard (recommended)

This is the easy way. Everything happens in your browser with buttons.

**Start it:**

```bash
./run_web.sh
```

(On Windows, or if that doesn't run: `python -m webapp.server`.)

Then open **<http://localhost:8000>** in your browser. You'll see five steps.
**Do them top to bottom** — each one unlocks the next, and a live console at the
bottom of the page shows exactly what's happening.

| Step | What you do | What happens |
|------|-------------|--------------|
| **1. Your profile** | Fill in your name, headline, LinkedIn, and limits. Click **Save**. | Saves your settings. |
| **2. Connect LinkedIn** | Click **Open Chrome & log in**. A Chrome window opens — log into LinkedIn there (do this **once**). | The agent remembers your LinkedIn session for future runs. |
| **3. Find people** | Type a **company name** (e.g. `Stripe`) and how many people, click **Find people**. | It searches LinkedIn and lists engineers + recent grads. |
| **4. Verify emails** | Click **Verify emails**. | It finds each person's real work email and gives a confidence score. |
| **5. Review & send** | Tick the people you want, choose **connections** and/or **emails**, click **Send to selected**. | It sends connection notes + interview-prep emails, slowly and safely. |

That's it. You can come back and run more companies anytime — it never contacts
the same person twice.

---

## 6. Use it — the command line

Prefer typing commands? Same power, no browser.

```bash
source .venv/bin/activate     # activate the workspace first (Windows: .venv\Scripts\activate)

# ONE-TIME: log into LinkedIn (opens a Chrome window)
python -m outreach.main --login

# See what it WOULD do for a company, WITHOUT sending anything:
python -m outreach.main "Stripe" --dry-run --limit 8

# Do it for real (connections + emails):
python -m outreach.main "Stripe" --limit 8

# Several companies at once:
python -m outreach.main "Google" "Stripe" "Zomato" --limit 10

# Only connect on LinkedIn (no emails):
python -m outreach.main "Stripe" --no-email

# Only email (no LinkedIn connecting) — great if you hit LinkedIn's weekly limit:
python -m outreach.send_direct "Stripe"
```

**Always try `--dry-run` first** — it prints every note and email it would send so
you can check them, and sends nothing.

---

## 7. Safety limits (please read)

Sending too much, too fast, gets LinkedIn accounts restricted and emails marked as
spam. This agent is built to keep you safe, but the limits only help if you respect
them.

- **Keep volumes low.** The defaults (below) are already conservative. Don't crank
  them up.
- **LinkedIn has a weekly invitation limit.** If connections stop working, you've
  hit it — wait for it to reset, or use email-only (`send_direct`) in the meantime.
- **Emails below your confidence threshold are skipped**, so you don't bounce.
- Everyone you contact is remembered in a local file (`outreach_state.db`), so
  re-running never double-contacts anyone.

You can change these in `config.yaml` under `limits:` (or in the dashboard, Step 1):

| Setting | Default | Meaning |
|---|---|---|
| `max_connects_per_run` | 12 | connection requests per run |
| `max_emails_per_run` | 12 | emails per run |
| `max_connects_per_day` | 20 | hard daily ceiling for connections |
| `max_emails_per_day` | 25 | hard daily ceiling for emails |
| `min_delay_seconds` / `max_delay_seconds` | 40 / 110 | random pause between actions |
| `dry_run` | false | `true` = prepare everything, send nothing |

> ⚖️ **A note on ethics and terms of service.** Automated connecting is against
> LinkedIn's Terms of Service, and cold emailing is a manners game. This tool is
> *assistive*: small batches, honest messages, your own accounts, your own
> responsibility. Use it for genuine networking and interview prep, keep the volume
> human, and it behaves the way real outreach does.

---

## 8. Troubleshooting

**"Chrome couldn't start" / `DevToolsActivePort` / `SessionNotCreated`**
Close **all** Chrome windows and try again. The agent uses its own separate Chrome
profile (folder `chrome-linkedin-agent`), so this is usually a leftover lock — the
agent clears it, but a running Chrome using that folder will block it.

**"Not logged into LinkedIn"**
Do Step 2 (dashboard) or `python -m outreach.main --login` (command line) and finish
the login in the Chrome window that opens.

**Connections show `error` or don't send**
You've almost certainly hit LinkedIn's **weekly invitation limit**. Wait for it to
reset, or send emails only with `python -m outreach.send_direct "Company"`.

**Emails aren't sending / login failed**
Double-check your App Password file (Section 3.1). School/college Google accounts
often disable App Passwords — use a personal Gmail instead. Test it quickly:

```bash
source .venv/bin/activate
python -c "import smtplib; s=smtplib.SMTP('smtp.gmail.com',587); s.starttls(); \
s.login('you@gmail.com', open('/home/YOU/.mail_app_pw').read().strip()); print('login OK'); s.quit()"
```

**Emails all say "below threshold" and get skipped**
That means Hunter isn't confident about them. Add a Hunter.io key (Section 3.2), or
lower `min_confidence_to_send` in `config.yaml` (not recommended below 0.5).

**No people found for a company**
Try the company's exact LinkedIn name, or a broader spelling. LinkedIn occasionally
changes its page layout; if searches consistently return nobody, the selectors in
`outreach/linkedin.py` may need a small update.

---

## 9. How it works inside

The project is small and readable. Here's what each file does:

| File | Role |
|---|---|
| `outreach/linkedin.py` | Controls your Chrome to search LinkedIn and send connections |
| `outreach/email_finder.py` | Finds & verifies work emails (Hunter.io, then patterns) |
| `outreach/mailer.py` | Sends the emails via Gmail (also strips em dashes) |
| `outreach/templates.py` | The wording of the connection note and the email |
| `outreach/store.py` | Local database that remembers who you've contacted |
| `outreach/main.py` | The command-line program that ties it together |
| `outreach/send_direct.py` | Email-only sender (no browser needed) |
| `webapp/server.py` | The web dashboard's engine (a small web server) |
| `webapp/static/` | The dashboard page you see (HTML, CSS, JavaScript) |
| `config.yaml` | **Your** private settings (never shared) |
| `outreach_state.db` | **Your** private record of contacts (never shared) |

**Want to change the wording of the messages?** Edit `outreach/templates.py`.

---

## 10. Deploy the landing page as a website

This repo includes a polished landing page at `docs/index.html`. You can put it
online for free with **GitHub Pages**:

1. Push this project to GitHub (already done if you cloned it from there).
2. On the GitHub repo page: **Settings → Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**, branch
   **`main`**, folder **`/docs`**, then **Save**.
4. Wait a minute, then your site is live at
   `https://<your-username>.github.io/linkedin-outreach-agent/`.

> The **landing page** is a public description of the tool. The **working agent**
> always runs on your own computer (it uses your private Chrome session and inbox),
> so it is not something you host on a public server.

**Run the dashboard in Docker** (optional, advanced):

```bash
docker build -t outreach-agent .
docker run -p 8000:8000 \
  -v "$PWD/config.yaml:/app/config.yaml" \
  -v "$PWD/outreach_state.db:/app/outreach_state.db" \
  outreach-agent
```

---

## 11. Frequently asked questions

**Is this against the rules?**
Automated LinkedIn connecting is against LinkedIn's Terms of Service. You use this
at your own responsibility. Keep volumes low and messages genuine. It's meant for
real, personal networking — not spam.

**Will people know a bot sent this?**
The messages are short, personalized, and written to sound like you. But *you*
should still read them and edit the templates (`outreach/templates.py`) to match
your voice.

**Does it store my password anywhere unsafe?**
No. Your app password and API key live in files in your home folder that only you
can read. They're never written into the code or uploaded. `config.yaml` and your
contacts database are excluded from Git.

**Can someone who downloads this repo use my accounts or contacts?**
No. The repo contains only the program. Your settings, passwords, and contact list
stay on your machine and are never included.

**It hit LinkedIn's weekly limit. Now what?**
Use email-only mode: `python -m outreach.send_direct "Company"`. Connections resume
once your weekly limit resets.

**Can I use an email that isn't Gmail?**
It's set up for Gmail / Google Workspace. Other providers work if you change the
`smtp.host` and `smtp.port` in `config.yaml` to your provider's SMTP settings.

---

*Built for job-seekers doing genuine interview-prep networking. Be kind, be honest,
keep it small.*

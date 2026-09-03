# Outreach Agent — Chrome Extension

The easiest way to use the agent: it runs **inside your own Chrome**, which is
already logged into LinkedIn. No Python, no terminal, no separate browser.

```
type a company  →  Find people  →  Verify emails  →  Connect (auto notes)  →  Email (Gmail compose)
```

## Install it (2 minutes)

Until it's on the Chrome Web Store, install it in developer mode — this is normal
and safe for your own extension:

1. Download this project (green **Code → Download ZIP** on GitHub, then unzip) —
   or `git clone` it.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and choose the **`extension`** folder inside this
   project.
5. The **◎ Outreach Agent** icon appears in your toolbar. Click it, then the ⚙
   to open **Settings**.

## First-time setup

In **Settings** (the ⚙ in the popup):

- **Your name / headline / LinkedIn URL** — used in the notes and emails.
- **Hunter.io API key** — get a free one at
  <https://hunter.io/api-keys>. Without it, emails are guessed and many bounce.
- **Confidence threshold, target titles, limits** — sensible defaults are filled in.

Click **Save**. Also make sure you're **logged into LinkedIn** in this Chrome.

## Use it

1. Open LinkedIn in a tab (any page).
2. Click the **◎** toolbar icon.
3. Type a **company name** and a count, hit **Find**. It opens the LinkedIn
   people search and lists engineers + recent grads.
4. **Verify emails** — looks up and scores each work email via Hunter.io.
5. Tick the people you want, then:
   - **Connect** — sends connection requests with a personalized note, one at a
     time with human-like delays (respects your per-run cap).
   - **Email** — opens a **Gmail compose** tab for each verified address,
     pre-filled with the subject and interview-prep message. You just review and
     hit **Send**. (Only addresses at/above your confidence threshold are opened.)

The live activity panel at the bottom shows every step. People you've already
connected to are remembered, so re-running never double-contacts anyone.

## Notes & limits

- **LinkedIn's weekly invitation limit** still applies — if connects stop working,
  you've hit it; wait for the reset or just use the email step.
- **Free connection notes** may be limited by LinkedIn in some regions/plans. If
  the "Add a note" option isn't offered, the request is still sent (without a note).
- This automates actions on your own account. Keep volumes low and messages
  genuine — see the disclaimer in the project root `LICENSE`.

## How the pieces fit

| File | Role |
|---|---|
| `manifest.json` | Extension definition (MV3) |
| `popup.html/.css/.js` | The toolbar UI you interact with |
| `options.html/.js` | Settings (stored in your browser only) |
| `content.js` | Runs on LinkedIn pages: scrapes people, clicks Connect + note |
| `background.js` | Search navigation, Hunter.io lookups, Gmail compose handoff |

Nothing is uploaded anywhere. Your settings live in `chrome.storage`, your
Hunter key stays in your browser, and emails are sent from your own Gmail.

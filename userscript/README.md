# Outreach Agent — Tampermonkey userscript (free, one-click)

The **completely free** way to install: no Chrome Web Store fee, no developer
mode, no "Load unpacked". It's a single userscript that adds a floating panel to
LinkedIn.

```
type a company  →  Find people  →  Verify emails  →  Connect (auto notes)  →  Email (Gmail compose)
```

## Install (about 1 minute)

1. **Install Tampermonkey** (a free, popular browser add-on) from your browser's
   store:
   - Chrome / Edge: <https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo>
   - Firefox: <https://addons.mozilla.org/firefox/addon/tampermonkey/>
2. **Click this link to install the script** — Tampermonkey will open an install
   page; click **Install**:

   👉 <https://raw.githubusercontent.com/Arunendra21/linkedin-outreach-agent/main/userscript/outreach-agent.user.js>

   *(If it opens as plain text instead, copy everything, open the Tampermonkey
   dashboard → **+ (Create a new script)** → paste over the template → **File →
   Save**.)*
3. Go to **LinkedIn**. A coral **◎** button appears at the bottom-right.

## First-time setup

1. Click the **◎** button, then the **⚙** gear.
2. Fill in your **name**, **headline**, **LinkedIn URL**, and paste a free
   **Hunter.io API key** (<https://hunter.io/api-keys>). Without a key, emails are
   guessed and many bounce.
3. Adjust the confidence threshold / target titles / limits if you like. **Save**.

## Use it

1. On LinkedIn, open the **◎** panel.
2. Type a **company name** + a count, click **Find**. The page navigates to the
   LinkedIn people search and the panel lists engineers + recent grads.
3. **Verify emails** — looks up and scores each work email (Hunter.io).
4. Tick the people you want, then:
   - **Connect** — sends connection requests with a personalized note, paced with
     human-like delays and your per-run cap.
   - **Email** — opens a **Gmail compose** tab for each verified address (at/above
     your confidence threshold), pre-filled. You just review and hit **Send**.

People you've connected to are remembered, so re-running never double-contacts
anyone. The activity log at the bottom of the panel shows every step.

## Notes

- Works in your own logged-in LinkedIn — keep volumes low; LinkedIn's **weekly
  invitation limit** still applies.
- Free **connection notes** may be limited by LinkedIn in some regions; if the
  "Add a note" option isn't shown, the request still sends without a note.
- Everything stays in your browser (Tampermonkey storage). Your Hunter key never
  leaves your machine; emails send from your own Gmail. See the project `LICENSE`
  for the responsible-use disclaimer.

## Extension vs. userscript — which do I pick?

| | Userscript (this) | Chrome extension ([`../extension`](../extension)) |
|---|---|---|
| Install | Tampermonkey + one click | Load unpacked (developer mode) |
| Cost | Free | Free |
| UI | Floating panel on LinkedIn | Toolbar popup |
| Under the hood | Same logic, one file | Same logic, MV3 |

Pick whichever you prefer — they do the same thing.

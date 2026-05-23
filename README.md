# wedding-site

卓育辰 ＆ 楊皖淩 · 2027-06-05 · LINE-central wedding site.

Static site on **Cloudflare Pages** at `wedding.zacharyzhuo.com`; LIFF apps
inside the **皖美育見你** LINE OA delegate to it; dynamic logic lives in
**Pages Functions**; RSVP responses append to the couple's existing Google
Sheet via an **Apps Script** web app.

Architecture lives in `~/.claude/skills/wedding-planning/`.

---

## Bring-up — step by step

### 1. Install deps

```bash
cd ~/wedding-site
npm install
```

### 2. Local env

```bash
cp .env.example .env.local
# Fill NEXT_PUBLIC_LIFF_ID_RSVP (from LINE Developers > LIFF tab).
# RSVP_WEBHOOK_URL is filled after step 4 below.
```

### 3. Local dev

```bash
npm run dev
# http://localhost:3000  — landing
# http://localhost:3000/liff/rsvp  — LIFF (will redirect to LINE login)
# http://localhost:3000/rsvp-fallback  — non-LINE web RSVP
```

### 4. Deploy the Apps Script webhook (RSVP backend)

1. Open the wedding-planning Google Sheet → **Extensions → Apps Script**.
2. Paste `apps-script/rsvp-webhook.gs` into the editor (replace `Code.gs`).
3. Confirm `SHEET_ID` matches the Sheet, add Angelet's email to `NOTIFY_EMAILS`.
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone with the link**
5. Authorize when prompted (`MailApp`, `SpreadsheetApp` scopes).
6. Copy the deployment URL (ends in `/exec`). This goes into Cloudflare as
   `RSVP_WEBHOOK_URL` in the next step.

Treat the `/exec` URL as a secret — anyone with it can append rows. Rotate
by creating a new deployment and updating Cloudflare env.

### 5. Push to GitHub and connect Cloudflare Pages

```bash
# Create the repo on GitHub first (private), then:
git add -A && git commit -m "feat: initial wedding-site scaffold"
git remote add origin git@github.com:<you>/wedding-site.git
git push -u origin main
```

In Cloudflare dashboard → Workers & Pages → Create → **Pages → Connect to Git**:

- Build command: `npm run build`
- Build output directory: `out`
- Environment variables (Production):
  - `NEXT_PUBLIC_LIFF_ID_RSVP` = your LIFF ID
  - `NEXT_PUBLIC_LINE_OA_ADD_FRIEND_URL` = `https://line.me/R/ti/p/@160vcltf`
  - `RSVP_WEBHOOK_URL` = the `/exec` URL from step 4 (**mark as Secret**)
  - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` — leave blank for now,
    needed once the LINE webhook is added.

### 6. Custom domain

Cloudflare Pages project → **Custom domains** → add `wedding.zacharyzhuo.com`.
Since DNS is already on Cloudflare, the CNAME is auto-created.

### 7. Point LIFF endpoint at the real URL

LINE Developers → LINE Login channel → LIFF tab → `rsvp` app → edit
**Endpoint URL** to `https://wedding.zacharyzhuo.com/liff/rsvp`.

Open `https://liff.line.me/<LIFF_ID>` inside LINE → the RSVP form should
load, prefill your displayName, and on submit append a row to the Sheet's
`RSVP_Responses` tab and email both maintainers.

---

## Layout

```
src/app/
  page.tsx              public landing (CTA = add OA)
  liff/rsvp/page.tsx    LIFF RSVP form (LINE identity from getProfile)
  rsvp-fallback/page.tsx non-LINE web RSVP
src/lib/liff.ts         LIFF init + profile hook
functions/api/rsvp.ts   Cloudflare Pages Function — forwards to Apps Script
apps-script/rsvp-webhook.gs  Sheet appender + email notifier
```

## Not yet built (next steps)

- Other LIFF apps: `seating`, `lucky-draw`, `photo`, `chat`
- LINE Messaging API webhook (`functions/api/line/webhook.ts`) for richer
  bot interactions; not needed until the OA-side automations are scoped.
- Turnstile on `/rsvp-fallback` before public launch.
- Real wedding photography on the landing.

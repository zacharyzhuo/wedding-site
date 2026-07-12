# wedding-site

卓育辰 ＆ 楊皖淩 · 2027-06-05 · LINE-central wedding site.

Static site on **Cloudflare Pages** at `wedding.zacharyzhuo.com`; LIFF apps
inside the **皖美育見你** LINE OA delegate to it; dynamic logic lives in
**Pages Functions**; live event data in **D1**, photo binaries in **R2**;
RSVP responses still append to the couple's existing Google Sheet via an
**Apps Script** web app.

Architecture lives in `~/.claude/skills/wedding-planning/`.

---

## Layout

```
src/app/
  page.tsx                  public landing (CTA = add OA)
  liff/rsvp/page.tsx        LIFF: RSVP (leader form, edit-prefill, party X/Y
                            progress + share block; not-attending gets a
                            plain thanks view)
  liff/join/page.tsx        LIFF: companion joins a party via the leader's
                            share link (GET preflight validates the code
                            before showing the form)
  liff/danmaku/page.tsx     LIFF: 想對新人說 (text → danmaku wall; optional
                            multi-photo attach → R2, sequential upload with
                            progress; message binds to the first photo)
  liff/raffle/page.tsx      LIFF: lucky-draw entry; polls GET /api/raffle
                            every 5s for mode + personal win banner
  liff/admin/page.tsx       LIFF: 即時審核 + 抽獎 ops (Zachary + Angelet only)
  screen/page.tsx           大螢幕: photo carousel + danmaku overlay + raffle
                            standby/reveal takeover (audio unlock persists in
                            sessionStorage across reloads)
  rsvp-fallback/page.tsx    non-LINE web RSVP (elderly-sized type/targets,
                            append-only by design)
src/components/
  ui.tsx                    shared primitives: Eyebrow / Field / SelectField /
                            Spinner / ConfirmButton (two-tap) / StatusBanner /
                            Card — use these, don't re-roll per page
src/lib/
  liff.ts                   LIFF init + profile hook
  liff-token.ts             liff.getIDToken() helper
  image-resize.ts           client-side canvas resize to ≤ 2048 px / 2 MB
                            (throws coded errors, e.g. DECODE_FAILED)
  upload-errors.ts          mapUploadError() — coded errors → zh-Hant copy
  diet.ts                   diet options + allergy-detail merge (buildDietValue)
  qr.ts                     share-link QR renderer
  raffle-sound.ts           raffle reveal sound cues
functions/_lib/
  http.ts                   json/ok/err/readJson helpers
  liff-verify.ts            server-side idToken verify (LINE /oauth2/v2.1/verify)
  admin.ts                  requireAdmin() — verify + allowlist gate
  moderation.ts             keyword filter + auto/manual mode (gates danmaku
                            AND photos since 2026-07-12)
  r2-presign.ts             aws4fetch presigned PUT/GET URLs
  identity.ts               guest_identity/party helpers (upsert/merge)
functions/api/
  rsvp.ts                   forwards to Apps Script + builds leader joinUrl
  party/join.ts             POST — companion joins; GET — preflight {leaderName}
  party/member-diet.ts      POST — member self-service: diet + own realName
  identity/me.ts            GET  — caller's identity/party state
  danmaku.ts                POST — submit a text danmaku
  photos/presign.ts         POST — get presigned R2 PUT URL
  photos/index.ts           POST — commit metadata (+ caption-as-danmaku);
                            status via decideStatus, returned to the client
  raffle.ts                 POST — enter; GET — {entered,total,mode,win}
  screen/feed.ts            GET  — polled by /screen (visible-only photos)
  line/webhook.ts           POST — 悄悄話 Messaging API webhook (Flex cards)
  admin/check.ts            GET  — gate check for /liff/admin first load
  admin/feed.ts             GET  — full feed for /liff/admin (all statuses)
  admin/danmaku/[id].ts     POST — { action: delete | approve } (approve also
                            restores a deleted row)
  admin/photos/[id].ts      POST — { action: hide | unhide | approve }
  admin/mode.ts             POST — { mode: auto | manual }
  admin/raffle/*            mode / prizes CRUD / draw (atomic conditional
                            INSERT — no oversell) / [id] redraw / index
  admin/thankyou/mode.ts    POST — 悄悄話 reply toggle
  admin/identity/*          GET list / POST set
apps-script/rsvp-webhook.gs Sheet appender + email notifier
migrations/0001-0006        D1: danmaku/photos/settings (key-value flags),
                            raffle entries+draws, prizes, thankyou_cards,
                            party + guest_identity, party message
```

---

## Bring-up — step by step

### 1. Install deps

```bash
cd ~/Documents/zacharyzhuo/wedding-site
npm install
```

### 2. Local env

```bash
cp .env.example .env.local
# Fill at minimum NEXT_PUBLIC_LIFF_ID_* for local LIFF dev.
# Server-only secrets (R2_*, LINE_LOGIN_CHANNEL_ID, ADMIN_LINE_USER_IDS,
# SCREEN_TOKEN, FORBIDDEN_WORDS) only need to be in Cloudflare Pages env
# vars for production — Pages Functions don't read .env.local.
```

### 3. Create the D1 database

```bash
npx wrangler d1 create wedding-live
# Copy the printed database_id into wrangler.jsonc d1_databases[0].database_id
npx wrangler d1 migrations apply wedding-live --remote
# Verify:
npx wrangler d1 execute wedding-live --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

In the Cloudflare dashboard → Pages project → **Settings → Bindings**, add
the same D1 database with binding name **`DB`** (production env).

### 4. Create the R2 bucket + API token

```bash
npx wrangler r2 bucket create wedding-photos
```

Then in the dashboard → **R2 → Manage R2 API tokens → Create API token**:

- **Permissions**: Object Read & Write
- **Specify buckets**: `wedding-photos` (do NOT grant account-wide)
- Note the **Access Key ID** + **Secret Access Key**

Add to Pages env vars (production, mark Secret):

- `R2_ACCOUNT_ID` (dashboard sidebar shows your account ID)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET=wedding-photos`

Also add the R2 bucket as a Pages binding with name **`PHOTOS`** (production).
The binding isn't used in code today but reserves the name in case we move
off presigned URLs later.

Finally set CORS on the bucket — without this the browser's presigned PUT is
blocked (uploads go cross-origin to `*.r2.cloudflarestorage.com`):

```bash
npx wrangler r2 bucket cors set wedding-photos --file r2-cors.json -y
```

with `r2-cors.json` (add localhost / preview origins as needed):

```json
{
  "rules": [
    {
      "allowed": {
        "origins": [
          "https://wedding.zacharyzhuo.com",
          "https://wedding-site-67g.pages.dev",
          "http://localhost:8788"
        ],
        "methods": ["GET", "PUT"],
        "headers": ["content-type"]
      },
      "maxAgeSeconds": 3600
    }
  ]
}
```

### 5. Register one LIFF app per page

LINE Developers → **LINE Login** channel → **LIFF** tab → Add. Repeat for each:

| LIFF name | Endpoint URL | Size | Scope |
|---|---|---|---|
| `rsvp`     | `https://wedding.zacharyzhuo.com/liff/rsvp`    | Tall | `profile` `openid` |
| `danmaku`  | `https://wedding.zacharyzhuo.com/liff/danmaku` | Full | `profile` `openid` |
| `admin`    | `https://wedding.zacharyzhuo.com/liff/admin`   | Full | `profile` `openid` |

(`danmaku` covers photo upload too — the message-and-photo page is merged.)

Copy each LIFF ID into the matching `NEXT_PUBLIC_LIFF_ID_*` env var.

Also note the **channel ID** (the LINE Login channel that owns the LIFF apps)
— that goes into `LINE_LOGIN_CHANNEL_ID` (server-only).

### 6. Find your LINE userIds (for ADMIN_LINE_USER_IDS)

Easiest one-off: open `/liff/admin` in LINE while logged in. The page will
show 「未授權」 since the allowlist is empty — but the API call to
`/api/admin/check` logs the userId server-side. **Easier in practice**: add
`console.log(profile.userId)` to `liff/admin/page.tsx` temporarily, open in
LINE, copy from the LIFF webview console (LINE inspector / `liff-inspector`
package). Remove the log after.

Then set in Pages env vars:

```
ADMIN_LINE_USER_IDS=U1234abcd...,U5678efgh...
```

### 7. Set the rest of the env vars

In Pages → Settings → Environment variables (production):

| Var | Value |
|---|---|
| `NEXT_PUBLIC_LIFF_ID_RSVP` / `_DANMAKU` / `_RAFFLE` / `_ADMIN` | from step 5 |
| `NEXT_PUBLIC_LIFF_ID_JOIN` | join LIFF id (party-identity share link/QR target) |
| `NEXT_PUBLIC_LINE_OA_ADD_FRIEND_URL` | `https://line.me/R/ti/p/@160vcltf` |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login channel ID (server, secret) |
| `LINE_LIFF_ID_JOIN` | same join LIFF id, server-side (builds `POST /api/rsvp`'s `joinUrl`) |
| `ADMIN_LINE_USER_IDS` | comma-separated, from step 6 |
| `SCREEN_TOKEN` | long random string (e.g. `openssl rand -hex 24`) |
| `FORBIDDEN_WORDS` | comma-separated. Start with profanity + 前任名字 |
| `R2_*` | from step 4 |
| `RSVP_WEBHOOK_URL` | Apps Script /exec URL (existing) |
| `LINE_CHANNEL_SECRET` / `_ACCESS_TOKEN` | blank for now |

### 8. Deploy

```bash
git add -A
git commit -m "feat: interactive layer (danmaku wall + photo upload)"
git push
# Cloudflare Pages auto-builds and deploys.
```

### 9. Add the rich-menu tiles in LINE Official Account Manager

Open OA Manager → ホーム → リッチメニュー → 編集. Use a 3×2 layout:

```
喜帖   | RSVP   | 我的座位
抽獎   | 上傳照片 | 想對新人說
```

For each tile pointing at a LIFF app, set the action type to **URL** with
`https://liff.line.me/<LIFF_ID>`.

### 10. Operate the screen on the day

On the AV laptop at the venue:

1. Connect HDMI to the in-room display.
2. Open Chrome (or Safari) → `https://wedding.zacharyzhuo.com/screen?token=<SCREEN_TOKEN>`.
3. F11 / Cmd-Shift-F to fullscreen.
4. Close other tabs, disable screen saver, disable sleep, keep Wi-Fi on.
5. Test 1 sample danmaku + 1 sample photo upload before doors open.

---

## Local dev

```bash
npm run dev
# http://localhost:3000  — landing
# http://localhost:3000/liff/rsvp     — opens LINE login redirect; works inside LINE
# http://localhost:3000/screen?token=<SCREEN_TOKEN>  — screen view (no LIFF)
```

API routes (`functions/api/*`) require **`wrangler pages dev`**, not just
`next dev`, because they're Pages Functions:

```bash
npm run pages:dev
```

With wrangler dev you also need a local D1 — apply migrations against the
local SQLite:

```bash
npx wrangler d1 migrations apply wedding-live
# (no --remote = local)
```

---

## Pre-event smoke test (T-3 days)

Walk the full flow on real devices before the wedding. Treat any failure
here as a release-blocking bug.

| # | What | How |
|---|---|---|
| 1 | RSVP still works | open `/liff/rsvp` in LINE, submit, check `RSVP_Responses` tab in Sheet |
| 2 | Danmaku appears on screen | `/liff/danmaku` send → `/screen?token=…` shows it within 6 s |
| 3 | Photo uploads + appears | `/liff/danmaku` with a photo attached → both photo + message-as-danmaku show |
| 4 | Caption shows on screen attached to photo | same upload, confirm display |
| 5 | Keyword filter holds | send a message containing a `FORBIDDEN_WORDS` entry — should NOT appear; `/liff/admin` shows it under 待審 |
| 6 | Admin can approve | from `/liff/admin`, approve a pending row → appears on screen on next poll |
| 7 | Admin can delete | delete a live message → disappears from screen on next poll |
| 8 | Admin can hide a photo | hide → photo drops from carousel within ~6 s |
| 9 | Mode toggle works | flip to MANUAL → next test message lands in 待審, not on screen |
| 10 | Non-admin gets 403 | open `/liff/admin` from a third device/account → 未授權 |
| 11 | Screen reconnects after Wi-Fi blip | toggle Wi-Fi off ~30 s, then back on → next poll resumes |
| 12 | Carousel doesn't get stuck on hidden photos | hide the currently-shown photo → next rotation skips it |

---

## Node version

Use **Node 20 LTS** (`lts/iron`). Pinned via `.nvmrc`; `nvm use` in the repo
root picks it up automatically. Node 22 reproducibly broke `next build` here
with prototype-inheritance errors in `@vercel/nft` / `postcss-selector-parser`
(both bundled inside Next 15.5). Cloudflare Pages CI defaults to Node 20.x
unless overridden, so this matches what production builds against.

## Known limitations / deliberate gaps

- **Sheet write-back is deferred.** D1 is the live source of truth during
  the event. After the wedding, export with
  `wrangler d1 execute wedding-live --remote --command "SELECT * FROM danmaku"`
  and paste into a new Sheet tab.
- **No rate limiting.** A determined guest could spam. If this becomes a
  problem during the event, flip mode to MANUAL.
- **`/screen?token=` token doesn't rotate.** If the token leaks, change the
  env var and reopen the URL on the AV laptop.
- **R2 lifecycle**: set a 12-month object expiration on the bucket via the
  R2 dashboard so old photos auto-delete (cost hygiene, optional).

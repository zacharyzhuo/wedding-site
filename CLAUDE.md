# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

The wedding website for Zachary (卓育辰) & Angelet (楊皖淩)'s wedding on
2027-06-05 at CHALET V Taipei. Deploys as a static site on **Cloudflare
Pages** at `wedding.zacharyzhuo.com`. The public landing page has one job:
convert visitors into followers of the **皖美育見你** LINE Official Account
(`src/app/page.tsx`) — RSVP (incl. party/group joins), the danmaku wall,
photo upload, the lucky draw, and admin moderation live behind the OA as
LIFF (LINE Front-end Framework) mini-apps; a Messaging API webhook answers
the 悄悄話 keyword with personalised Flex cards. (Seating lookup is NOT
implemented yet — its marketing copy was removed from the landing page
2026-07-12; a rich-menu slot is still reserved for it.) Dynamic logic runs
in Cloudflare Pages Functions; live event data lives in D1; photo binaries
live in R2; RSVP responses still land in the couple's Google Sheet via an
Apps Script web app. **The `wedding-planning` skill is the authoritative planning
doc** (guest list, budget, timeline) — this repo is just the event-day
interactive layer.

## Deployment — IMPORTANT

Push to `master` (the default branch — there is no `main`) auto-builds and
deploys via Cloudflare Pages (see README).
Do not push unless the user asked. `output: 'export'` (next.config.mjs)
writes static HTML to `out/`, matching `wrangler.jsonc`'s
`pages_build_output_dir` and `npm run pages:deploy`.

**Deployed state (go-live 2026-07-05)**: production runs the full interactive
layer. D1 `wedding-live` (real `database_id` now in `wrangler.jsonc`) and R2
`wedding-photos` (CORS set — see README) are provisioned; Pages production
secrets include the R2 keys and all four LIFF IDs. `.nvmrc` must stay an
exact version (`20.20.2`) — Pages' asdf build cannot resolve nvm aliases like
`lts/iron` and the build fails. Full bring-up steps are in README.md.

## Commands

- `npm run dev` — Next.js dev server only; **`functions/api/*` 404s here**,
  those are Pages Functions and need `wrangler pages dev` (see README)
- `npm run pages:dev` — build + `wrangler pages dev .next/static`; needed to
  exercise `functions/api/*` locally (also needs local D1: `npx wrangler d1
  migrations apply wedding-live`, no `--remote`)
- `npm run build` — `next build` (typecheck + static export)
- `npm run lint` — `next lint`
- `npm run pages:deploy` — build + `wrangler pages deploy out
  --project-name=wedding-site`

Note: `pages:dev` serves `.next/static`, while `pages:deploy` /
`wrangler.jsonc` target `out/` — if local Functions testing shows no
rendered pages, this mismatch is why.

## Stack & architecture

Next.js 15.5 (App Router, static export) + React 19 + TypeScript, Tailwind
3.4. `src/app/liff/{rsvp,join,danmaku,raffle,admin}/page.tsx` are LIFF pages
using `@line/liff` (`danmaku` is the merged message+photo page — text-first
with optional photos, multi-file sequential upload, the message binds to the
first photo; `join` is the companion-joins-a-party flow with a GET preflight
that validates the link before showing the form);
`src/app/screen/page.tsx` is the big-screen carousel + raffle takeover;
`src/app/rsvp-fallback/page.tsx` is the non-LINE RSVP form (elderly-sized
type/targets, deliberately append-only). Shared UI primitives (Eyebrow,
Field, SelectField, Spinner, ConfirmButton, StatusBanner, Card) live in
`src/components/ui.tsx` — use them instead of re-rolling per-page form
chrome; user-facing upload errors go through `src/lib/upload-errors.ts`
(zh-Hant copy only, never raw HTTP codes).

`functions/api/*` are Cloudflare Pages Functions (Workers runtime): `rsvp.ts`
forwards to Apps Script; `party/join.ts` (POST join + GET preflight) and
`party/member-diet.ts` (member self-service: diet + own name) back the party
flow; `danmaku.ts` inserts a text row into D1; `photos/presign.ts` +
`photos/index.ts` do R2 presign then commit metadata; `raffle.ts` is entry
(POST) + status (GET: `{entered,total,mode,win}` — polled by the raffle LIFF
for the win banner); `screen/feed.ts` is polled by `/screen`;
`line/webhook.ts` is the 悄悄話 Messaging API webhook; `admin/*` covers
check / feed / approve-delete-restore / hide-unhide-approve / mode toggles /
raffle ops (draw is a single conditional INSERT...SELECT so concurrent taps
can't oversell a prize) / identity management.

Shared helpers in `functions/_lib/`: `liff-verify.ts` re-verifies every
request's LIFF idToken against LINE's `/oauth2/v2.1/verify` endpoint each
call, no local JWT/JWKS handling (deliberate, see file header); `admin.ts`
layers an `ADMIN_LINE_USER_IDS` allowlist and **fails closed with 503** if
that env var is empty; `moderation.ts` demotes a submission to `pending` on
a `FORBIDDEN_WORDS` hit or when D1's `settings.moderation_mode` is
`'manual'` — since 2026-07-12 this gates **photos too**, one `decideStatus`
call per commit drives both the photo row and its caption's danmaku row;
`r2-presign.ts` signs PUT/GET URLs with `aws4fetch`. Uploads go
**browser → R2 directly** via presigned URL, not proxied through the
Worker — the `PHOTOS` binding in `wrangler.jsonc` is reserved but unused by
current code (see README).

D1 schema (`migrations/0001`–`0006`): `danmaku` + `photos` + `settings`
(key-value flags: `moderation_mode`, `raffle_mode`,
`raffle_mode_started_at`, …), `raffle_entries` + `raffle_draws` (append-only
audit, prize-name snapshot) + `raffle_prizes`, `thankyou_cards`, `party` +
`guest_identity`, party message. `apps-script/rsvp-webhook.gs` lives inside
the couple's Google Sheet (Extensions → Apps Script), deployed separately —
not part of this repo's build.

## Conventions & gotchas

- **Node 20 LTS only** (`.nvmrc`) — Node 22 reproducibly breaks `next build`
  here (see README).
- Client-side photo resize before upload: longest edge ≤2048px, JPEG q=0.8,
  hard cap 2MB (`src/lib/image-resize.ts`) — keeps R2's 10GB free tier
  from filling up.
- Env vars split `NEXT_PUBLIC_*` (client-visible: LIFF IDs, OA add-friend URL)
  from server-only secrets (`RSVP_WEBHOOK_URL`, `LINE_LOGIN_CHANNEL_ID`,
  `ADMIN_LINE_USER_IDS`, `SCREEN_TOKEN`, `FORBIDDEN_WORDS`, `R2_*`); server
  secrets go in the Cloudflare Pages dashboard only, Pages Functions don't
  read `.env.local` (see `.env.example`).
- `/screen?token=<SCREEN_TOKEN>` gates the big-screen view; the token does
  not rotate (see README).
- `functions/` is its own TypeScript project (`functions/tsconfig.json`
  extends root `tsconfig.json`, which excludes `functions` from itself) —
  types against `@cloudflare/workers-types`. Typecheck BOTH:
  `npx tsc --noEmit` and `npx tsc --noEmit -p functions/tsconfig.json`.
- Tests: `npx vitest run` — vitest globs `functions/**/*.test.ts` AND
  `src/**/*.test.ts` (pure logic in `src/lib/` is tested; API handlers are
  covered by typecheck + build, no D1 test harness).
- `/screen` audio unlock persists in `sessionStorage` so a mid-event reload
  does not re-block the carousel behind the tap gate.
- Destructive admin actions (delete / draw / redraw / prize delete) use the
  two-tap `ConfirmButton` pattern, not `window.confirm` — keep it that way,
  LIFF webviews handle native dialogs poorly.

## Known limitations (deliberate, per README)

- Sheet write-back from D1 is manual/deferred; D1 is the live source of
  truth during the event (see README). Deleting Sheet rows does NOT reset a
  guest's "already responded" state — that lives in D1 (`guest_identity`).
- No rate limiting on danmaku/photo submission — flip `moderation_mode` to
  `manual` if abused (since 2026-07-12 that gates photos as well as text).
- `/rsvp-fallback` has no identity/edit path by design; resubmits append new
  Sheet rows (the form warns the guest).
- Seating lookup (我的座位) has no code yet; rich menu still on the old
  layout. Test prizes (護手霜 ×2) must be replaced before the event.

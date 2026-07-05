# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

The wedding website for Zachary (卓育辰) & Angelet (楊皖淩)'s wedding on
2027-06-05 at CHALET V Taipei. Deploys as a static site on **Cloudflare
Pages** at `wedding.zacharyzhuo.com`. The public landing page has one job:
convert visitors into followers of the **皖美育見你** LINE Official Account
(`src/app/page.tsx`) — RSVP, the danmaku wall, photo upload, and admin
moderation live behind the OA as LIFF (LINE Front-end Framework) mini-apps.
(The landing page also advertises seating lookup and a lucky draw — those are
NOT implemented in this repo yet, only promised in the marketing copy.) Dynamic
logic (RSVP forwarding, danmaku, photo upload, admin moderation) runs in
Cloudflare Pages Functions; live event data lives in D1; photo binaries live
in R2; RSVP responses still land in the couple's Google Sheet via an Apps
Script web app. **The `wedding-planning` skill is the authoritative planning
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
3.4. `src/app/liff/{rsvp,danmaku,admin}/page.tsx` are LIFF pages using
`@line/liff` (`danmaku` is the merged message+photo page — text-first with an
optional photo attach; the standalone photo page was removed 2026-07-05);
`src/app/screen/page.tsx` is the big-screen carousel;
`src/app/rsvp-fallback/page.tsx` is the non-LINE RSVP form.

`functions/api/*` are Cloudflare Pages Functions (Workers runtime): `rsvp.ts`
forwards to Apps Script; `danmaku.ts` inserts a text row into D1;
`photos/presign.ts` + `photos/index.ts` do R2 presign then commit metadata;
`screen/feed.ts` is polled by `/screen`; `admin/*` covers check / feed /
approve-delete / hide-unhide / mode toggle.

Shared helpers in `functions/_lib/`: `liff-verify.ts` re-verifies every
request's LIFF idToken against LINE's `/oauth2/v2.1/verify` endpoint each
call, no local JWT/JWKS handling (deliberate, see file header); `admin.ts`
layers an `ADMIN_LINE_USER_IDS` allowlist and **fails closed with 503** if
that env var is empty; `moderation.ts` demotes a message to `pending` on a
`FORBIDDEN_WORDS` hit or when D1's `settings.moderation_mode` is `'manual'`;
`r2-presign.ts` signs PUT/GET URLs with `aws4fetch`. Uploads go
**browser → R2 directly** via presigned URL, not proxied through the
Worker — the `PHOTOS` binding in `wrangler.jsonc` is reserved but unused by
current code (see README).

D1 schema (`migrations/0001_init.sql`): `danmaku`, `photos`, `settings`
(single-row moderation-mode flag). `apps-script/rsvp-webhook.gs` lives inside
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
  types against `@cloudflare/workers-types`.

## Known limitations (deliberate, per README)

- Sheet write-back from D1 is manual/deferred; D1 is the live source of
  truth during the event (see README).
- No rate limiting on danmaku/photo submission — flip `moderation_mode` to
  `manual` if abused (see README).

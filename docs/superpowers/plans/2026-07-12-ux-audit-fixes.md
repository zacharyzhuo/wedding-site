# UX Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note (this repo, this run):** executed via the session's model-dispatch
> protocol — one work package per fresh subagent, disjoint file ownership, contracts
> pinned below. Implementers read the live code; this plan pins decisions, contracts,
> exact copy strings, and acceptance criteria rather than full code bodies.

**Goal:** Implement all findings from the 2026-07-12 five-agent UX audit: day-of safety (photo moderation, admin resilience, raffle visibility, confirmations), RSVP flow gaps, elderly fallback upgrades, design-system consistency, and a11y/platform fixes.

**Architecture:** Two implementation waves. Wave 1 lays shared design foundations (components + CSS) that Wave 2's three parallel packages (admin / RSVP flow / day-of guest) consume. Cross-package API contracts are pinned in this doc so parallel agents cannot drift.

**Tech Stack:** Next.js 15 static export, Tailwind, Cloudflare Pages Functions + D1, @line/liff, vitest.

## Global Constraints

- Guest-facing copy: Traditional Chinese only (labels may keep natural English). Admin copy zh-Hant.
- No new dependencies. No schema migrations (photo `status` is TEXT; `'pending'` needs no DDL).
- Stay within Cloudflare free tier. Static export must keep working (`npm run build`).
- No em-dash in any user-facing copy.
- Palette tokens (tailwind.config.ts): ink `#1f1c1a`, cream `#faf7f1`, champagne `#e8dccb`, accent `#a08254`.
- Agents: do NOT commit, do NOT push, do NOT touch files outside your package's ownership list. If you believe a foreign file must change, STOP and report BLOCKED.
- Tests: pure logic extracted to `src/lib/` gets vitest coverage; API handlers verified by typecheck + build (no D1 harness available).

## File ownership map (conflict avoidance)

| Package | Owns (create/modify) |
|---|---|
| WP-D (wave 1) | `src/components/ui.tsx` (new), `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx` |
| WP-A (wave 2) | `src/app/liff/admin/page.tsx`, `functions/api/admin/**` |
| WP-B (wave 2) | `src/app/liff/rsvp/page.tsx`, `src/app/liff/join/page.tsx`, `src/app/rsvp-fallback/page.tsx`, `functions/api/rsvp.ts`, `functions/api/party/join.ts`, `functions/api/party/member-diet.ts`, `src/lib/diet.ts` + its test |
| WP-C (wave 2) | `src/app/liff/danmaku/page.tsx`, `src/app/liff/raffle/page.tsx`, `src/app/screen/page.tsx`, `functions/api/photos/index.ts`, `functions/api/raffle.ts`, `functions/api/screen/feed.ts`, `src/lib/image-resize.ts`, `src/lib/upload-errors.ts` (new) + its test |

Shared read-only for everyone: `functions/_lib/*` (moderation.ts reused as-is; flag if a change seems needed), `src/lib/liff*.ts`, `tailwind.config.ts`.

## Pinned cross-package contracts

1. **Photo moderation** (WP-C writes, WP-A consumes):
   - `functions/api/photos/index.ts` commit path sets `status` via the same `decideStatus(env)` used by danmaku (AUTO → `visible`, MANUAL → `pending`). Response JSON gains `status: 'visible' | 'pending'`.
   - `functions/api/admin/photos/[id].ts` (WP-A) accepts `action: 'approve'` (any → `visible`) alongside existing hide/unhide.
   - `functions/api/admin/feed.ts` (WP-A) must return pending photos to admin.
   - `functions/api/screen/feed.ts` (WP-C) returns ONLY `visible` photos (verify; fix if not).
   - `functions/api/admin/mode.ts` (WP-A): mirror whatever demote-on-flip behavior exists for messages onto photos.
2. **Raffle guest status** (WP-C both sides): `GET /api/raffle` returns `{ entered, total, mode: 'on'|'off', win: { prizeName: string } | null }` (win = caller's ACTIVE draw, joined to prize name). POST unchanged semantically (no mode gate; entries stay open).
3. **Party join preflight** (WP-B both sides): `GET /api/party/join?code=X` returns `200 { ok: true, leaderName }` or `404 { error }`. No side effects.
4. **Member self-service** (WP-B both sides): `functions/api/party/member-diet.ts` additionally accepts optional `realName` (trimmed, non-empty, same length cap as rsvp.ts uses).
5. **Draw atomicity** (WP-A): stock check + insert collapse into one conditional `INSERT ... SELECT ... WHERE (SELECT COUNT(*) FROM raffle_draws WHERE prize_id = ?1 AND status = 'active') < ?2`; `meta.changes === 0` → HTTP 409 `{ error: '獎品已抽完或不存在' }`.

## Pinned zh-Hant copy strings

- Not-attending done view: title `已收到你的回覆`, body `謝謝你特地告訴我們。若之後可以出席，隨時回來修改回覆。`
- Join mismatch notice: `你已經是「{leaderName}」那一團的成員，不會重複計算。如需調整請至 RSVP 頁面修改。`
- Fallback resubmit warning: `再次送出會新增一筆回覆，不會覆蓋先前資料。填錯了也沒關係，直接聯絡新人幫你改。`
- Raffle win banner: `🎉 恭喜中獎：{prizeName}！請到主桌附近找工作人員領獎。`
- Raffle mode-on banner: `抽獎進行中，請盯著大螢幕！`
- Photo pending done copy: `已送出！照片審核通過後就會出現在大螢幕上。`
- Upload error map: decode → `圖片格式不支援，請換一張照片（建議 JPG/PNG）`; network/presign/PUT → `網路不穩，上傳失敗了，請再試一次`; fallback → `出了點小狀況，請稍後再試`.
- Two-tap confirm labels: `確定刪除？` / `確定開抽？` / `確定重抽？` (3s auto-revert to original label)
- Winner hold placeholder: `大螢幕開獎中…` (3s, then reveal name in admin)
- Deleted danmaku restore button: `復原`
- Bulk approve button: `全部通過（{n}）`
- Admin degraded banner: `連線不穩，重試中…`; error-screen retry button: `重新連線`
- Inline validation hints: `請輸入姓名` / `請選擇是否出席`
- Allergy/other detail field label: `過敏原或其他說明（會轉達給餐廳）`; value appended into diet string as `食物過敏（花生）` style.

---

### Task 1 (WP-D): Design foundation + landing fixes — wave 1, blocks wave 2

**Files:** Create `src/components/ui.tsx`; Modify `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`.

**Produces (wave 2 relies on these exact exports):**
- `Eyebrow({ script?, children })` — landing's pattern (font-display, `tracking-[0.25em]`, optional script line) generalized; landing's local copy replaced by import.
- `Field({ label, hint?, error?, children })` — label + optional hint + optional inline error (`role="status"` red text), wrapping any input.
- `SelectField({ label, value, onChange, options, name })`.
- `Spinner({ label? })` — CSS spinner (`.spinner` in globals.css) + zh label, replaces bare `載入中…` texts.
- `ConfirmButton({ label, confirmLabel, onConfirm, className?, disabled? })` — two-tap confirm, 3s auto-revert, `aria-live="polite"` on label swap.
- `StatusBanner({ kind: 'error'|'success'|'info', children })` — `aria-live="polite"` wrapper for all async status messages.

- [ ] `ui.tsx` with the six components above, styled with existing tokens (champagne borders, cream bg, ink text; offset solid shadow `shadow-[10px_10px_0_#e8dccb]` on a `Card` variant for LIFF use).
- [ ] globals.css: `:root` CSS vars for the four palette hexes; replace raw duplicated hexes at former lines ~251,262,298,315,323 with `var(...)`.
- [ ] globals.css: `.field-input` focus → `:focus-visible`; add `button, a, input, select, textarea, [role="button"] { touch-action: manipulation; }`; add `.spinner` keyframe.
- [ ] globals.css: `@media (prefers-reduced-motion: reduce)` — hero-up/reveal render final state instantly; invite-marquee paused; danmaku-fly becomes fade-in/out; carousel-fade kept (essential, slow); confetti-fall and gate-pulse and raffle-pop disabled or reduced to opacity.
- [ ] layout.tsx: add `viewport` export with `themeColor: '#faf7f1'`.
- [ ] page.tsx: remove `查看座位` from CTA copy (feature unshipped); countdown digits get `tabular-nums`; scroll-hint arrow gets `motion-reduce:animate-none`; replace local Eyebrow with the shared import (single spacing mechanism: drop manual full-width spaces OR tracking, not both).
- [ ] Verify: `npx tsc --noEmit` clean, `npm run build` green.

### Task 2 (WP-A): Admin resilience, safety, raffle backend — wave 2

**Files:** `src/app/liff/admin/page.tsx`, `functions/api/admin/**`.
**Consumes:** ui.tsx components, contracts 1 & 5.

- [ ] Resilience: transient fetch failures no longer kill the 5s poll; degraded banner `連線不穩，重試中…` while consecutive failures > 0; error screen (real auth failure only) gets `重新連線` retry button; auth check auto-retries with backoff (3 attempts).
- [ ] Shared action-error toast: every mutating action that reverts an optimistic update surfaces one toast (StatusBanner, auto-dismiss 5s).
- [ ] Photo moderation UI: pending photos visible in 照片 tab with `通過` button (contract 1); `[id].ts` accepts `approve`; feed returns pending photos; mode.ts mirrors message demote behavior for photos; AUTO/MANUAL toggle relabeled `審核模式（彈幕與照片）`.
- [ ] Confirmations: delete danmaku, prize delete, 開抽, 重抽 all via ConfirmButton; deleted danmaku rows show `復原` (sets visible); prize delete promoted from text link to padded button.
- [ ] Winner suspense: after draw resolves, admin shows `大螢幕開獎中…` for 3s before revealing the name.
- [ ] Bulk `全部通過（n）` on the pending danmaku filter (sequential calls to existing endpoint).
- [ ] Raffle ops: draw.ts conditional-insert atomicity (contract 5); prizes.ts DELETE rejects when draws reference the prize (400 with zh error); redraw missing-prize → specific `獎品已不存在` error; addPrize inline validation (quantity ≥ 1 integer) with visible hint; raffle tab shows `抽獎模式已開啟 X 分鐘` elapsed hint; 得獎紀錄 section moved above prize management.
- [ ] Tabs: overflow-x-auto + shrink-0; active tab synced to `?tab=` query param (read on mount, replaceState on change).
- [ ] Verify: `npx tsc --noEmit` clean; flag anything requiring foreign files.

### Task 3 (WP-B): RSVP flow + elderly fallback — wave 2

**Files:** `src/app/liff/rsvp/page.tsx`, `src/app/liff/join/page.tsx`, `src/app/rsvp-fallback/page.tsx`, `functions/api/rsvp.ts`, `functions/api/party/join.ts`, `functions/api/party/member-diet.ts`, `src/lib/diet.ts` (+ new test file).
**Consumes:** ui.tsx components, contracts 3 & 4.

- [ ] Not-attending branch: LeaderDoneView checks attending; not-attending → simple thanks view (pinned copy), no share/progress UI, keeps `修改回覆` edit entry.
- [ ] Edit cancel: `取消` link in edit form returns to done view without submitting.
- [ ] Join mismatch: when resolved party ≠ tapped code's party, show pinned mismatch notice instead of generic success; join API response must expose enough info (resolved leaderName + mismatch flag).
- [ ] Join preflight: GET validation on mount (contract 3); invalid → notice immediately (no wasted form fill); valid → form headline personalizes with leaderName.
- [ ] Member self-service: MemberDedupView also edits own realName (contract 4); join done screen links to diet/name update path.
- [ ] Submit buttons stay enabled; on submit with missing fields show inline hints (pinned strings) via Field error + StatusBanner; all three forms.
- [ ] Diet detail: selecting 食物過敏/其他 reveals a text input (pinned label); value merges into diet string as `食物過敏（花生）`; merge logic as pure fn `buildDietValue(diet, detail)` in src/lib/diet.ts with vitest cases (no detail, detail trimmed, parens stripped from user input).
- [ ] Progress auto-refresh: refetch party progress on `visibilitychange`→visible in addition to the manual button.
- [ ] Fallback page: base font `text-lg`, taller inputs/buttons (min-h 48px); add notes textarea (wired into POST, replacing hardcoded `''`); resubmit warning (pinned copy) above submit; non-2xx parses JSON `error` field first, falls back to friendly generic; inputs get `name` + `autoComplete`.
- [ ] All inputs across the three forms get `name`/`autoComplete`; async status text wrapped in StatusBanner.
- [ ] Verify: `npx vitest run` green incl. new diet tests; `npx tsc --noEmit` clean.

### Task 4 (WP-C): Day-of guest surfaces + screen — wave 2

**Files:** `src/app/liff/danmaku/page.tsx`, `src/app/liff/raffle/page.tsx`, `src/app/screen/page.tsx`, `functions/api/photos/index.ts`, `functions/api/raffle.ts`, `functions/api/screen/feed.ts`, `src/lib/image-resize.ts`, `src/lib/upload-errors.ts` (new + test).
**Consumes:** ui.tsx components, contracts 1 & 2.

- [ ] Photo moderation guest side (contract 1): commit uses decideStatus; done copy branches on returned status (pending → pinned copy); screen feed filters visible only.
- [ ] Upload UX: XHR-based PUT with `upload.onprogress` determinate bar; multi-file support (`multiple` file input, sequential pipeline, `第 x/y 張` progress, message attaches to first photo); per-file failure allows retry of remaining.
- [ ] Error mapping: `src/lib/upload-errors.ts` exports `mapUploadError(err): string` per pinned map; image-resize.ts throws coded errors (`DECODE_FAILED` etc.) instead of English prose; danmaku page routes ALL thrown errors through the map; vitest for the map.
- [ ] Raffle page: GET per contract 2; poll every 5s while open; win → pinned win banner; mode on → pinned mode banner; live entrant count keeps updating after entry.
- [ ] Screen: audio-gate unlocked flag in sessionStorage (reload doesn't re-block display; audio re-arms on next gesture); gate becomes `<button>` (keyboard + role semantics); carousel slides render caption + uploaderName overlay (small, bottom, ink-on-cream chip); `<img>` elements get explicit width/height; confetti palette derived from tokens (champagne/accent/cream tints only).
- [ ] Spinners: replace bare `載入中…` in danmaku + raffle pages with Spinner component.
- [ ] Verify: `npx vitest run` green incl. upload-errors tests; `npx tsc --noEmit` clean.

### Task 5: Integration verification — wave 3 (dispatcher runs)

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run` green (identity + diet + upload-errors).
- [ ] `npm run build` (static export) green.
- [ ] Fresh-context review agent verifies each task's checkboxes against the diff, adversarially (no scope creep, contracts honored, copy strings exact).
- [ ] Wave commits on `feat/ux-audit-fixes` (dispatcher, plain-text messages).
- [ ] Report to user; deploy/merge decision stays with the user.

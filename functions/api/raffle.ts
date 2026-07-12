// GET  /api/raffle — has this LINE user entered? + total entrant count +
// raffle mode. Fetched once on load by the raffle LIFF page (no polling).
// POST /api/raffle — enter the draw. Idempotent upsert keyed on the LINE
// userId: one account = one entry, re-entering just refreshes name/avatar.
// Entry stays open the whole time (no raffle-mode gate): present-to-win is
// enforced at draw time via redraw, so late/last-minute entries are fine.
//
// Fallback identity: a guest can reach the raffle without ever RSVPing or
// joining a party (e.g. they only added the OA and tapped the raffle rich
// menu item). If they have no guest_identity row yet, POST requires
// realName (+ optional diet) and writes one with source:'raffle',
// role:'solo' — same shape as the /api/party/join fallback, just untethered
// from any party. Already-identified guests skip straight to entering, no
// name prompt.

import { err, ok, readJson } from '../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../_lib/liff-verify'
import { getIdentity, upsertIdentity, mirrorToSheet } from '../_lib/identity'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  RSVP_WEBHOOK_URL?: string
}

interface Body {
  realName?: string
  diet?: string
}

// Mirrors src/lib/diet.ts's DIET_OPTIONS. functions/ doesn't cross-import
// from src/ (same convention as rsvp.ts's ALLOWED_DIET) — keep in sync by
// hand. Empty string is also accepted since diet is optional here.
const ALLOWED_DIET = new Set([
  '',
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
])

async function total(env: Env): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM raffle_entries`)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }
  // Three independent reads batched in parallel — same rationale as
  // screen/feed.ts: every D1 query is a network round-trip. This endpoint is
  // fetched once when the raffle LIFF page loads (no polling); winners are
  // announced on the venue screen, so no per-user win lookup is needed here.
  const [entered, totalN, modeRow] = await Promise.all([
    env.DB
      .prepare(`SELECT 1 AS x FROM raffle_entries WHERE line_user_id = ?`)
      .bind(user.userId)
      .first(),
    total(env),
    env.DB
      .prepare(`SELECT value FROM settings WHERE key = 'raffle_mode'`)
      .first<{ value: string }>(),
  ])
  return ok({
    entered: entered !== null,
    total: totalN,
    mode: modeRow?.value === 'on' ? 'on' : 'off',
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const existing = await getIdentity(env.DB, user.userId)
  if (!existing) {
    const body = await readJson<Body>(request)
    const realName = body?.realName?.trim()
    if (!realName) return err(400, 'name_required')
    if (!ALLOWED_DIET.has(body?.diet ?? '')) return err(400, 'invalid diet')

    const now = Date.now()
    await upsertIdentity(env.DB, {
      line_user_id: user.userId,
      real_name: realName,
      diet: body?.diet ?? null,
      party_id: null,
      role: 'solo',
      display_name: user.displayName,
      avatar_url: user.picture ?? null,
      source: 'raffle',
    }, now)

    // D1 write above is the source of truth; the Sheet mirror is best-effort
    // visibility for the couple and never blocks/fails the request — same
    // treatment as /api/party/join.
    await mirrorToSheet(env.RSVP_WEBHOOK_URL, 'identity', {
      line_user_id: user.userId,
      real_name: realName,
      diet: body?.diet ?? null,
      party_id: null,
      role: 'solo',
      display_name: user.displayName,
      source: 'raffle',
      updated_at: new Date(now).toISOString(),
    })
  }

  await env.DB
    .prepare(
      `INSERT INTO raffle_entries (line_user_id, display_name, avatar_url, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(line_user_id) DO UPDATE
         SET display_name = excluded.display_name,
             avatar_url   = excluded.avatar_url`
    )
    .bind(user.userId, user.displayName, user.picture ?? null, Date.now())
    .run()
  return ok({ entered: true, total: await total(env) })
}

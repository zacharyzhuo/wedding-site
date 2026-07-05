// GET  /api/raffle — has this LINE user entered? + total entrant count.
// POST /api/raffle — enter the draw. Idempotent upsert keyed on the LINE
// userId: one account = one entry, re-entering just refreshes name/avatar.

import { err, ok } from '../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../_lib/liff-verify'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
}

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
  const entered = await env.DB
    .prepare(`SELECT 1 AS x FROM raffle_entries WHERE line_user_id = ?`)
    .bind(user.userId)
    .first()
  return ok({ entered: entered !== null, total: await total(env) })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
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

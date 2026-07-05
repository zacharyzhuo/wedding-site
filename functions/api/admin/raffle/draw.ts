// POST /api/admin/raffle/draw  with body { prize }
//
// Picks a winner server-side with crypto randomness. Eligibility: every
// entrant not currently holding an ACTIVE win — one person can hold at most
// one prize, but a forfeited (absent) winner stays eligible for later draws.
// The inserted row is the audit record; the screen picks it up on its next
// feed poll and plays the reveal animation.

import { err, ok, readJson } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface Body { prize?: unknown }

const MAX_PRIZE_LEN = 40

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const prize = typeof body?.prize === 'string' ? body.prize.trim() : ''
  if (!prize) return err(400, 'prize required')
  if (prize.length > MAX_PRIZE_LEN) return err(400, `prize too long (max ${MAX_PRIZE_LEN})`)

  const eligibleRes = await env.DB
    .prepare(
      `SELECT line_user_id, display_name FROM raffle_entries
       WHERE line_user_id NOT IN (
         SELECT winner_id FROM raffle_draws WHERE status = 'active'
       )`
    )
    .all<{ line_user_id: string; display_name: string }>()
  const pool = eligibleRes.results ?? []
  if (pool.length === 0) return err(400, '沒有可抽的參加者（可能都已中獎）')

  // Modulo bias is negligible at wedding scale (pool << 2^32).
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const winner = pool[buf[0] % pool.length]

  const now = Date.now()
  const res = await env.DB
    .prepare(
      `INSERT INTO raffle_draws (prize, winner_id, winner_name, status, drawn_at)
       VALUES (?, ?, ?, 'active', ?)`
    )
    .bind(prize, winner.line_user_id, winner.display_name, now)
    .run()

  return ok({
    draw: {
      id: res.meta.last_row_id,
      prize,
      winnerName: winner.display_name,
      status: 'active',
      drawnAt: now,
    },
    poolSize: pool.length,
  })
}

// POST /api/admin/raffle/draw  with body { prizeId }
//
// Draws one winner for a pre-defined prize (raffle_prizes). Refuses when the
// prize has no remaining stock (quantity minus ACTIVE wins). Winner picked
// server-side with crypto randomness. Eligibility: entrants not currently
// holding an ACTIVE win — at most one prize per person, but a forfeited
// (absent) winner stays eligible for later draws. The inserted row is the
// audit record; the screen picks it up on its next feed poll.

import { err, ok, readJson } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface Body { prizeId?: unknown }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const prizeId = Number(body?.prizeId)
  if (!Number.isInteger(prizeId) || prizeId <= 0) return err(400, 'prizeId required')

  const prize = await env.DB
    .prepare(
      `SELECT p.id, p.name, p.quantity,
              (SELECT COUNT(*) FROM raffle_draws d
                WHERE d.prize_id = p.id AND d.status = 'active') AS won
       FROM raffle_prizes p WHERE p.id = ?`
    )
    .bind(prizeId)
    .first<{ id: number; name: string; quantity: number; won: number }>()
  if (!prize) return err(404, 'prize not found')
  if (prize.won >= prize.quantity) return err(400, `「${prize.name}」已抽完`)

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
      `INSERT INTO raffle_draws (prize, prize_id, winner_id, winner_name, status, drawn_at)
       VALUES (?, ?, ?, ?, 'active', ?)`
    )
    .bind(prize.name, prize.id, winner.line_user_id, winner.display_name, now)
    .run()

  return ok({
    draw: {
      id: res.meta.last_row_id,
      prize: prize.name,
      prizeId: prize.id,
      winnerName: winner.display_name,
      status: 'active',
      drawnAt: now,
    },
    poolSize: pool.length,
  })
}

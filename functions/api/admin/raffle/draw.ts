// POST /api/admin/raffle/draw  with body { prizeId }
//
// Draws one winner for a pre-defined prize (raffle_prizes). Refuses when the
// prize has no remaining stock (quantity minus ACTIVE wins). Winner picked
// server-side with crypto randomness. Eligibility: entrants not currently
// holding an ACTIVE win — at most one prize per person, but a forfeited
// (absent) winner stays eligible for later draws. The inserted row is the
// audit record; the screen picks it up on its next feed poll.
//
// Stock check + insert are collapsed into one conditional INSERT ... SELECT
// so two concurrent draws for the same prize (couple + MC both tapping
// "開抽" on separate phones) can't both pass a stock check performed as a
// separate SELECT and jointly oversell the prize. If the prize itself
// vanished between page load and tap (deleted elsewhere), the upfront
// existence check below returns a distinct message before we even try.

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
    .prepare(`SELECT id, name, quantity FROM raffle_prizes WHERE id = ?`)
    .bind(prizeId)
    .first<{ id: number; name: string; quantity: number }>()
  if (!prize) return err(404, '獎品已不存在')

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
       SELECT ?3, ?1, ?4, ?5, 'active', ?6
       WHERE (SELECT COUNT(*) FROM raffle_draws WHERE prize_id = ?1 AND status = 'active') < ?2`
    )
    .bind(prize.id, prize.quantity, prize.name, winner.line_user_id, winner.display_name, now)
    .run()
  if ((res.meta.changes ?? 0) === 0) return err(409, '獎品已抽完或不存在')

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

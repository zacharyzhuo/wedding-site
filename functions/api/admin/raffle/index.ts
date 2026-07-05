// GET /api/admin/raffle — entrant count + full draw history (audit log).

import { err, ok } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const [countRow, drawsRes] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM raffle_entries`).first<{ n: number }>(),
    env.DB
      .prepare(
        `SELECT id, prize, winner_name, status, drawn_at
         FROM raffle_draws ORDER BY id DESC LIMIT 100`
      )
      .all<{ id: number; prize: string; winner_name: string; status: string; drawn_at: number }>(),
  ])

  return ok({
    total: countRow?.n ?? 0,
    draws: (drawsRes.results ?? []).map(d => ({
      id: d.id,
      prize: d.prize,
      winnerName: d.winner_name,
      status: d.status,
      drawnAt: d.drawn_at,
    })),
  })
}

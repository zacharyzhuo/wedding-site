// GET /api/admin/raffle — raffle mode (+ when it was turned on) + entrant
// count + prize list (with remaining stock) + full draw history (audit log).

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

  const [countRow, modeRow, startedAtRow, prizesRes, drawsRes] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM raffle_entries`).first<{ n: number }>(),
    env.DB.prepare(`SELECT value FROM settings WHERE key = 'raffle_mode'`).first<{ value: string }>(),
    env.DB.prepare(`SELECT value FROM settings WHERE key = 'raffle_mode_started_at'`).first<{ value: string }>(),
    env.DB
      .prepare(
        `SELECT p.id, p.name, p.quantity, p.sort_order,
                (SELECT COUNT(*) FROM raffle_draws d
                  WHERE d.prize_id = p.id AND d.status = 'active') AS won
         FROM raffle_prizes p ORDER BY p.sort_order, p.id`
      )
      .all<{ id: number; name: string; quantity: number; sort_order: number; won: number }>(),
    env.DB
      .prepare(
        `SELECT id, prize, prize_id, winner_name, status, drawn_at
         FROM raffle_draws ORDER BY id DESC LIMIT 100`
      )
      .all<{ id: number; prize: string; prize_id: number | null; winner_name: string; status: string; drawn_at: number }>(),
  ])

  return ok({
    mode: modeRow?.value === 'on' ? 'on' : 'off',
    modeStartedAt: startedAtRow?.value ? Number(startedAtRow.value) : null,
    total: countRow?.n ?? 0,
    prizes: (prizesRes.results ?? []).map(p => ({
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      remaining: Math.max(0, p.quantity - p.won),
    })),
    draws: (drawsRes.results ?? []).map(d => ({
      id: d.id,
      prize: d.prize,
      prizeId: d.prize_id,
      winnerName: d.winner_name,
      status: d.status,
      drawnAt: d.drawn_at,
    })),
  })
}

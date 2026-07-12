// POST   /api/admin/raffle/prizes  with body { name, quantity } — add one.
// DELETE /api/admin/raffle/prizes?id=<id> — remove one. Rejected (400) if
// any raffle_draws row still references this prize_id: past draws keep a
// prize-name snapshot for display, but prize_id itself must stay resolvable
// so a forfeited draw can still be redrawn against the same prize.

import { err, ok, readJson } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface Body { name?: unknown; quantity?: unknown }

const MAX_NAME_LEN = 40
const MAX_QTY = 100

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const quantity = Number(body?.quantity)
  if (!name) return err(400, '請輸入獎項名稱')
  if (name.length > MAX_NAME_LEN) return err(400, `獎項名稱過長（最多 ${MAX_NAME_LEN} 字）`)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
    return err(400, `數量需為 1–${MAX_QTY} 的整數`)
  }

  const res = await env.DB
    .prepare(
      `INSERT INTO raffle_prizes (name, quantity, sort_order)
       VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM raffle_prizes))`
    )
    .bind(name, quantity)
    .run()

  return ok({ id: res.meta.last_row_id, name, quantity })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return err(400, 'invalid id')

  const referenced = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM raffle_draws WHERE prize_id = ?`)
    .bind(id)
    .first<{ n: number }>()
  if ((referenced?.n ?? 0) > 0) return err(400, '此獎項已有抽獎紀錄，無法刪除')

  const res = await env.DB
    .prepare(`DELETE FROM raffle_prizes WHERE id = ?`)
    .bind(id)
    .run()

  if ((res.meta.changes ?? 0) === 0) return err(404, 'not found')
  return ok({ id })
}

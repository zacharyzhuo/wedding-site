// POST /api/admin/raffle/:id  with body { action: 'forfeit' }
//
// Marks a draw forfeited (winner not present). The row stays as audit;
// admin then draws the same prize again. A forfeited entrant remains
// eligible for FUTURE draws — they may have just stepped out.

import { err, ok, readJson } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface Body { action?: unknown }

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return err(400, 'invalid id')

  const body = await readJson<Body>(request)
  if (body?.action !== 'forfeit') return err(400, 'action must be forfeit')

  const res = await env.DB
    .prepare(`UPDATE raffle_draws SET status = 'forfeited' WHERE id = ? AND status = 'active'`)
    .bind(id)
    .run()

  if ((res.meta.changes ?? 0) === 0) return err(404, 'not found or already forfeited')
  return ok({ id, status: 'forfeited' })
}

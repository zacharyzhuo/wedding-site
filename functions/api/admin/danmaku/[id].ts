// POST /api/admin/danmaku/:id  with body { action: 'delete' | 'approve' }
//
// Soft-delete is the only destructive operation — sets status='deleted' so
// the row drops out of /api/screen/feed but stays in D1 for audit. Approve
// promotes a 'pending' row to 'approved' so it starts appearing on screen.

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
  const action = body?.action
  if (action !== 'delete' && action !== 'approve') {
    return err(400, 'action must be delete or approve')
  }
  const newStatus = action === 'delete' ? 'deleted' : 'approved'

  const res = await env.DB
    .prepare(`UPDATE danmaku SET status = ? WHERE id = ?`)
    .bind(newStatus, id)
    .run()

  if ((res.meta.changes ?? 0) === 0) return err(404, 'not found')
  return ok({ id, status: newStatus })
}

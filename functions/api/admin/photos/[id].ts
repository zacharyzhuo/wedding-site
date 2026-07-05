// POST /api/admin/photos/:id  with body { action: 'hide' | 'unhide' }
//
// Hidden photos drop out of the carousel on the next poll but stay in R2 +
// D1. If a photo was accompanied by a caption-as-danmaku row, hiding the
// photo does NOT auto-delete the danmaku — admin should hit both endpoints
// when that's the intent. Keeping the actions decoupled because the most
// common case ("photo of someone in the bathroom") only needs the photo
// pulled, not the caption.

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
  if (action !== 'hide' && action !== 'unhide') {
    return err(400, 'action must be hide or unhide')
  }
  const newStatus = action === 'hide' ? 'hidden' : 'visible'

  // Unhide bumps created_at to now: the screen's feed cursor has long moved
  // past the original timestamp, so without the bump an unhidden photo would
  // never re-enter the carousel.
  const res = action === 'unhide'
    ? await env.DB
        .prepare(`UPDATE photos SET status = ?, created_at = ? WHERE id = ?`)
        .bind(newStatus, Date.now(), id)
        .run()
    : await env.DB
        .prepare(`UPDATE photos SET status = ? WHERE id = ?`)
        .bind(newStatus, id)
        .run()

  if ((res.meta.changes ?? 0) === 0) return err(404, 'not found')
  return ok({ id, status: newStatus })
}

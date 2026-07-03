// POST /api/danmaku — accept a text-only message from /liff/danmaku.
// Photo captions flow through /api/photos (which calls the same moderation
// helper) so they share filter logic without coupling the routes.

import { err, ok, readJson } from '../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../_lib/liff-verify'
import { decideStatus } from '../_lib/moderation'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  FORBIDDEN_WORDS?: string
}

interface Body {
  message?: unknown
}

const MAX_LEN = 60

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const raw = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!raw) return err(400, 'message required')
  if (raw.length > MAX_LEN) return err(400, `message too long (max ${MAX_LEN})`)

  const status = await decideStatus(raw, env)
  const now = Date.now()

  const result = await env.DB
    .prepare(
      `INSERT INTO danmaku (line_user_id, display_name, message, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(user.userId, user.displayName, raw, status, now)
    .run()

  return ok({
    id: result.meta.last_row_id,
    status,
    // Echo back so the client can show different copy when held for review.
    pending: status === 'pending',
  })
}

// POST /api/photos
// Called after the client has finished direct-uploading to R2 via the URL
// from /api/photos/presign. Inserts metadata into D1 and, if a caption was
// provided, inserts a danmaku row bound to the photo so the caption rides
// up to the wall at the same time.

import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { decideStatus } from '../../_lib/moderation'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  FORBIDDEN_WORDS?: string
}

interface Body {
  key?: unknown
  caption?: unknown
}

const KEY_PATTERN = /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i
const MAX_CAPTION = 60

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const key = typeof body?.key === 'string' ? body.key : ''
  // Defensive: the key must match the shape /presign hands out. Without this
  // a holder of any valid idToken could insert arbitrary keys (junk into the
  // wall, or someone else's r2_key claimed twice).
  if (!KEY_PATTERN.test(key)) return err(400, 'invalid key')

  const caption = typeof body?.caption === 'string' ? body.caption.trim() : ''
  if (caption.length > MAX_CAPTION) return err(400, `caption too long (max ${MAX_CAPTION})`)

  const now = Date.now()

  // Insert the photo first; the foreign key on danmaku.photo_id needs a real id.
  let photoId: number
  try {
    const result = await env.DB
      .prepare(
        `INSERT INTO photos (r2_key, uploader_id, uploader_name, caption, status, created_at)
         VALUES (?, ?, ?, ?, 'visible', ?)`
      )
      .bind(key, user.userId, user.displayName, caption || null, now)
      .run()
    photoId = result.meta.last_row_id as number
  } catch (e) {
    // UNIQUE(r2_key) collision => the client retried after a successful commit.
    // Surface as 409 so the client can treat it as already-done.
    const msg = e instanceof Error ? e.message : 'commit failed'
    if (/UNIQUE constraint failed/i.test(msg)) return err(409, 'already committed')
    return err(500, msg)
  }

  // Caption → auto-danmaku, sharing the moderation pipeline with /api/danmaku.
  let danmakuId: number | null = null
  let captionPending = false
  if (caption) {
    const status = await decideStatus(caption, env)
    captionPending = status === 'pending'
    const r = await env.DB
      .prepare(
        `INSERT INTO danmaku
           (line_user_id, display_name, message, photo_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(user.userId, user.displayName, caption, photoId, status, now)
      .run()
    danmakuId = r.meta.last_row_id as number
  }

  return ok({
    photoId,
    danmakuId,
    captionPending,
  })
}

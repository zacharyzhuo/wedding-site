// GET /api/admin/feed
// Returns the latest 100 danmaku + 50 photos in any status, so the admin
// LIFF can see both approved (already on screen) and pending (filter hit /
// manual queue) rows. Includes presigned photo URLs for thumbnails.

import { err, json } from '../../_lib/http'
import { LiffAuthError } from '../../_lib/liff-verify'
import { requireAdmin } from '../../_lib/admin'
import { presignGet } from '../../_lib/r2-presign'
import { readModerationMode } from '../../_lib/moderation'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_ENDPOINT?: string
}

interface DanmakuRow {
  id: number; display_name: string; message: string
  photo_id: number | null; status: string; created_at: number
}
interface PhotoRow {
  id: number; r2_key: string; uploader_name: string
  caption: string | null; status: string; created_at: number
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const [danmakuRes, photoRes, mode, thankyouRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, display_name, message, photo_id, status, created_at
         FROM danmaku
         ORDER BY created_at DESC
         LIMIT 100`
      ).all<DanmakuRow>(),
    env.DB
      .prepare(
        `SELECT id, r2_key, uploader_name, caption, status, created_at
         FROM photos
         ORDER BY created_at DESC
         LIMIT 50`
      ).all<PhotoRow>(),
    readModerationMode(env.DB),
    env.DB
      .prepare(`SELECT value FROM settings WHERE key = 'thankyou_mode'`)
      .first<{ value: string }>(),
  ])

  const photoRows = photoRes.results ?? []
  const photos = await Promise.all(
    photoRows.map(async row => ({
      id: row.id,
      url: await presignGet(env, row.r2_key),
      uploaderName: row.uploader_name,
      caption: row.caption,
      status: row.status,
      createdAt: row.created_at,
    }))
  )

  const danmaku = (danmakuRes.results ?? []).map(row => ({
    id: row.id,
    displayName: row.display_name,
    message: row.message,
    photoId: row.photo_id,
    status: row.status,
    createdAt: row.created_at,
  }))

  // 悄悄話 gate: guests only see their thank-you card once the couple flips
  // this on in the admin (default off, so cards stay hidden until the reveal).
  const thankyouMode = thankyouRow?.value === 'on' ? 'on' : 'off'

  return json(200, { ok: true, mode, thankyouMode, danmaku, photos })
}

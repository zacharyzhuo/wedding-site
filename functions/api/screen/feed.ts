// GET /api/screen/feed?token=<token>&since=<unix_ms>
// Polled by /screen every ~3 s. Returns new approved danmaku + visible
// photos created after `since`, with presigned R2 GET URLs so the screen
// can render images without exposing the bucket.
//
// Token gating: SCREEN_TOKEN env var. Trivial to brute-force if short, so
// keep it long and random; rotate by changing the env var.

import { err, json } from '../../_lib/http'
import { presignGet } from '../../_lib/r2-presign'

interface Env {
  DB: D1Database
  SCREEN_TOKEN?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_ENDPOINT?: string
}

interface DanmakuRow {
  id: number
  display_name: string
  message: string
  photo_id: number | null
  created_at: number
}
interface PhotoRow {
  id: number
  r2_key: string
  uploader_name: string
  caption: string | null
  created_at: number
}

const MAX_PER_KIND = 50

// Constant-time string compare to discourage timing attacks on the token.
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SCREEN_TOKEN) return err(500, 'screen not configured')

  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  if (!safeEquals(token, env.SCREEN_TOKEN)) return err(403, 'forbidden')

  const sinceRaw = Number(url.searchParams.get('since') ?? '0')
  const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? sinceRaw : 0

  // The screen reports what it is currently displaying (flying danmaku ids,
  // carousel photo ids); we answer with the subset that is no longer
  // displayable so admin delete/hide takes effect on the NEXT poll instead
  // of only stopping future deliveries.
  const parseIds = (name: string): number[] => {
    const raw = url.searchParams.get(name)
    if (!raw) return []
    return raw.split(',')
      .map(Number)
      .filter(n => Number.isInteger(n) && n > 0)
      .slice(0, 100)
  }
  const activeD = parseIds('active_d')
  const activeP = parseIds('active_p')

  const [danmakuRes, photoRes] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, display_name, message, photo_id, created_at
         FROM danmaku
         WHERE status = 'approved' AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(since, MAX_PER_KIND)
      .all<DanmakuRow>(),
    env.DB
      .prepare(
        `SELECT id, r2_key, uploader_name, caption, created_at
         FROM photos
         WHERE status = 'visible' AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(since, MAX_PER_KIND)
      .all<PhotoRow>(),
  ])

  const photoRows = photoRes.results ?? []
  const photos = await Promise.all(
    photoRows.map(async row => ({
      id: row.id,
      url: await presignGet(env, row.r2_key),
      uploaderName: row.uploader_name,
      caption: row.caption,
      createdAt: row.created_at,
    }))
  )

  const danmaku = (danmakuRes.results ?? []).map(row => ({
    id: row.id,
    displayName: row.display_name,
    message: row.message,
    photoId: row.photo_id,
    createdAt: row.created_at,
  }))

  // Cursor = max(createdAt) across both sets; client passes this back as
  // `since`. The cursor must NEVER outrun rows actually returned: the old
  // Date.now() fallback on empty polls raced in-flight writes (a row whose
  // timestamp was captured before the poll but committed after it was
  // permanently skipped — a guest saw their photo but never the caption).
  // With `>=` in the queries, boundary rows re-deliver on the next poll and
  // the screen client dedupes them by id.
  const cursor = Math.max(
    since,
    ...danmaku.map(d => d.createdAt),
    ...photos.map(p => p.createdAt),
  )

  const removedDanmaku = activeD.length
    ? (((await env.DB
        .prepare(
          `SELECT id FROM danmaku
           WHERE id IN (${activeD.map(() => '?').join(',')})
             AND status != 'approved'`
        )
        .bind(...activeD)
        .all<{ id: number }>()).results) ?? []).map(r => r.id)
    : []
  const removedPhotos = activeP.length
    ? (((await env.DB
        .prepare(
          `SELECT id FROM photos
           WHERE id IN (${activeP.map(() => '?').join(',')})
             AND status != 'visible'`
        )
        .bind(...activeP)
        .all<{ id: number }>()).results) ?? []).map(r => r.id)
    : []

  return json(200, { ok: true, danmaku, photos, cursor, removedDanmaku, removedPhotos })
}

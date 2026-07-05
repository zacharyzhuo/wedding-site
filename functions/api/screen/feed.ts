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

  // One parallel batch — these used to be sequential awaits, and every D1
  // query is a network round-trip, which was most of the poll latency once
  // the raffle queries joined the feed.
  const [danmakuRes, photoRes, removedDRes, removedPRes, raffleModeRow, latestDraw] = await Promise.all([
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
    activeD.length
      ? env.DB
          .prepare(
            `SELECT id FROM danmaku
             WHERE id IN (${activeD.map(() => '?').join(',')})
               AND status != 'approved'`
          )
          .bind(...activeD)
          .all<{ id: number }>()
      : Promise.resolve(null),
    activeP.length
      ? env.DB
          .prepare(
            `SELECT id FROM photos
             WHERE id IN (${activeP.map(() => '?').join(',')})
               AND status != 'visible'`
          )
          .bind(...activeP)
          .all<{ id: number }>()
      : Promise.resolve(null),
    env.DB
      .prepare(`SELECT value FROM settings WHERE key = 'raffle_mode'`)
      .first<{ value: string }>(),
    env.DB
      .prepare(
        `SELECT d.id, d.prize, d.winner_name, d.drawn_at,
                e.avatar_url AS winner_avatar
         FROM raffle_draws d
         LEFT JOIN raffle_entries e ON e.line_user_id = d.winner_id
         WHERE d.status = 'active'
         ORDER BY d.id DESC LIMIT 1`
      )
      .first<{ id: number; prize: string; winner_name: string; drawn_at: number; winner_avatar: string | null }>(),
  ])

  const photoRows = photoRes.results ?? []
  const photos = await Promise.all(
    photoRows.map(async row => ({
      id: row.id,
      // Signed GET URLs must outlive the whole event: the screen loops ALL
      // of the night's photos, so the 10-minute default TTL would rot into
      // broken images during quiet stretches.
      url: await presignGet(env, row.r2_key, 60 * 60 * 12),
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

  const removedDanmaku = (removedDRes?.results ?? []).map(r => r.id)
  const removedPhotos = (removedPRes?.results ?? []).map(r => r.id)

  // Raffle state for the screen: `mode` drives the standby takeover
  // (「抽獎時間」 + prize list + winners so far), the latest ACTIVE draw
  // drives the reveal (screen tracks the last id it has seen), and entrant
  // name+avatar samples feed the roll animation. Second parallel batch —
  // these depend on raffleMode/latestDraw from the first batch.
  const raffleMode = raffleModeRow?.value === 'on' ? 'on' : 'off'
  const needEntrants = latestDraw !== null || raffleMode === 'on'
  const needStandby = raffleMode === 'on'
  const [entrantsRes, totalRow, prizesRes, winsRes] = await Promise.all([
    needEntrants
      ? env.DB
          .prepare(`SELECT display_name, avatar_url FROM raffle_entries ORDER BY RANDOM() LIMIT 40`)
          .all<{ display_name: string; avatar_url: string | null }>()
      : Promise.resolve(null),
    needStandby
      ? env.DB.prepare(`SELECT COUNT(*) AS n FROM raffle_entries`).first<{ n: number }>()
      : Promise.resolve(null),
    needStandby
      ? env.DB
          .prepare(`SELECT id, name, quantity FROM raffle_prizes ORDER BY sort_order, id`)
          .all<{ id: number; name: string; quantity: number }>()
      : Promise.resolve(null),
    needStandby
      ? env.DB
          .prepare(
            `SELECT d.prize_id, d.winner_name, e.avatar_url
             FROM raffle_draws d
             LEFT JOIN raffle_entries e ON e.line_user_id = d.winner_id
             WHERE d.status = 'active' ORDER BY d.id`
          )
          .all<{ prize_id: number | null; winner_name: string; avatar_url: string | null }>()
      : Promise.resolve(null),
  ])

  const entrants = (entrantsRes?.results ?? [])
    .map(r => ({ name: r.display_name, avatar: r.avatar_url }))

  const wins = winsRes?.results ?? []
  const raffleStandby = needStandby
    ? {
        total: totalRow?.n ?? 0,
        prizes: (prizesRes?.results ?? []).map(p => {
          const winners = wins
            .filter(w => w.prize_id === p.id)
            .map(w => ({ name: w.winner_name, avatar: w.avatar_url }))
          return {
            name: p.name,
            quantity: p.quantity,
            remaining: Math.max(0, p.quantity - winners.length),
            winners,
          }
        }),
      }
    : null

  return json(200, {
    ok: true, danmaku, photos, cursor, removedDanmaku, removedPhotos,
    raffle: {
      mode: raffleMode,
      standby: raffleStandby,
      entrants,
      draw: latestDraw
        ? {
            id: latestDraw.id,
            prize: latestDraw.prize,
            winnerName: latestDraw.winner_name,
            winnerAvatar: latestDraw.winner_avatar,
            drawnAt: latestDraw.drawn_at,
          }
        : null,
    },
  })
}

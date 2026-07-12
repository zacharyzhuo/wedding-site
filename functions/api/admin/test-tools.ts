// POST /api/admin/test-tools — pre-event data hygiene. NOT for event day.
//
// Triple gate, all fail closed: (1) admin allowlist, (2) TEST_TOOLS env var
// must be exactly 'on' — flip it off in the Pages dashboard the week of the
// wedding and the whole feature (UI tab included) disappears, (3) bulk wipes
// additionally require the operator to have typed the confirm phrase.
//
// Actions:
//   wipe_danmaku_photos — DELETE all danmaku + photos rows and their R2
//     objects (uses the PHOTOS bucket binding; first code path to use it).
//   wipe_raffle         — DELETE all raffle_entries + raffle_draws. The
//     raffle_prizes list is kept: prizes are setup, not test residue.
//   reset_my_rsvp       — delete ONLY the caller's guest_identity row; if
//     they lead a party, delete that party and detach its members
//     (party_id=NULL, role='solo'). Other people's identities are never
//     deleted. Sheet rows are untouched (append-only by design).

import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError } from '../../_lib/liff-verify'
import { requireAdmin } from '../../_lib/admin'

interface Env {
  DB: D1Database
  PHOTOS: R2Bucket
  TEST_TOOLS?: string
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface Body { action?: unknown; confirm?: unknown }

const CONFIRM_PHRASE = '清除'
const R2_DELETE_BATCH = 1000 // R2Bucket.delete() caps at 1000 keys per call

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let userId: string
  try {
    userId = (await requireAdmin(request, env)).userId
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  if (env.TEST_TOOLS !== 'on') return err(403, '測試工具未啟用（TEST_TOOLS）')

  const body = await readJson<Body>(request)
  const action = body?.action

  if (action === 'wipe_danmaku_photos') {
    if (body?.confirm !== CONFIRM_PHRASE) return err(400, `請輸入「${CONFIRM_PHRASE}」確認`)

    const keysRes = await env.DB
      .prepare(`SELECT r2_key FROM photos`)
      .all<{ r2_key: string }>()
    const keys = (keysRes.results ?? []).map(r => r.r2_key)
    for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) {
      await env.PHOTOS.delete(keys.slice(i, i + R2_DELETE_BATCH))
    }

    const danmaku = await env.DB.prepare(`DELETE FROM danmaku`).run()
    const photos = await env.DB.prepare(`DELETE FROM photos`).run()
    return ok({
      danmaku: danmaku.meta.changes ?? 0,
      photos: photos.meta.changes ?? 0,
      r2Objects: keys.length,
    })
  }

  if (action === 'wipe_raffle') {
    if (body?.confirm !== CONFIRM_PHRASE) return err(400, `請輸入「${CONFIRM_PHRASE}」確認`)

    const entries = await env.DB.prepare(`DELETE FROM raffle_entries`).run()
    const draws = await env.DB.prepare(`DELETE FROM raffle_draws`).run()
    return ok({
      entries: entries.meta.changes ?? 0,
      draws: draws.meta.changes ?? 0,
    })
  }

  if (action === 'reset_my_rsvp') {
    const me = await env.DB
      .prepare(`SELECT party_id, role FROM guest_identity WHERE line_user_id = ?`)
      .bind(userId)
      .first<{ party_id: string | null; role: string }>()

    let membersDetached = 0
    let partyDeleted = false
    if (me?.role === 'leader' && me.party_id) {
      const detached = await env.DB
        .prepare(
          `UPDATE guest_identity SET party_id = NULL, role = 'solo'
           WHERE party_id = ? AND line_user_id != ?`
        )
        .bind(me.party_id, userId)
        .run()
      membersDetached = detached.meta.changes ?? 0
      await env.DB.prepare(`DELETE FROM party WHERE party_id = ?`).bind(me.party_id).run()
      partyDeleted = true
    }
    const identity = await env.DB
      .prepare(`DELETE FROM guest_identity WHERE line_user_id = ?`)
      .bind(userId)
      .run()

    return ok({
      identityDeleted: (identity.meta.changes ?? 0) > 0,
      partyDeleted,
      membersDetached,
    })
  }

  return err(400, 'action must be wipe_danmaku_photos, wipe_raffle, or reset_my_rsvp')
}

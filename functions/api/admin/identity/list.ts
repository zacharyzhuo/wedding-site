// GET /api/admin/identity/list
//
// Lists raffle entrants (raffle_entries) who don't yet have a real name in
// guest_identity — either they never went through RSVP/join at all (raffle
// was their first touchpoint) or an identity row exists but real_name is
// still empty. The admin LIFF's 身分 tab uses this to drive manual naming.

import { err, ok } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface UnidentifiedRow {
  userId: string
  displayName: string
  avatarUrl: string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const rows = await env.DB.prepare(
    `SELECT r.line_user_id AS userId, r.display_name AS displayName, r.avatar_url AS avatarUrl
     FROM raffle_entries r
     LEFT JOIN guest_identity g ON g.line_user_id = r.line_user_id
     WHERE g.line_user_id IS NULL OR g.real_name IS NULL OR g.real_name = ''
     ORDER BY r.created_at DESC`
  ).all<UnidentifiedRow>()

  return ok({ unidentified: rows.results ?? [] })
}

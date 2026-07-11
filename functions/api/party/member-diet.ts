// Cloudflare Pages Function: POST /api/party/member-diet
//
// A party MEMBER (bound to a leader's party via /api/party/join, or by
// having submitted the leader RSVP form before Task 6b's dedup view
// existed) opens /liff/rsvp and sees a small "update my diet" control
// instead of the leader form — the leader already answered for the whole
// party, and re-submitting the leader form would wrongly promote them via
// mergeIdentity's role-adoption rule (see _lib/identity.ts). This endpoint
// updates ONLY the caller's own diet, preserving every other field
// (real_name/role/party_id/source) on their guest_identity row untouched.

import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { getIdentity, upsertIdentity, mirrorToSheet } from '../../_lib/identity'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  RSVP_WEBHOOK_URL?: string
}

interface Body {
  diet?: string
}

// Mirrors src/lib/diet.ts's DIET_OPTIONS. functions/ doesn't cross-import
// from src/ (same convention as rsvp.ts's ALLOWED_DIET) — keep in sync by
// hand. Empty string is also accepted: mergeIdentity treats an empty
// incoming diet as "keep existing", so it's a harmless no-op rather than a
// rejected request.
const ALLOWED_DIET = new Set([
  '',
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
])

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const diet = body?.diet ?? ''
  if (!ALLOWED_DIET.has(diet)) return err(400, 'invalid diet')

  const existing = await getIdentity(env.DB, user.userId)
  if (!existing) return err(400, 'not identified yet')

  const now = Date.now()
  const updated = await upsertIdentity(env.DB, {
    line_user_id: existing.line_user_id,
    real_name: existing.real_name,
    diet,
    party_id: existing.party_id,
    role: existing.role,
    display_name: user.displayName,
    avatar_url: user.picture ?? null,
    source: existing.source,
  }, now)

  // D1 write above is the source of truth; the Sheet mirror is best-effort
  // visibility for the couple and never blocks/fails the request — same
  // treatment as the other identity writes (join.ts, rsvp.ts).
  await mirrorToSheet(env.RSVP_WEBHOOK_URL, 'identity', {
    line_user_id: updated.line_user_id,
    real_name: updated.real_name,
    diet: updated.diet,
    party_id: updated.party_id,
    role: updated.role,
    display_name: updated.display_name,
    source: updated.source,
    updated_at: new Date(now).toISOString(),
  })

  return ok({ diet: updated.diet })
}

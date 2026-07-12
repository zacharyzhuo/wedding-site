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
import { getIdentity, mirrorToSheet } from '../../_lib/identity'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  RSVP_WEBHOOK_URL?: string
}

interface Body {
  diet?: string
  realName?: string
}

// Same magnitude as rsvp.ts's MAX_NAME_LEN — kept in sync by hand.
const MAX_NAME_LEN = 40

// Mirrors src/lib/diet.ts's DIET_OPTIONS. functions/ doesn't cross-import
// from src/ (same convention as rsvp.ts's ALLOWED_DIET) — keep in sync by
// hand. Empty string is also accepted: an empty incoming diet means "keep
// existing", handled explicitly below now that this endpoint no longer goes
// through mergeIdentity (see comment on the UPDATE below).
const ALLOWED_DIET = new Set([
  '',
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
])

// Detail-merged forms produced by buildDietValue (src/lib/diet.ts), e.g.
// 食物過敏（花生）— see rsvp.ts's identical pattern.
const DIET_DETAIL_PATTERN = /^(?:食物過敏|其他)（[^（）]{1,60}）$/

function isAllowedDiet(diet: string): boolean {
  return ALLOWED_DIET.has(diet) || DIET_DETAIL_PATTERN.test(diet)
}

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
  if (!isAllowedDiet(diet)) return err(400, 'invalid diet')

  let realName: string | undefined
  if (body?.realName !== undefined) {
    realName = body.realName.trim()
    if (!realName) return err(400, 'real name required')
    if (realName.length > MAX_NAME_LEN) return err(400, `real name too long (max ${MAX_NAME_LEN})`)
  }

  const existing = await getIdentity(env.DB, user.userId)
  if (!existing) return err(400, 'not identified yet')

  const now = Date.now()
  const finalDiet = diet !== '' ? diet : (existing.diet ?? '')
  const finalRealName = realName ?? existing.real_name

  // Bypasses upsertIdentity/mergeIdentity on purpose: mergeIdentity never
  // overwrites a non-empty real_name (see _lib/identity.ts's comment on the
  // `real_name` field) — correct for the join/rsvp writes it guards against,
  // but wrong here, since this endpoint's whole point is letting a guest
  // correct their OWN name (contract 4). A direct UPDATE, scoped to this one
  // file, is the narrower fix instead of loosening that shared guard.
  await env.DB.prepare(
    `UPDATE guest_identity SET real_name = ?, diet = ?, display_name = ?, updated_at = ? WHERE line_user_id = ?`,
  ).bind(finalRealName, finalDiet, user.displayName, now, existing.line_user_id).run()

  const updated = {
    ...existing,
    real_name: finalRealName,
    diet: finalDiet,
    display_name: user.displayName,
    updated_at: now,
  }

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

  return ok({ diet: updated.diet, realName: updated.real_name })
}

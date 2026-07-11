// POST /api/admin/identity/set  with body { userId, realName, partyId? }
//
// Lets the couple manually name a guest who was only ever seen via the
// raffle (never RSVP'd or joined a party with LINE). source='manual' marks
// provenance so the identity list can tell "we typed this in" apart from
// "the guest told us themselves".
//
// Note: this reuses upsertIdentity, and mergeIdentity() never overwrites an
// existing non-empty real_name (see functions/_lib/identity.ts). That's
// intentional here too — this endpoint's job is naming the *unidentified*,
// not correcting an already-named guest's spelling. If a correction flow is
// ever needed, it'll need a separate "force" path.

import { err, ok, readJson } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'
import { upsertIdentity, mirrorToSheet } from '../../../_lib/identity'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
  RSVP_WEBHOOK_URL?: string
}

interface Body {
  userId?: string
  realName?: string
  partyId?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const userId = body?.userId?.trim()
  const realName = body?.realName?.trim()
  const partyId = body?.partyId?.trim() || null
  if (!userId) return err(400, 'missing userId')
  if (!realName) return err(400, 'real name required')

  const now = Date.now()
  await upsertIdentity(env.DB, {
    line_user_id: userId,
    real_name: realName,
    diet: null,
    party_id: partyId,
    role: partyId ? 'member' : 'solo',
    display_name: null,
    avatar_url: null,
    source: 'manual',
  }, now)

  // D1 write above is the source of truth; the Sheet mirror is best-effort
  // visibility for the couple and never blocks/fails the request — same
  // treatment as the join-flow mirror in /api/party/join.
  await mirrorToSheet(env.RSVP_WEBHOOK_URL, 'identity', {
    line_user_id: userId,
    real_name: realName,
    diet: null,
    party_id: partyId,
    role: partyId ? 'member' : 'solo',
    display_name: null,
    source: 'manual',
    updated_at: new Date(now).toISOString(),
  })

  return ok({})
}

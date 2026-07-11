// Cloudflare Pages Function: POST /api/party/join
//
// A companion (non-leader) taps the leader's share link (?party=<code>),
// which opens the /liff/join LIFF app. That page verifies LINE identity and
// posts here to self-identify: real name + diet, bound to the leader's
// party. Unlike the RSVP leader flow, this never creates a party — joining
// a party that doesn't exist (bad/stale link) is a 404, not an upsert.

import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { getParty, getIdentity, upsertIdentity, mirrorToSheet } from '../../_lib/identity'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  RSVP_WEBHOOK_URL?: string
}

interface Body {
  partyId?: string
  realName?: string
  diet?: string
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
  const partyId = body?.partyId?.trim()
  const realName = body?.realName?.trim()
  if (!partyId) return err(400, 'missing partyId')
  if (!realName) return err(400, 'real name required')

  const party = await getParty(env.DB, partyId)
  if (!party) return err(404, 'party not found')

  const now = Date.now()
  await upsertIdentity(env.DB, {
    line_user_id: user.userId,
    real_name: realName,
    diet: body?.diet ?? null,
    party_id: partyId,
    role: 'member',
    display_name: user.displayName,
    avatar_url: user.picture ?? null,
    source: 'join',
  }, now)

  // D1 write above is the source of truth; the Sheet mirror is best-effort
  // visibility for the couple and never blocks/fails the request — same
  // treatment as the leader's identity mirror in /api/rsvp.
  await mirrorToSheet(env.RSVP_WEBHOOK_URL, 'identity', {
    line_user_id: user.userId,
    real_name: realName,
    diet: body?.diet ?? null,
    party_id: partyId,
    role: 'member',
    display_name: user.displayName,
    source: 'join',
    updated_at: new Date(now).toISOString(),
  })

  const leader = await getIdentity(env.DB, party.leader_user_id)
  return ok({ leaderName: leader?.real_name ?? null })
}

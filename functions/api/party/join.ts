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

// Same magnitude as rsvp.ts's MAX_NAME_LEN — kept in sync by hand (functions/
// doesn't cross-import between its own files any more than it does src/).
const MAX_NAME_LEN = 40

// Mirrors src/lib/diet.ts's DIET_OPTIONS. functions/ doesn't cross-import
// from src/ (same convention as rsvp.ts's ALLOWED_DIET) — keep in sync by
// hand. Empty string is also accepted since diet is optional here.
const ALLOWED_DIET = new Set([
  '',
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
])

// Detail-merged forms produced by buildDietValue (src/lib/diet.ts), e.g.
// 食物過敏（花生）— see rsvp.ts's identical pattern for why this is a regex
// shape check rather than an exact-string set.
const DIET_DETAIL_PATTERN = /^(?:食物過敏|其他)（[^（）]{1,60}）$/

function isAllowedDiet(diet: string): boolean {
  return ALLOWED_DIET.has(diet) || DIET_DETAIL_PATTERN.test(diet)
}

// GET /api/party/join?code=X — preflight so the join form can tell "bad
// link" from "valid, here's who's leading it" before the guest fills
// anything in. Read-only, no auth: the leader's name is not sensitive and is
// already exposed via the mismatch notice below.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const code = new URL(request.url).searchParams.get('code')?.trim()
  if (!code) return err(400, 'missing code')

  const party = await getParty(env.DB, code)
  if (!party) return err(404, 'party not found')

  const leader = await getIdentity(env.DB, party.leader_user_id)
  return ok({ leaderName: leader?.real_name ?? null })
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
  if (realName.length > MAX_NAME_LEN) return err(400, `real name too long (max ${MAX_NAME_LEN})`)
  if (!isAllowedDiet(body?.diet ?? '')) return err(400, 'invalid diet')

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

  // mergeIdentity only fills a previously-null party_id — a caller who
  // already belongs to a DIFFERENT party keeps that original party_id, so
  // the party they actually ended up in can differ from the one they just
  // tapped a link for. Re-read after the write and resolve the leader from
  // whichever party_id the caller actually landed on, so leaderName never
  // misreports which party they're really in. `mismatch` tells the client
  // that distinction directly, so it can show the "already in a different
  // party" notice instead of a generic success message.
  const canonical = await getIdentity(env.DB, user.userId)
  const resolvedPartyId = canonical?.party_id ?? partyId
  const mismatch = resolvedPartyId !== partyId
  const resolvedParty = mismatch ? await getParty(env.DB, resolvedPartyId) : party
  const leader = resolvedParty ? await getIdentity(env.DB, resolvedParty.leader_user_id) : null
  return ok({ leaderName: leader?.real_name ?? null, mismatch })
}

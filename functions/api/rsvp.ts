// Cloudflare Pages Function: POST /api/rsvp
// Receives RSVP submissions from LIFF and the fallback form. LIFF
// submissions ("source: liff") additionally verify the caller's LINE
// identity, create/update their party (團) in D1, and write their own
// guest_identity row as the party's leader — then return a share link
// (joinUrl) so the leader can bring the rest of their party in without
// re-typing everyone's answers. Fallback submissions (no LINE identity to
// verify) keep their original behavior: no party/identity write, straight
// passthrough. Both paths still forward to Apps Script so the Sheet stays
// the mirror of record until Task 5 updates its column mapping.
//
// Why Apps Script and not Google Sheets API directly?
//   - The Sheet is the source of truth (see skill's references/context.md)
//     and Apps Script runs as the Sheet owner, so it can append without any
//     service-account JWT signing inside the Worker.
//   - The "secret" reduces to one URL (RSVP_WEBHOOK_URL) instead of a
//     long-lived private key — much easier to rotate.
//   - The Apps Script side also handles emailing both maintainers.

import { err, ok } from '../_lib/http'
import { LiffAuthError, verifyLineIdToken, type VerifiedLineUser } from '../_lib/liff-verify'
import { createParty, generatePartyCode, getIdentity, mirrorToSheet, upsertIdentity } from '../_lib/identity'

interface Env {
  DB: D1Database
  RSVP_WEBHOOK_URL: string
  LINE_LOGIN_CHANNEL_ID?: string
  LINE_LIFF_ID_JOIN?: string
}

interface RsvpBody {
  source: 'liff' | 'fallback'
  realName: string          // 團長真實姓名
  side: string
  relationship: string
  attending: string
  adultCount: number        // 含本人，≥1
  childCount: number        // ≥0
  childSeatCount: number    // 0..childCount
  leaderDiet: string        // 團長本人飲食
  notes: string
  message: string
}

const ALLOWED = new Set(['男方', '女方', '家長', '親戚', '朋友', '出席', '不克出席'])

// Diet is a fixed dropdown on the form. Empty string is also accepted so
// fallback/older submissions don't 400. Anything outside this set is rejected.
const ALLOWED_DIET = new Set([
  '',
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
])

function isValid(b: Partial<RsvpBody>): b is RsvpBody {
  if (!b || typeof b !== 'object') return false
  if (b.source !== 'liff' && b.source !== 'fallback') return false
  if (!b.realName || typeof b.realName !== 'string') return false
  if (!b.realName.trim()) return false
  if (!ALLOWED.has(String(b.side))) return false
  if (!ALLOWED.has(String(b.relationship))) return false
  if (!ALLOWED.has(String(b.attending))) return false
  if (typeof b.adultCount !== 'number' || b.adultCount < 1 || b.adultCount > 50) return false
  if (typeof b.childCount !== 'number' || b.childCount < 0 || b.childCount > 50) return false
  if (typeof b.childSeatCount !== 'number' || b.childSeatCount < 0 || b.childSeatCount > b.childCount) return false
  // Unconditional (unlike the other free-text fields below): leaderDiet has a
  // fixed dropdown on every client, so anything outside ALLOWED_DIET —
  // including "missing entirely" — is rejected rather than silently passed
  // through, same treatment as side/relationship/attending.
  if (!ALLOWED_DIET.has(String(b.leaderDiet ?? ''))) return false
  if (b.notes !== undefined && typeof b.notes !== 'string') return false
  if (b.message !== undefined && typeof b.message !== 'string') return false
  return true
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.RSVP_WEBHOOK_URL) {
    return err(500, 'server not configured (RSVP_WEBHOOK_URL)')
  }

  let body: Partial<RsvpBody>
  try { body = await request.json() } catch { return err(400, 'invalid json') }
  if (!isValid(body)) return err(400, 'invalid payload')

  let leader: { partyId: string; joinUrl: string } | undefined
  let lineUserId: string | undefined

  if (body.source === 'liff') {
    let user: VerifiedLineUser
    try {
      user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
    } catch (e) {
      if (e instanceof LiffAuthError) return err(e.status, e.message)
      throw e
    }
    if (!env.LINE_LIFF_ID_JOIN) return err(500, 'server not configured (LINE_LIFF_ID_JOIN)')
    lineUserId = user.userId

    // Server-side guard for the leader-only invariant: a party MEMBER must
    // never be promoted to leader by (re)submitting this form. The RSVP
    // page's client already hides the leader form for members (dedup view),
    // but that's UI-only — enforce it here too so a replayed/forged request
    // can't mint a second party for someone who already joined one. Leaders
    // re-submitting (existing?.role === 'leader') and solo/unidentified
    // callers (existing is null) both fall through unchanged.
    const existing = await getIdentity(env.DB, user.userId)
    if (existing?.role === 'member') return err(409, 'already_member')

    leader = await upsertLeaderParty(env.DB, user, body, env.LINE_LIFF_ID_JOIN, env.RSVP_WEBHOOK_URL)
  }

  // Forward to Apps Script. Apps Script's doPost reads e.postData.contents,
  // so we send the JSON body straight through with content-type text/plain
  // to avoid an extra CORS preflight on the Apps Script side. lineUserId is
  // included (camelCase — matches what the .gs's handleRsvp_ reads via
  // body.lineUserId) for the LIFF path only, so its UPSERT-by-line_user_id
  // updates the guest's existing RSVP_Responses row instead of always
  // appending a duplicate. Omitted (undefined, dropped by JSON.stringify)
  // for the fallback path, which keeps appending as before.
  const upstream = await fetch(env.RSVP_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      ...body,
      lineUserId,
      partyId: leader?.partyId ?? null,
      submittedAt: new Date().toISOString(),
    }),
  })

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    return err(502, 'upstream failed', { detail: text.slice(0, 200) })
  }

  return leader ? ok(leader) : ok({})
}

// Creates/updates the caller's party (團) and writes their own guest_identity
// row as leader. Re-submitting is treated as an update: if this LINE user
// already leads a party, its code is reused instead of minting a new one.
async function upsertLeaderParty(
  db: D1Database,
  user: VerifiedLineUser,
  body: RsvpBody,
  joinLiffId: string,
  webhookUrl: string,
): Promise<{ partyId: string; joinUrl: string }> {
  const now = Date.now()
  const existing = await getIdentity(db, user.userId)
  const code = existing?.role === 'leader' && existing.party_id
    ? existing.party_id
    : generatePartyCode()

  const partyRow = {
    party_id: code,
    leader_user_id: user.userId,
    side: body.side,
    relationship: body.relationship,
    attending: body.attending,
    adult_count: body.adultCount,
    child_count: body.childCount,
    child_seat_count: body.childSeatCount,
    notes: body.notes?.trim() ? body.notes : null,
    message: body.message?.trim() ? body.message : null,
  }
  await createParty(db, partyRow, now)

  const identityRow = {
    line_user_id: user.userId,
    real_name: body.realName.trim(),
    diet: body.leaderDiet,
    party_id: code,
    role: 'leader' as const,
    display_name: user.displayName,
    avatar_url: user.picture ?? null,
    source: 'rsvp' as const,
  }
  await upsertIdentity(db, identityRow, now)

  // D1 writes above are the source of truth; the Sheet mirrors below are
  // best-effort visibility for the couple and never block/fail the request.
  // The two mirrors are independent of each other, so run them concurrently
  // instead of paying their latency twice.
  await Promise.all([
    mirrorToSheet(webhookUrl, 'party', { ...partyRow, updated_at: new Date(now).toISOString() }),
    mirrorToSheet(webhookUrl, 'identity', {
      line_user_id: identityRow.line_user_id,
      real_name: identityRow.real_name,
      diet: identityRow.diet,
      party_id: identityRow.party_id,
      role: identityRow.role,
      display_name: identityRow.display_name,
      source: identityRow.source,
      updated_at: new Date(now).toISOString(),
    }),
  ])

  // Re-read after the write so the returned joinUrl always points at
  // whichever party this identity currently belongs to in D1 — keeps it
  // self-consistent with GET /api/identity/me even if a concurrent submit
  // from the same LINE user (e.g. a client retry after a timeout) raced this
  // one and its write landed afterward. Doesn't eliminate the (very unlikely,
  // 147-guest scale) chance of a stray orphaned party row under true
  // concurrency, but does guarantee the link shown to the user always
  // matches what their identity currently resolves to.
  const canonical = await getIdentity(db, user.userId)
  const partyId = canonical?.party_id ?? code
  return { partyId, joinUrl: `https://liff.line.me/${joinLiffId}?party=${partyId}` }
}

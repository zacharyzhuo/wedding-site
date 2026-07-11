import { err, ok } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { getIdentity, getParty } from '../../_lib/identity'

interface Env { DB: D1Database; LINE_LOGIN_CHANNEL_ID?: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try { user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID) }
  catch (e) { if (e instanceof LiffAuthError) return err(e.status, e.message); throw e }

  const id = await getIdentity(env.DB, user.userId)
  if (!id) return ok({ identified: false, realName: null, diet: null, role: null, party: null })

  let party = null
  if (id.party_id) {
    const p = await getParty(env.DB, id.party_id)
    if (p) {
      const leader = await getIdentity(env.DB, p.leader_user_id)
      party = { partyId: p.party_id, leaderName: leader?.real_name ?? null } as Record<string, unknown>
      // For the leader of this party, surface the full record (to pre-fill an
      // edit of their RSVP) plus how many of the expected adults have their
      // own identity yet (leader + members who joined) — the "3 / 4" progress.
      if (id.role === 'leader') {
        const countRow = await env.DB
          .prepare(`SELECT COUNT(*) AS n FROM guest_identity WHERE party_id = ?`)
          .bind(p.party_id)
          .first<{ n: number }>()
        party = {
          ...party,
          side: p.side,
          relationship: p.relationship,
          attending: p.attending,
          adultCount: p.adult_count,
          childCount: p.child_count,
          childSeatCount: p.child_seat_count,
          notes: p.notes,
          message: p.message,
          identifiedCount: countRow?.n ?? 0,
        }
      }
    }
  }
  return ok({ identified: true, realName: id.real_name, diet: id.diet, role: id.role, party })
}

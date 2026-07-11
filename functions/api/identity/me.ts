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
      party = { partyId: p.party_id, leaderName: leader?.real_name ?? null }
    }
  }
  return ok({ identified: true, realName: id.real_name, diet: id.diet, role: id.role, party })
}

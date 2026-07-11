export type Role = 'leader' | 'member' | 'solo'
export type Source = 'rsvp' | 'join' | 'raffle' | 'manual'

export interface IdentityRow {
  line_user_id: string
  real_name: string
  diet: string | null
  party_id: string | null
  role: Role
  display_name: string | null
  avatar_url: string | null
  source: Source
  created_at: number
  updated_at: number
}

export interface PartyRow {
  party_id: string
  leader_user_id: string
  side: string
  relationship: string
  attending: string
  adult_count: number
  child_count: number
  child_seat_count: number
  notes: string | null
  message: string | null
  created_at: number
  updated_at: number
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (no I L O U)

export function generatePartyCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % 32]
  return out
}

export type IncomingIdentity = Partial<IdentityRow> & {
  line_user_id: string
  real_name: string
  role: Role
  source: Source
}

export function mergeIdentity(
  existing: IdentityRow | null,
  incoming: IncomingIdentity,
  now: number,
): IdentityRow {
  if (!existing) {
    return {
      line_user_id: incoming.line_user_id,
      real_name: incoming.real_name,
      diet: incoming.diet ?? null,
      party_id: incoming.party_id ?? null,
      role: incoming.role,
      display_name: incoming.display_name ?? null,
      avatar_url: incoming.avatar_url ?? null,
      source: incoming.source,
      created_at: now,
      updated_at: now,
    }
  }
  return {
    ...existing,
    // never silently overwrite a non-empty real_name
    real_name: existing.real_name?.trim() ? existing.real_name : incoming.real_name,
    // diet: update if incoming provides one, else keep
    diet: incoming.diet != null && incoming.diet !== '' ? incoming.diet : existing.diet,
    // join only fills a previously-null party_id
    party_id: existing.party_id ?? incoming.party_id ?? null,
    // refresh LINE snapshots when provided
    display_name: incoming.display_name ?? existing.display_name,
    avatar_url: incoming.avatar_url ?? existing.avatar_url,
    // role: never demote a leader; otherwise adopt incoming.role so a solo who
    // later joins a party becomes a member. source is left as existing (via
    // spread) because real_name is not overwritten, so provenance stays with
    // the name's first source.
    role: existing.role === 'leader' ? 'leader' : incoming.role,
    updated_at: now,
  }
}

export async function getIdentity(db: D1Database, userId: string): Promise<IdentityRow | null> {
  return db.prepare(`SELECT * FROM guest_identity WHERE line_user_id = ?`).bind(userId).first<IdentityRow>()
}

export async function upsertIdentity(db: D1Database, incoming: IncomingIdentity, now: number): Promise<IdentityRow> {
  const existing = await getIdentity(db, incoming.line_user_id)
  const row = mergeIdentity(existing, incoming, now)
  await db.prepare(
    `INSERT INTO guest_identity
       (line_user_id, real_name, diet, party_id, role, display_name, avatar_url, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_user_id) DO UPDATE SET
       real_name=excluded.real_name, diet=excluded.diet, party_id=excluded.party_id,
       role=excluded.role, display_name=excluded.display_name, avatar_url=excluded.avatar_url,
       updated_at=excluded.updated_at`
  ).bind(row.line_user_id, row.real_name, row.diet, row.party_id, row.role,
         row.display_name, row.avatar_url, row.source, row.created_at, row.updated_at).run()
  return row
}

export async function getParty(db: D1Database, partyId: string): Promise<PartyRow | null> {
  return db.prepare(`SELECT * FROM party WHERE party_id = ?`).bind(partyId).first<PartyRow>()
}

export async function createParty(
  db: D1Database,
  p: Omit<PartyRow, 'created_at' | 'updated_at'>,
  now: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO party
       (party_id, leader_user_id, side, relationship, attending, adult_count, child_count, child_seat_count, notes, message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(party_id) DO UPDATE SET
       side=excluded.side, relationship=excluded.relationship, attending=excluded.attending,
       adult_count=excluded.adult_count, child_count=excluded.child_count,
       child_seat_count=excluded.child_seat_count, notes=excluded.notes, message=excluded.message,
       updated_at=excluded.updated_at`
  ).bind(p.party_id, p.leader_user_id, p.side, p.relationship, p.attending,
         p.adult_count, p.child_count, p.child_seat_count, p.notes, p.message, now, now).run()
}

// Fire-and-forget-ish mirror of a D1 identity/party row into the Sheet.
// Non-fatal: a mirror failure must never break the guest's request. D1 is the
// operational source of truth; the Sheet is a read-only visibility copy for
// the couple.
export async function mirrorToSheet(
  webhookUrl: string | undefined,
  kind: 'identity' | 'party',
  row: Record<string, unknown>,
): Promise<void> {
  if (!webhookUrl) return
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind, ...row }),
    })
  } catch {
    /* mirror is best-effort; D1 is the source of truth */
  }
}

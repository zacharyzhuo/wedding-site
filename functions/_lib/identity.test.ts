import { describe, it, expect } from 'vitest'
import { generatePartyCode, mergeIdentity, type IdentityRow } from './identity'

describe('generatePartyCode', () => {
  it('回傳 8 碼、只含 Crockford base32 字元', () => {
    const c = generatePartyCode()
    expect(c).toHaveLength(8)
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
  })
  it('連續產生不重複(機率上)', () => {
    const s = new Set(Array.from({ length: 200 }, () => generatePartyCode()))
    expect(s.size).toBe(200)
  })
})

describe('mergeIdentity', () => {
  const base = { line_user_id: 'U1', real_name: '王小明', role: 'leader' as const, source: 'rsvp' as const }
  it('無 existing → 建立新列', () => {
    const r = mergeIdentity(null, { ...base, diet: '全素', party_id: 'P1' }, 100)
    expect(r).toMatchObject({ line_user_id: 'U1', real_name: '王小明', diet: '全素', party_id: 'P1', role: 'leader', source: 'rsvp', created_at: 100, updated_at: 100 })
  })
  it('有 existing → 不覆蓋非空 real_name', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: null, party_id: null, role: 'member', display_name: null, avatar_url: null, source: 'join', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '亂改的名字', role: 'member', source: 'join' }, 200)
    expect(r.real_name).toBe('王小明')
    expect(r.updated_at).toBe(200)
  })
  it('join 只補原本為 null 的 party_id', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: null, party_id: null, role: 'member', display_name: null, avatar_url: null, source: 'join', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join', party_id: 'P9' }, 200)
    expect(r.party_id).toBe('P9')
    const r2 = mergeIdentity({ ...existing, party_id: 'PEXIST' }, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join', party_id: 'P9' }, 200)
    expect(r2.party_id).toBe('PEXIST')
  })
  it('diet 有值就更新,沒值就保留', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: '蛋奶素', party_id: 'P1', role: 'member', display_name: null, avatar_url: null, source: 'join', created_at: 50, updated_at: 50 }
    expect(mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join' }, 200).diet).toBe('蛋奶素')
    expect(mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join', diet: '全素' }, 200).diet).toBe('全素')
  })
  it('diet 傳空字串 → 保留原值', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: '蛋奶素', party_id: 'P1', role: 'member', display_name: null, avatar_url: null, source: 'join', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join', diet: '' }, 200)
    expect(r.diet).toBe('蛋奶素')
  })
  it('solo 加入 party 後 role 變成 member', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: null, party_id: null, role: 'solo', display_name: null, avatar_url: null, source: 'rsvp', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join', party_id: 'P9' }, 200)
    expect(r.role).toBe('member')
    expect(r.party_id).toBe('P9')
  })
  it('leader 不會被降級', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: null, party_id: 'P1', role: 'leader', display_name: null, avatar_url: null, source: 'rsvp', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join' }, 200)
    expect(r.role).toBe('leader')
  })
  it('display_name/avatar_url:incoming 有值就更新', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: null, party_id: null, role: 'member', display_name: null, avatar_url: null, source: 'join', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join', display_name: '新暱稱', avatar_url: 'http://a/x.jpg' }, 200)
    expect(r.display_name).toBe('新暱稱')
    expect(r.avatar_url).toBe('http://a/x.jpg')
  })
  it('display_name/avatar_url:incoming 沒給就保留原值', () => {
    const existing: IdentityRow = { line_user_id: 'U1', real_name: '王小明', diet: null, party_id: null, role: 'member', display_name: '舊', avatar_url: 'http://old', source: 'join', created_at: 50, updated_at: 50 }
    const r = mergeIdentity(existing, { line_user_id: 'U1', real_name: '王小明', role: 'member', source: 'join' }, 200)
    expect(r.display_name).toBe('舊')
    expect(r.avatar_url).toBe('http://old')
  })
})

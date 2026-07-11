import { describe, it, expect, vi, afterEach } from 'vitest'
import { generatePartyCode, mergeIdentity, mirrorToSheet, type IdentityRow } from './identity'

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

describe('mirrorToSheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('webhookUrl 為 falsy → 不呼叫 fetch,直接 resolve', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(mirrorToSheet(undefined, 'identity', { line_user_id: 'U1' })).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch reject → 仍然 resolve,不拋出(mirror 失敗不影響主流程)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      mirrorToSheet('https://example.com/webhook', 'party', { party_id: 'P1' }),
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('正常呼叫 → fetch 被呼叫一次,body 為含 kind 與 row 欄位的 JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const row = { line_user_id: 'U1', real_name: '王小明', party_id: 'P1' }

    await mirrorToSheet('https://example.com/webhook', 'identity', row)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/webhook')
    expect(init.method).toBe('POST')
    const parsedBody = JSON.parse(init.body)
    expect(parsedBody).toMatchObject({ kind: 'identity', ...row })
  })
})

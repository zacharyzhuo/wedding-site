# 團 + 賓客身分 地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立中央的「團 + 賓客身分」資料層與四個填寫入口,讓 `line_user_id ↔ 真實姓名 ↔ 團` 可靠對應,供下游悄悄話/座位/去重 RSVP 共用。

**Architecture:** 兩張 D1 表(`party`、`guest_identity`)+ 一個 `functions/_lib/identity.ts` helper(純決策函式可單測,D1 讀寫薄封裝)。四個入口:RSVP LIFF(團長建團 + 本人身分)、`/liff/join`(團員入團)、抽獎 LIFF(fallback 識別)、admin(手動)。D1 兩表鏡像到 Google Sheet 分頁。

**Tech Stack:** Next.js 15 static export + React 19 + TypeScript、Cloudflare Pages Functions(Workers runtime)+ D1、`@line/liff`、Apps Script(Sheet)、vitest(純函式單測)。

## Global Constraints

- Node 版本鎖 `20.20.2`(`.nvmrc`);Node 22 會壞 `next build`。
- 所有寫入 `guest_identity` 的 endpoint **必須先 `verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)` 驗證 idToken**,取 `userId / displayName / picture`,禁止信任 request body 的 userId。
- `party_id` = **8 碼 base32(Crockford,去掉易混字)、不過期**。
- **已存在的 `real_name` 不靜默覆蓋**;`join` 只補原本為 null 的 `party_id`;`diet` 可由本人更新。
- **兒童不建 `guest_identity`**,只計入 `party.child_count / child_seat_count / notes`。
- Guest-facing 文案一律繁體中文。
- Secrets 不進 repo;server 值走 Cloudflare Pages env。
- D1 binding 名為 `DB`;migrations 放 `migrations/`,下一個編號 `0005`。
- Pages Functions 本地測試用 `npm run pages:dev`(`functions/api/*` 在 `next dev` 下會 404)。

---

### Task 1: D1 migration — `party` + `guest_identity`

**Files:**
- Create: `migrations/0005_party_identity.sql`

**Interfaces:**
- Produces: 表 `party(party_id PK, leader_user_id, side, relationship, attending, adult_count, child_count, child_seat_count, notes, created_at, updated_at)`;表 `guest_identity(line_user_id PK, real_name, diet, party_id, role, display_name, avatar_url, source, created_at, updated_at)`。

- [ ] **Step 1: 寫 migration**

```sql
-- migrations/0005_party_identity.sql
-- Party (團) = one RSVP-leader's group. guest_identity = per-adult identity
-- keyed by LINE userId. Children are counts on party only (no identity row).
CREATE TABLE party (
  party_id         TEXT PRIMARY KEY,      -- 8-char Crockford base32, non-expiring
  leader_user_id   TEXT NOT NULL,
  side             TEXT NOT NULL,          -- 男方 | 女方
  relationship     TEXT NOT NULL,          -- 家長 | 親戚 | 朋友
  attending        TEXT NOT NULL,          -- 出席 | 不克出席
  adult_count      INTEGER NOT NULL DEFAULT 1,
  child_count      INTEGER NOT NULL DEFAULT 0,
  child_seat_count INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_party_leader ON party(leader_user_id);

CREATE TABLE guest_identity (
  line_user_id  TEXT PRIMARY KEY,
  real_name     TEXT NOT NULL,
  diet          TEXT,
  party_id      TEXT,                      -- nullable; solo guests have none
  role          TEXT NOT NULL,             -- leader | member | solo
  display_name  TEXT,                      -- LINE displayName snapshot
  avatar_url    TEXT,
  source        TEXT NOT NULL,             -- rsvp | join | raffle | manual
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_identity_party ON guest_identity(party_id);
```

- [ ] **Step 2: 本地套用並驗證 schema**

Run:
```bash
npx wrangler d1 migrations apply wedding-live   # local (no --remote)
npx wrangler d1 execute wedding-live --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('party','guest_identity');"
```
Expected: 兩個表名都列出。

- [ ] **Step 3: Commit**

```bash
git add migrations/0005_party_identity.sql
git commit -m "feat: D1 tables for party + guest identity"
```

> 注意:remote D1 套用(`--remote`)在整套本地驗證通過後、部署前再做,不在本 task。

---

### Task 2: Identity helper（純決策函式 + D1 封裝）

**Files:**
- Create: `functions/_lib/identity.ts`
- Create: `functions/_lib/identity.test.ts`
- Modify: `package.json`(加 `vitest` devDep + `test` script)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces:
  - `generatePartyCode(): string` — 8-char Crockford base32。
  - `type IdentityRow = { line_user_id: string; real_name: string; diet: string | null; party_id: string | null; role: 'leader'|'member'|'solo'; display_name: string | null; avatar_url: string | null; source: 'rsvp'|'join'|'raffle'|'manual'; created_at: number; updated_at: number }`
  - `mergeIdentity(existing: IdentityRow | null, incoming: Partial<IdentityRow> & { line_user_id: string; real_name: string; role: IdentityRow['role']; source: IdentityRow['source'] }, now: number): IdentityRow` — 純函式:無 existing → 用 incoming;有 existing → **不覆蓋非空 real_name**、只補空的 `party_id`、`diet` 用 incoming 若有值否則保留、更新 display_name/avatar 快照。
  - `async upsertIdentity(db: D1Database, incoming, now): Promise<IdentityRow>` — 讀現有 → `mergeIdentity` → 寫回。
  - `async getIdentity(db: D1Database, userId: string): Promise<IdentityRow | null>`
  - `async createParty(db, p: { party_id; leader_user_id; side; relationship; attending; adult_count; child_count; child_seat_count; notes; }, now): Promise<void>` — UPSERT by party_id。
  - `async getParty(db, partyId: string): Promise<PartyRow | null>`

- [ ] **Step 1: 裝 vitest**

Run:
```bash
npm i -D vitest
```
在 `package.json` `scripts` 加:`"test": "vitest run"`。
建 `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['functions/**/*.test.ts'] } })
```

- [ ] **Step 2: 寫 failing test(純函式)**

```ts
// functions/_lib/identity.test.ts
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
})
```

- [ ] **Step 3: 跑測試確認 fail**

Run: `npm test`
Expected: FAIL(`identity.ts` 尚未匯出這些函式)。

- [ ] **Step 4: 實作 `identity.ts`**

```ts
// functions/_lib/identity.ts
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

type IncomingIdentity = Partial<IdentityRow> & {
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
       (party_id, leader_user_id, side, relationship, attending, adult_count, child_count, child_seat_count, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(party_id) DO UPDATE SET
       side=excluded.side, relationship=excluded.relationship, attending=excluded.attending,
       adult_count=excluded.adult_count, child_count=excluded.child_count,
       child_seat_count=excluded.child_seat_count, notes=excluded.notes, updated_at=excluded.updated_at`
  ).bind(p.party_id, p.leader_user_id, p.side, p.relationship, p.attending,
         p.adult_count, p.child_count, p.child_seat_count, p.notes, now, now).run()
}
```

- [ ] **Step 5: 跑測試確認 pass**

Run: `npm test`
Expected: PASS(全部綠)。

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/identity.ts functions/_lib/identity.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: identity + party helpers with pure merge logic (unit-tested)"
```

---

### Task 3: `GET /api/identity/me`（查 userId 是否已識別）

**Files:**
- Create: `functions/api/identity/me.ts`

**Interfaces:**
- Consumes: `verifyLineIdToken`(`../../_lib/liff-verify`)、`getIdentity`、`getParty`(`../../_lib/identity`)。
- Produces: `GET /api/identity/me` → `{ ok:true, identified:boolean, realName:string|null, diet: string|null, party: { partyId, leaderName } | null }`。抽獎 fallback、RSVP 去重都會呼叫它。

- [ ] **Step 1: 實作 endpoint**

```ts
// functions/api/identity/me.ts
import { err, ok } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { getIdentity, getParty } from '../../_lib/identity'

interface Env { DB: D1Database; LINE_LOGIN_CHANNEL_ID?: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try { user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID) }
  catch (e) { if (e instanceof LiffAuthError) return err(e.status, e.message); throw e }

  const id = await getIdentity(env.DB, user.userId)
  if (!id) return ok({ identified: false, realName: null, diet: null, party: null })

  let party = null
  if (id.party_id) {
    const p = await getParty(env.DB, id.party_id)
    if (p) {
      const leader = await getIdentity(env.DB, p.leader_user_id)
      party = { partyId: p.party_id, leaderName: leader?.real_name ?? null }
    }
  }
  return ok({ identified: true, realName: id.real_name, diet: id.diet, party })
}
```

- [ ] **Step 2: 本地驗證(fail-closed)**

Run:
```bash
npm run pages:dev   # 另一個 terminal;先 apply local migration (Task 1 Step 2)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/api/identity/me   # 無 idToken
```
Expected: `401`(缺 `x-line-id-token`)。

- [ ] **Step 3: Commit**

```bash
git add functions/api/identity/me.ts
git commit -m "feat: GET /api/identity/me — identity lookup by verified userId"
```

---

### Task 4: RSVP 團長改動（表單欄位 + 建團 + 分享連結 + 去重）

**Files:**
- Modify: `src/app/liff/rsvp/page.tsx`（表單欄位改欄位模型 §4.5、送出後顯示分享連結、去重視圖）
- Modify: `functions/api/rsvp.ts`（驗 idToken、建 party、寫 leader identity、回 partyId;仍轉發 Sheet)

**Interfaces:**
- Consumes: `verifyLineIdToken`、`createParty`、`upsertIdentity`、`generatePartyCode`、`getIdentity`。
- Produces: `POST /api/rsvp`(source=liff)回 `{ ok:true, partyId:string, joinUrl:string }`;RSVP 頁送出成功顯示 joinUrl + QR。`NEXT_PUBLIC_LIFF_ID_JOIN` 環境變數(join LIFF id,Task 6 建立後填 `.env.local` 與 dashboard)。

- [ ] **Step 1: 改 `/api/rsvp.ts` 的 body 型別與驗證**

把 `RsvpBody` 改為新欄位模型並驗 idToken;`ALLOWED` 沿用。新型別:
```ts
interface RsvpBody {
  source: 'liff' | 'fallback'
  realName: string           // 團長真實姓名(取代 displayName)
  side: string; relationship: string; attending: string
  adultCount: number; childCount: number; childSeatCount: number
  leaderDiet: string         // 團長本人飲食
  notes: string
  message: string
}
```
驗證加:`realName` 非空;`adultCount 1..50`;`childCount 0..50`;`childSeatCount 0..childCount`;`leaderDiet ∈ ALLOWED_DIET`。

- [ ] **Step 2: 建團 + 寫 leader identity + 轉發 Sheet**

在 `onRequestPost`(source==='liff' 時):驗 idToken 取 `user`;若該 user 已是某團 leader → 取回既有 `party_id`(重填視為更新),否則 `generatePartyCode()`;`createParty(...)`;`upsertIdentity({ line_user_id:user.userId, real_name:realName, diet:leaderDiet, party_id:code, role:'leader', display_name:user.displayName, avatar_url:user.picture, source:'rsvp' }, Date.now())`;照舊 forward 到 `RSVP_WEBHOOK_URL`(body 帶新欄位 + `partyId`);回 `ok({ partyId: code, joinUrl: 'https://liff.line.me/' + <join liff id from env> + '?party=' + code })`。
> join LIFF id 由 server env `LINE_LIFF_ID_JOIN` 提供(避免硬編);Task 6 建立 LIFF 後設定。

- [ ] **Step 3: 改 RSVP LIFF 表單欄位（§4.5 團層級 + 團長本人）**

`src/app/liff/rsvp/page.tsx`:`FormState` 改為 `{ realName, side, relationship, attending, adultCount, childCount, childSeatCount, leaderDiet, notes, message }`。沿用現有 `Field/Select` 元件(pattern 同現檔)。新增輸入:
- 「你的真實姓名」text(必填)
- 「大人人數(含本人)」number min1
- 「兒童人數」number min0;「其中需要兒童椅」number min0 max=childCount
- 「你的飲食需求」`DIET_OPTIONS` select(沿用)
- 「備註(代填不用 LINE 的人 / 兒童特殊需求)」textarea
- 送出改帶 `source:'liff', lineUserId, realName, ...`(header 帶 `x-line-id-token`,用 `getLiffIdToken()`,pattern 同 `liff/raffle/page.tsx`)。

- [ ] **Step 4: 送出成功顯示分享連結 + QR + 去重**

送出成功後 `done` 畫面顯示:「把這個連結傳給同行的人,他們加入就完成登記」+ 可複製 `joinUrl` + QR(QR 用純前端產生,見下)+ `liff.shareTargetPicker()` 按鈕。
QR:用輕量 inline 產生器(避免外部圖片,CSP 友善)。加 `src/lib/qr.ts` 產生 SVG data(或用 `qrcode` npm 產 SVG 字串);渲染成 `<img>` 或 inline SVG。
去重:頁面載入後先 `GET /api/identity/me`,若 `identified && party && party.leaderName` 且該 user 非 leader → 顯示「你是〔leaderName〕那一團,團長已回覆」+ 只給「補自己的飲食」小表單(POST 到 Task 7 的 diet 更新或 `/api/party/member-diet`,見 Task 6 Step 3)。

- [ ] **Step 5: 本地 build + 手機 smoke**

Run: `npm run build`(型別檢查)→ 綠。
手機 smoke(部署後):團長填 RSVP → 拿到 joinUrl + QR;D1 驗證 `SELECT * FROM party; SELECT * FROM guest_identity WHERE role='leader';`。

- [ ] **Step 6: Commit**

```bash
git add src/app/liff/rsvp/page.tsx functions/api/rsvp.ts src/lib/qr.ts
git commit -m "feat: RSVP leader creates party + identity + share link (new field model)"
```

---

### Task 5: apps-script + Sheet 欄位擴充 + 身分鏡像

**Files:**
- Modify: `apps-script/rsvp-webhook.gs`（RSVP_Responses 新欄位 + Guest_Identity/Parties 鏡像 doPost 分支）

**Interfaces:**
- Consumes: `/api/rsvp` 轉發的新欄位;未來 identity/party 寫入時可另 POST 一個 `{ kind:'identity'|'party', ... }` 到同一 webhook 做鏡像。
- Produces: Sheet 分頁 `RSVP_Responses`(擴欄)、`Parties`、`Guest_Identity`。

- [ ] **Step 1: RSVP_Responses 欄位擴充**

`HEADERS` 增為:`timestamp, source, line_user_id, party_id, real_name, side, relationship, attending, adult_count, child_count, child_seat_count, leader_diet, notes, message`。`doPost` 對應寫入(舊 `name/headcount/diet` 欄位對映到 `real_name/adult_count/leader_diet`,保持 UPSERT by line_user_id 的既有邏輯)。

- [ ] **Step 2: identity/party 鏡像分支**

`doPost` 依 `body.kind` 分派:`kind==='identity'` → UPSERT to `Guest_Identity` 分頁(欄:line_user_id, real_name, diet, party_id, role, display_name, source, updated_at);`kind==='party'` → UPSERT to `Parties`。預設(無 kind)= RSVP 行為。
> 觸發鏡像:`functions/_lib/identity.ts` 的 `upsertIdentity/createParty` 成功後,fire-and-forget POST 到 `RSVP_WEBHOOK_URL`(帶 `kind`)。此步在 Task 4/6/7/8 各寫入點加一行呼叫;為避免重複,抽成 `mirrorToSheet(env, kind, row)` helper 放 `identity.ts`,寫入後呼叫(失敗只 console.error,不阻斷)。

- [ ] **Step 3: 部署 apps-script + 驗證**

在 Sheet 的 Apps Script 編輯器貼上、部署新版 web app（沿用同一 deployment URL）。驗證:手動 `curl -X POST $RSVP_WEBHOOK_URL -d '{"kind":"identity","line_user_id":"UTEST","real_name":"測試"}'` → Guest_Identity 分頁出現該列。清掉測試列。

- [ ] **Step 4: Commit**

```bash
git add apps-script/rsvp-webhook.gs functions/_lib/identity.ts
git commit -m "feat: extend RSVP sheet columns + mirror identity/party to Sheet tabs"
```

---

### Task 6: 入團連結 LIFF `/liff/join` + `POST /api/party/join`

**Files:**
- Create: `src/app/liff/join/page.tsx`
- Create: `functions/api/party/join.ts`
- Create(LINE 端): 新 LIFF app `join`,endpoint `https://wedding.zacharyzhuo.com/liff/join`,size Full,add-friend aggressive → 取得 LIFF id → 設 `NEXT_PUBLIC_LIFF_ID_JOIN`(client)+ `LINE_LIFF_ID_JOIN`(server,給 Task 4 組 joinUrl)。

**Interfaces:**
- Consumes: `useLiffProfile(NEXT_PUBLIC_LIFF_ID_JOIN)`、`getLiffIdToken`;server 端 `verifyLineIdToken`、`getParty`、`upsertIdentity`。
- Produces: `POST /api/party/join` body `{ partyId, realName, diet }` → 驗 idToken → 檢查 party 存在 → `upsertIdentity(role:'member', party_id, source:'join', ...)` → `{ ok:true, leaderName }`。

- [ ] **Step 1: 實作 `POST /api/party/join`**

```ts
// functions/api/party/join.ts
import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { getParty, getIdentity, upsertIdentity } from '../../_lib/identity'

interface Env { DB: D1Database; LINE_LOGIN_CHANNEL_ID?: string; RSVP_WEBHOOK_URL?: string }
interface Body { partyId?: string; realName?: string; diet?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try { user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID) }
  catch (e) { if (e instanceof LiffAuthError) return err(e.status, e.message); throw e }

  const body = await readJson<Body>(request)
  const partyId = body?.partyId?.trim()
  const realName = body?.realName?.trim()
  if (!partyId) return err(400, 'missing partyId')
  if (!realName) return err(400, 'real name required')

  const party = await getParty(env.DB, partyId)
  if (!party) return err(404, 'party not found')

  await upsertIdentity(env.DB, {
    line_user_id: user.userId, real_name: realName, diet: body?.diet ?? null,
    party_id: partyId, role: 'member', display_name: user.displayName,
    avatar_url: user.picture ?? null, source: 'join',
  }, Date.now())

  const leader = await getIdentity(env.DB, party.leader_user_id)
  return ok({ leaderName: leader?.real_name ?? null })
}
```

- [ ] **Step 2: 實作 `/liff/join` 頁**

`src/app/liff/join/page.tsx`(pattern 同 `liff/raffle/page.tsx`):
- 讀 URL `?party=<code>`(useEffect 取 `window.location`,同 `screen/page.tsx` 取 token 方式)。
- `useLiffProfile(process.env.NEXT_PUBLIC_LIFF_ID_JOIN)`。
- 先 `GET /api/identity/me`:若已 `identified` 且同一 party → 顯示「你已加入〔leaderName〕那一團」;否則顯示表單。
- 表單:真實姓名(必填)+ 飲食需求 select(`DIET_OPTIONS`,可從共用常數 import,見下)+ 送出。
- 送出:`POST /api/party/join`(header `x-line-id-token`)→ 成功顯示「加入〔leaderName〕那一團完成 ❤」。
- party 不存在 → 顯示友善錯誤 + OA 加好友引導。
> `DIET_OPTIONS` 目前定義在 `rsvp/page.tsx`;抽到 `src/lib/diet.ts` 匯出,RSVP 與 join 共用(DRY)。

- [ ] **Step 3(選配,支撐 Task 4 去重補飲食): `POST /api/party/member-diet`**

`functions/api/party/member-diet.ts`:驗 idToken → `upsertIdentity` 只更新自己的 `diet`(role/party 保持)。RSVP 去重視圖的「補飲食」小表單打這支。

- [ ] **Step 4: build + 手機 smoke**

Run: `npm run build` → 綠。
建 LIFF app(LINE)、填兩個 env、部署。手機:用團長的 joinUrl 進入 → 填姓名+飲食 → `SELECT * FROM guest_identity WHERE role='member';` 出現且 `party_id` 正確。

- [ ] **Step 5: Commit**

```bash
git add src/app/liff/join/page.tsx functions/api/party/join.ts functions/api/party/member-diet.ts src/lib/diet.ts
git commit -m "feat: party join LIFF + /api/party/join (member self-identify)"
```

---

### Task 7: 抽獎 LIFF fallback 識別

**Files:**
- Modify: `src/app/liff/raffle/page.tsx`（開啟先查 identity;未識別才要求真實姓名 + 飲食）
- Modify: `functions/api/raffle.ts`（POST 接受 `realName?`/`diet?`,未識別時寫 identity)

**Interfaces:**
- Consumes: `getIdentity`、`upsertIdentity`。
- Produces: `POST /api/raffle` body 可帶 `{ realName?, diet? }`;若該 user 尚無 identity 且未帶 realName → 回 `{ ok:false, error:'name_required' }`,前端據此顯示姓名欄。

- [ ] **Step 1: 改 `/api/raffle` POST**

在既有 `upsert raffle_entries` 之前:`const existing = await getIdentity(env.DB, user.userId)`;若 `!existing`:若無 `body.realName?.trim()` → `return err(400, 'name_required')`;否則 `upsertIdentity({ ..., real_name, diet, role:'solo', party_id:null, source:'raffle', display_name, avatar_url }, now)`。已有 identity → 照舊直接報名(可選:若帶 diet 則更新)。

- [ ] **Step 2: 改抽獎 LIFF**

`raffle/page.tsx`:載入時 `GET /api/identity/me`。`identified===false` → 報名按鈕前先顯示「真實姓名」必填 + 飲食 select;送出 `POST /api/raffle` 帶 `realName/diet`。`identified===true` → 維持現狀(直接報名,你要的「已知就跳過」)。處理 `error==='name_required'` 的回覆(理論上前端已擋)。

- [ ] **Step 3: build + 手機 smoke**

Run: `npm run build` → 綠。手機:用「沒填過 RSVP、沒入團」的帳號開抽獎 → 被要求填姓名 → 填完報名 → `guest_identity` 出現 `source='raffle', role='solo'`;已識別帳號開抽獎 → 不問姓名。

- [ ] **Step 4: Commit**

```bash
git add src/app/liff/raffle/page.tsx functions/api/raffle.ts
git commit -m "feat: raffle entry captures real name only for unidentified guests"
```

---

### Task 8: 後台手動識別 / 指派

**Files:**
- Modify: `src/app/liff/admin/page.tsx`（新 tab「身分」:列未命名 userId + 補姓名/指派團）
- Create: `functions/api/admin/identity/list.ts`（列出 raffle_entries 中無 guest_identity 或無 real_name 的 userId）
- Create: `functions/api/admin/identity/set.ts`（`{ userId, realName, partyId? }` → upsert source=manual）

**Interfaces:**
- Consumes: `requireAdmin`(`../../../_lib/admin`)、`upsertIdentity`、`getIdentity`。
- Produces: `GET /api/admin/identity/list` → `{ ok, unidentified: [{ userId, displayName, avatarUrl }] }`;`POST /api/admin/identity/set`。

- [ ] **Step 1: 實作 list endpoint**

```ts
// functions/api/admin/identity/list.ts
import { err, ok } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'
interface Env { DB: D1Database; LINE_LOGIN_CHANNEL_ID?: string; ADMIN_LINE_USER_IDS?: string }
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try { await requireAdmin(request, env) }
  catch (e) { if (e instanceof LiffAuthError) return err(e.status, e.message); throw e }
  const rows = await env.DB.prepare(
    `SELECT r.line_user_id AS userId, r.display_name AS displayName, r.avatar_url AS avatarUrl
     FROM raffle_entries r
     LEFT JOIN guest_identity g ON g.line_user_id = r.line_user_id
     WHERE g.line_user_id IS NULL OR g.real_name IS NULL OR g.real_name = ''
     ORDER BY r.created_at DESC`
  ).all<{ userId: string; displayName: string; avatarUrl: string | null }>()
  return ok({ unidentified: rows.results ?? [] })
}
```

- [ ] **Step 2: 實作 set endpoint**

`functions/api/admin/identity/set.ts`:`requireAdmin` → `readJson<{userId,realName,partyId?}>` → 驗 `realName` 非空 → `upsertIdentity({ line_user_id:userId, real_name:realName, party_id:partyId ?? null, role: partyId ? 'member':'solo', source:'manual' }, Date.now())` → `ok({})`。

- [ ] **Step 3: admin LIFF 加「身分」tab**

`admin/page.tsx`:tab 陣列加 `['identity','身分']`;新 section:載入 `GET /api/admin/identity/list`,列每個未命名者(顯示 avatar + displayName)+ 一個姓名輸入 + 可選 party 下拉 + 「儲存」→ `POST /api/admin/identity/set` → 該列移出清單。沿用現有 `authedFetch` pattern。

- [ ] **Step 4: build + 手機 smoke**

Run: `npm run build` → 綠。手機(admin 帳號):身分 tab 列出未命名的抽獎報名者 → 補姓名 → 該人 `guest_identity` 出現 `source='manual'`。

- [ ] **Step 5: Commit**

```bash
git add src/app/liff/admin/page.tsx functions/api/admin/identity/list.ts functions/api/admin/identity/set.ts
git commit -m "feat: admin manual identity — name/assign unidentified guests"
```

---

## 部署（全部 task 完成、本地驗證後)

1. remote D1 套 migration:`npx wrangler d1 migrations apply wedding-live --remote`。
2. Cloudflare Pages 設 env:`NEXT_PUBLIC_LIFF_ID_JOIN`、`LINE_LIFF_ID_JOIN`。
3. `git push`(CI build+deploy)或 `npm run pages:deploy`(注意 `.env.local` 需完整,見先前 DANMAKU 事件)。
4. 逐入口手機 smoke:團長 RSVP→分享→團員入團→抽獎 fallback→admin 補名。

## Self-Review 摘要

- **Spec 覆蓋**:§3 表 → Task1;§4 四入口 → Task4(RSVP)/6(join)/7(raffle)/8(admin);§4.5 欄位 → Task4/5;決策① Sheet 鏡像 → Task5;決策② 團員補 diet → Task6 Step3 + Task4 Step4;決策③ 8碼不過期 → Task2 `generatePartyCode`。下游(悄悄話 sync、座位)明確不在本 plan。
- **型別一致**:`IdentityRow`/`PartyRow`/`upsertIdentity`/`getIdentity`/`getParty`/`createParty`/`generatePartyCode`/`mergeIdentity` 在 Task2 定義,後續 Task3/4/6/7/8 沿用同名。
- **無 placeholder**:每個寫 code 的 step 附完整程式;LIFF UI step 以既有 sibling page 為 pattern 並列出具體新欄位/資料流。

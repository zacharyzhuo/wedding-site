# 團 + 賓客身分 地基設計 (Party + Guest Identity Foundation)

- 日期:2026-07-11
- 狀態:設計已與新人確認核心方向,待 spec review
- 專案:wedding-site（皖美育見你 婚禮 LINE OA）

## 1. 問題與目標

悄悄話、座位查詢、避免重複 RSVP 這三件事,都需要一條可靠的連結:
**LINE `userId` ↔ 真實姓名 ↔ 所屬「團」**。目前缺這條連結:

- RSVP 只存 LINE `displayName`(暱稱/英文/emoji,對不準),沒有真實姓名。
- 攜伴(companion)完全沒有身分:沒有 `userId` 對應、沒有姓名、沒有關係。
- 悄悄話 webhook 用 `userId` 回覆發送者,攜伴若沒有自己的身分就收不到卡片。

**目標**:一個中央的「團 + 身分」模型,讓所有賓客功能共用;盡可能識別每一位有 LINE 的賓客(含攜伴),並對不用 LINE 的長輩優雅降級。

## 2. 核心概念:團購模型

- **團長**填 RSVP → 建立一個「團」→ 拿到**分享連結**。
- 同行的人點連結 → **加 OA + 入團 + 填真實姓名**(一步到位)。
- 「團」是組織單位:座位掛在團上,團員繼承團長那桌;身分在入團當下就綁定,不必等抽獎才反推。
- 不用 LINE 的長輩不點連結 → 只是團長人數裡的一個數字,現場跟團長走、用實體桌卡;新人可在後台手動補。(這是必須保留的 non-LINE fallback。)

此模型**取代**「強制團長填所有攜伴姓名」的舊構想:攜伴自己入團自報,團長只給人數。

## 3. 資料模型（D1）

操作型資料放 D1(LIFF / webhook 要即時讀寫)。`guest_identity` / `party` 為 D1 表,**並鏡像一份到 Google Sheet 分頁**(`Guest_Identity` / `Parties`)供新人肉眼檢視(決策①)。RSVP 的出席/人數/備註等團層級答案仍照現況寫進 Sheet `RSVP_Responses`(新人名單的 source of truth)。

### `party`（團層級 = 團長 RSVP 的答案）
| 欄位 | 說明 |
|---|---|
| `party_id` TEXT PK | **8 碼短碼**,分享連結用,**不過期**(決策③) |
| `leader_user_id` TEXT | 團長 LINE userId |
| `side` TEXT | 男方 / 女方(整團繼承) |
| `relationship` TEXT | 家長 / 親戚 / 朋友(整團繼承) |
| `attending` TEXT | 出席 / 不克出席(整團) |
| `adult_count` INTEGER | 大人數(含團長) |
| `child_count` INTEGER | 兒童數 |
| `child_seat_count` INTEGER | 其中需要兒童椅的數量 |
| `notes` TEXT | 團長備註(代填不入團者 + 兒童特殊飲食/過敏) |
| `created_at` / `updated_at` INTEGER | |

### `guest_identity`（個人層級 = 每個有 LINE 的大人一筆）
| 欄位 | 說明 |
|---|---|
| `line_user_id` TEXT PK | 唯一鍵 |
| `real_name` TEXT | 真實姓名(悄悄話配對、座位、對獎唱名） |
| `diet` TEXT | 個人飲食需求(無 / 全素 / 蛋奶素 / 過敏備註 / 其他） |
| `party_id` TEXT NULL | 所屬團(團長也在自己的團裡);solo 賓客可為 null |
| `role` TEXT | `leader` / `member` / `solo` |
| `display_name` TEXT | LINE 暱稱快照(後台肉眼核對用) |
| `avatar_url` TEXT NULL | LINE 頭像(後台認人用) |
| `source` TEXT | `rsvp` / `join` / `raffle` / `manual`（姓名來源可信度） |
| `created_at` / `updated_at` INTEGER | |

規則:一個 `userId` 一筆。**已存在 `real_name` 不靜默覆蓋**;`join` 可補上原本為 null 的 `party_id`;`diet` 由本人填/改(決策②)。
**兒童不建 `guest_identity`** — 太小、沒有 LINE、不需要悄悄話/座位查詢;只以 `party` 的 `child_count` / `child_seat_count` / `notes` 計入場地餐點與椅子。

## 4. 四個入口(寫入身分/團)

1. **RSVP LIFF（團長）** — 欄位見 §4.5。
   - 送出 → 建立/更新 `party`(團層級答案)+ upsert 團長自己的 `guest_identity`(role=leader, 含 real_name + diet, source=rsvp)+ 回傳**分享連結 / QR**。
   - **去重**:若開啟者已是某團 member(團長已送單）→ 顯示「你是〔團長〕那一團,團長已回覆」的唯讀摘要,並允許他補自己的飲食(決策②),不顯示整份團表單。

2. **入團連結 LIFF（新,`/liff/join?party=<code>`）**
   - 讀 `party_id`;aggressive 加 OA;取得 userId;問**真實姓名 + 自己的飲食需求**(「你是〔團長〕邀請的…」)。
   - upsert `guest_identity`(role=member, party_id, real_name + diet, source=join)。
   - 無效 code → 友善錯誤 + 一般加 OA 引導。(code 不過期,決策③)

3. **抽獎 LIFF（fallback 識別）**
   - 開啟時查 `guest_identity`:**有 → 跳過姓名,直接報名**;**無 → 問真實姓名** → 寫入(source=raffle, role=solo)後報名。
   - 涵蓋沒透過連結進來的單獨賓客 / 弄丟連結的人。

4. **後台 admin（手動）**
   - 列出「已互動 / 已抽獎但無 `real_name`」的 userId(附 displayName + 頭像)。
   - 新人認人 → 補 `real_name` + 可選指派 `party_id`(source=manual)。

## 4.5 RSVP 欄位模型

需求(飲食、大人/兒童、兒童椅)由**整團一個總值**改為**分兩層收**,因為場地餐點就是逐人/逐類算的。

**團層級(團長 RSVP 填一次 → 寫 `party`):**
- 男方/女方、與新人關係、是否出席(整團,團員繼承)
- **大人人數**(含本人)
- **兒童人數**,其中**需要兒童椅:__ 位**
- 團長**本人**飲食需求(下拉:無 / 全素 / 蛋奶素 / 過敏備註 / 其他)
- **備註**(自由填:代填不入團的大人 + 兒童特殊飲食/過敏,例如「1 位兒童餐、爸媽不用 LINE 兩位吃素」)
- 想對新人說(message,續進 Sheet)

**個人層級(每個有 LINE 的大人一份 → 寫 `guest_identity`):**
- 真實姓名(= 身分識別)
- 個人飲食需求

**誰填個人層級:**
- **團長**:自己那份在 RSVP 一併填(name + diet)。
- **大人團員**:自己點連結入團時填(name + diet),或事後點 RSVP tile 補自己的 diet(決策②)。
- **不用 LINE 的大人**:團長在 `notes` 代填,不建 `guest_identity`。
- **兒童**:完全不建身分,只計入 `party` 的 `child_count` / `child_seat_count` / `notes`。

**人數對帳:** `party.adult_count` 是團長宣告的預計大人數(用來追還沒入團的人);實際大人身分數 = 該團 `guest_identity` 筆數。兩者可在後台並列,差額 = 還沒入團 / 不用 LINE 的大人。場地餐點 = 大人數(素/葷分佈由 `guest_identity.diet` + `notes` 得出)+ 兒童餐數(`child_count`)+ 兒童椅數(`child_seat_count`)。

## 5. 下游消費端（本 spec 範圍外,各自另開 spec）

- **悄悄話配對**:新人在 Google Sheet `ThankYou_Cards` 用真實姓名寫卡片 → sync 透過 `guest_identity` 把姓名對到 userId → 產生 webhook 讀的 `thankyou_cards`(userId 為鍵)。webhook 本身不改。對不到者 fallback 罐頭訊息。
- **座位**:桌次指派到 `party`;`我的座位` 查 userId → `party_id` → 桌次;團員繼承團長那桌。

本地基只負責:**把資料(party / guest_identity)建好,並由四個入口填滿**。

## 6. 分享連結機制

- 連結 = `https://liff.line.me/<join_liff_id>?party=<code>`。
- 團長 RSVP 完成頁顯示可複製 URL + QR,並提供 `liff.shareTargetPicker()` 直接分享到 LINE 對話。

## 7. 錯誤處理 / 邊界

- `real_name` 入團/抽獎 fallback 時必填(非空,trim)。
- `party` code 不存在 → 明確錯誤,不 crash(code 不過期,不會有過期分支)。
- 身分已存在 → 不覆蓋姓名;`join` 只補空的 `party_id`;`diet` 可由本人更新。
- 團長重填 RSVP → UPSERT 更新同一團(不重建)。
- 團員點 RSVP → 顯示「你是〔團長〕那一團,團長已回覆」摘要 + 讓他補/改自己的飲食需求(決策②),不重複送整團。

## 8. 測試策略

- D1 migration:`wrangler d1 migrations apply`(local)渲染 / dry-run 驗證。
- 身分 upsert / 「已知則跳過」判斷:屬應用邏輯,寫 Functions 層測試。
- 各入口 LIFF:手機 smoke test(依使用者測試規範,UI/LIFF 走實測而非單元測試)。

## 9. 建議實作順序

1. D1 migration:`party`、`guest_identity`。
2. 身分讀寫 helper + 「查 userId 是否已識別」API。
3. RSVP 團長改動:欄位模型(§4.5 團層級 + 團長本人 name/diet)+ 建團 + 分享連結 + 去重顯示。
4. 入團連結 LIFF(`/liff/join`):讀 party、加 OA、填 name + diet、綁團。
5. 抽獎 fallback 識別(已知跳過、未知補問)。
6. 後台手動識別/指派。
7. Sheet 鏡像:`guest_identity` / `party` → Sheet `Guest_Identity` / `Parties` 分頁(apps-script 或同步 script)。

（之後另開 spec:悄悄話 sync 配對、座位指派與查詢。）

## 10. 已定案決策(2026-07-11)

1. **資料落點**:`guest_identity` / `party` 放 D1(操作型),**並鏡像到 Sheet 分頁**(`Guest_Identity` / `Parties`)供新人檢視;RSVP 團層級答案仍進 `RSVP_Responses`。
2. **團員點 RSVP**:顯示「團長已回覆」摘要 + **允許補自己的飲食需求**(per-person diet)。
3. **`party_id`**:**8 碼、不過期**。

（下游另開 spec 時要再決:悄悄話卡片撰寫方式 A/B/混合、座位桌次指派與查詢。）

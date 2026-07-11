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

操作型資料放 D1(LIFF / webhook 要即時讀寫)。RSVP 的出席/飲食/人數答案仍照現況寫進 Google Sheet `RSVP_Responses`(新人名單的 source of truth)。`guest_identity` / `party` 為 D1 表,另可只讀鏡像到 Sheet 一個分頁供新人檢視。

### `party`
| 欄位 | 說明 |
|---|---|
| `party_id` TEXT PK | 短碼(分享連結用,例如 8 碼 base32) |
| `leader_user_id` TEXT | 團長 LINE userId |
| `expected_headcount` INTEGER | 團長在 RSVP 填的人數(含本人) |
| `created_at` INTEGER | |

### `guest_identity`
| 欄位 | 說明 |
|---|---|
| `line_user_id` TEXT PK | 唯一鍵 |
| `real_name` TEXT | 真實姓名(悄悄話配對、座位、對獎唱名） |
| `party_id` TEXT NULL | 所屬團(團長也在自己的團裡);solo 賓客可為 null |
| `role` TEXT | `leader` / `member` / `solo` |
| `display_name` TEXT | LINE 暱稱快照(後台肉眼核對用) |
| `avatar_url` TEXT NULL | LINE 頭像(後台認人用) |
| `source` TEXT | `rsvp` / `join` / `raffle` / `manual`（姓名來源可信度） |
| `created_at` / `updated_at` INTEGER | |

規則:一個 `userId` 一筆。**已存在 `real_name` 不靜默覆蓋**;`join` 可補上原本為 null 的 `party_id`。

## 4. 四個入口(寫入身分/團)

1. **RSVP LIFF（團長）**
   - 新增「真實姓名」欄位(取代拿 displayName 當 name)。
   - 送出 → upsert `guest_identity`(role=leader, source=rsvp) + 建立 `party` + 回傳**分享連結 / QR**。
   - **去重**:若開啟者已是某團 member(且團長已送單）→ 顯示「你是〔團長〕那一團,團長已回覆」的唯讀摘要,不顯示表單。

2. **入團連結 LIFF（新,`/liff/join?party=<code>`）**
   - 讀 `party_id`;aggressive 加 OA;取得 userId;問「你是〔團長〕邀請的,請填真實姓名」。
   - upsert `guest_identity`(role=member, party_id, source=join)。
   - 無效/過期 code → 友善錯誤 + 一般加 OA 引導。

3. **抽獎 LIFF（fallback 識別）**
   - 開啟時查 `guest_identity`:**有 → 跳過姓名,直接報名**;**無 → 問真實姓名** → 寫入(source=raffle, role=solo)後報名。
   - 涵蓋沒透過連結進來的單獨賓客 / 弄丟連結的人。

4. **後台 admin（手動）**
   - 列出「已互動 / 已抽獎但無 `real_name`」的 userId(附 displayName + 頭像)。
   - 新人認人 → 補 `real_name` + 可選指派 `party_id`(source=manual)。

## 5. 下游消費端（本 spec 範圍外,各自另開 spec）

- **悄悄話配對**:新人在 Google Sheet `ThankYou_Cards` 用真實姓名寫卡片 → sync 透過 `guest_identity` 把姓名對到 userId → 產生 webhook 讀的 `thankyou_cards`(userId 為鍵)。webhook 本身不改。對不到者 fallback 罐頭訊息。
- **座位**:桌次指派到 `party`;`我的座位` 查 userId → `party_id` → 桌次;團員繼承團長那桌。

本地基只負責:**把資料(party / guest_identity)建好,並由四個入口填滿**。

## 6. 分享連結機制

- 連結 = `https://liff.line.me/<join_liff_id>?party=<code>`。
- 團長 RSVP 完成頁顯示可複製 URL + QR,並提供 `liff.shareTargetPicker()` 直接分享到 LINE 對話。

## 7. 錯誤處理 / 邊界

- `real_name` 入團/抽獎 fallback 時必填(非空,trim)。
- `party` code 不存在/過期 → 明確錯誤,不 crash。
- 身分已存在 → 不覆蓋姓名;`join` 只補空的 `party_id`。
- 團長重填 RSVP → UPSERT 更新同一團(不重建)。
- 團員點 RSVP 而團長尚未送單(理論上少見)→ 顯示「等團長回覆」或允許他先幫團回覆(取捨留待 review)。

## 8. 測試策略

- D1 migration:`wrangler d1 migrations apply`(local)渲染 / dry-run 驗證。
- 身分 upsert / 「已知則跳過」判斷:屬應用邏輯,寫 Functions 層測試。
- 各入口 LIFF:手機 smoke test(依使用者測試規範,UI/LIFF 走實測而非單元測試)。

## 9. 建議實作順序

1. D1 migration:`party`、`guest_identity`。
2. 身分讀寫 helper + 「查 userId 是否已識別」API。
3. RSVP 團長改動:真實姓名欄位 + 建團 + 分享連結 + 去重顯示。
4. 入團連結 LIFF(`/liff/join`)。
5. 抽獎 fallback 識別。
6. 後台手動識別/指派。

（之後另開 spec:悄悄話 sync 配對、座位指派與查詢。）

## 10. 待 review 決策點

- 資料落點:`guest_identity` / `party` 放 D1(操作型),RSVP 答案仍進 Sheet — 是否 OK,要不要鏡像一份到 Sheet 供你們看。
- 團員點 RSVP 時,只顯示「團長已回覆」還是允許他補自己的飲食需求(per-person diet)。
- `party_id` 短碼長度 / 是否設過期。

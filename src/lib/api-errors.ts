// Guest-facing error copy. API handlers return terse English codes (or an
// HTTP status when something unexpected happens); never show those to a
// guest. Frontends pass the raw `error` string (or a thrown message) through
// mapApiError to get a warm zh-Hant line. Known codes get specific guidance;
// everything else (including 'HTTP 500'-style strings) falls back to one
// friendly generic. Branch on the RAW code for logic; use this only for what
// the guest reads.
const KNOWN: Record<string, string> = {
  name_required: '請先填寫姓名',
  'real name required': '請先填寫姓名',
  'invalid diet': '飲食需求的格式不太對，請重新選一次',
  'invalid payload': '有欄位還沒填好，請檢查後再送出一次',
  'invalid json': '有欄位還沒填好，請檢查後再送出一次',
  'message required': '請先輸入想說的話',
  'missing code': '這個邀請連結不完整，請向新人確認',
  'missing partyId': '這個邀請連結不完整，請向新人確認',
  'missing userId': 'LINE 連線出了點狀況，請關掉頁面重新打開',
  'party not found': '找不到這個邀請連結，可能已經失效了',
  already_member: '你已經加入過這一團了',
  'already committed': '這一筆已經送出過了',
  'unsupported contentType': '照片格式不支援，請換一張（建議 JPG／PNG）',
  'not identified yet': '請先完成報名資料',
  forbidden: '你沒有這個頁面的權限',
}

const GENERIC = '發生了一點狀況，請稍後再試一次'

export function mapApiError(raw?: string | null): string {
  if (raw && KNOWN[raw]) return KNOWN[raw]
  return GENERIC
}

/**
 * RSVP webhook — Apps Script web app.
 *
 * Lives inside the couple's wedding-planning Google Sheet
 * (Extensions → Apps Script). Receives RSVP submissions from the wedding-site
 * Cloudflare Pages Function and writes them to the `RSVP_Responses` tab.
 *
 * Semantics:
 *   - LIFF submission (has lineUserId): UPSERT — update the existing row for
 *     this LINE userId in place, otherwise append. Result: one row per LINE
 *     user, latest answer wins. A guest can revise mistakes without polluting
 *     the Sheet.
 *   - Fallback submission (no lineUserId): always append. Same name across
 *     two devices is too unreliable to dedupe on; let the couple reconcile
 *     fallback rows manually.
 *
 * Deploy:
 *   1. Open the Sheet → Extensions → Apps Script. Paste this whole file in.
 *   2. Set SHEET_ID below if it isn't already.
 *   3. Deploy:
 *      - First time: Deploy → New deployment → Type: Web app
 *        - Execute as: Me
 *        - Who has access: Anyone with the link
 *      - Updating an existing deployment (so the /exec URL stays stable):
 *        Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy
 *   4. Copy the /exec URL → Cloudflare Pages env var RSVP_WEBHOOK_URL.
 */

// ── CONFIG ───────────────────────────────────────────────────────────────
const SHEET_ID = '1EO3CIi1U5hwLpmux--DFeJ7Fe8OPMAsMeeIBf8CrHic';  // the wedding-planning Sheet
const TAB_NAME = 'RSVP_Responses';
// ─────────────────────────────────────────────────────────────────────────

const HEADERS = [
  'timestamp', 'source', 'line_user_id', 'name',
  'side', 'relationship', 'attending',
  'headcount', 'child_count', 'diet', 'message',
];
const COL_LINE_USER_ID = 3;  // 1-indexed column position in the Sheet

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const sheet = getOrCreateTab_();
    const row = [
      body.submittedAt || new Date().toISOString(),
      body.source || '',
      body.lineUserId || '',
      body.name || '',
      body.side || '',
      body.relationship || '',
      body.attending || '',
      body.headcount ?? '',
      body.childCount ?? '',
      body.diet || '',
      body.message || '',
    ];

    const existingRow = body.lineUserId
      ? findRowByUserId_(sheet, body.lineUserId)
      : -1;

    if (existingRow > 0) {
      // Update in place — latest answer wins for this LINE user.
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return jsonOk_({ ok: true, mode: existingRow > 0 ? 'updated' : 'appended' });
  } catch (err) {
    return jsonOk_({ ok: false, error: String(err) });
  }
}

function getOrCreateTab_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowByUserId_(sheet, userId) {
  if (!userId) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  // Read only the line_user_id column to keep this cheap even at 200+ rows.
  const values = sheet.getRange(2, COL_LINE_USER_ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === userId) return i + 2;  // +2 = skip header + 0-index→1-index
  }
  return -1;
}

function jsonOk_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

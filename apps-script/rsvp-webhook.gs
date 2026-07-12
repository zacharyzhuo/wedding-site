/**
 * RSVP webhook — Apps Script web app.
 *
 * Lives inside the couple's wedding-planning Google Sheet
 * (Extensions → Apps Script). Receives POSTs from the wedding-site
 * Cloudflare Pages Functions and mirrors them into Sheet tabs. D1 is the
 * operational source of truth during the event; these tabs are a
 * read-only visibility copy for the couple (their decision).
 *
 * doPost dispatches on body.kind:
 *   - (default, no kind) RSVP submission        → `RSVP_Responses` tab.
 *   - kind: 'party'                              → `Parties` tab, UPSERT by party_id.
 *   - kind: 'identity'                            → `Guest_Identity` tab, UPSERT by line_user_id.
 *
 * RSVP_Responses semantics:
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

const RSVP_TAB = 'RSVP_Responses';
const RSVP_HEADERS = [
  'timestamp', 'source', 'line_user_id', 'party_id', 'real_name',
  'side', 'relationship', 'attending', 'adult_count', 'child_count',
  'child_seat_count', 'leader_diet', 'notes', 'message',
];
const RSVP_KEY_COL = 3;  // line_user_id, 1-indexed column position in the Sheet

const PARTIES_TAB = 'Parties';
const PARTIES_HEADERS = [
  'party_id', 'leader_user_id', 'side', 'relationship', 'attending',
  'adult_count', 'child_count', 'child_seat_count', 'notes', 'updated_at',
];
const PARTIES_KEY_COL = 1;  // party_id

const IDENTITY_TAB = 'Guest_Identity';
const IDENTITY_HEADERS = [
  'line_user_id', 'real_name', 'diet', 'party_id', 'role',
  'display_name', 'source', 'updated_at',
];
const IDENTITY_KEY_COL = 1;  // line_user_id
// ─────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.kind === 'party') return handleParty_(body);
    if (body.kind === 'identity') return handleIdentity_(body);
    return handleRsvp_(body);
  } catch (err) {
    return jsonOk_({ ok: false, error: String(err) });
  }
}

function handleRsvp_(body) {
  const sheet = getOrCreateTab_(RSVP_TAB, RSVP_HEADERS);
  const row = [
    body.submittedAt || new Date().toISOString(),
    body.source || '',
    body.lineUserId || '',
    body.partyId || '',
    body.realName || '',
    body.side || '',
    body.relationship || '',
    body.attending || '',
    body.adultCount ?? '',
    body.childCount ?? '',
    body.childSeatCount ?? '',
    body.leaderDiet || '',
    body.notes || '',
    body.message || '',
  ];
  const mode = upsertRow_(sheet, RSVP_KEY_COL, body.lineUserId, row);
  return jsonOk_({ ok: true, mode: mode });
}

function handleParty_(body) {
  const sheet = getOrCreateTab_(PARTIES_TAB, PARTIES_HEADERS);
  const row = [
    body.party_id || '',
    body.leader_user_id || '',
    body.side || '',
    body.relationship || '',
    body.attending || '',
    body.adult_count ?? '',
    body.child_count ?? '',
    body.child_seat_count ?? '',
    body.notes || '',
    body.updated_at || new Date().toISOString(),
  ];
  const mode = upsertRow_(sheet, PARTIES_KEY_COL, body.party_id, row);
  return jsonOk_({ ok: true, mode: mode });
}

function handleIdentity_(body) {
  const sheet = getOrCreateTab_(IDENTITY_TAB, IDENTITY_HEADERS);
  const row = [
    body.line_user_id || '',
    body.real_name || '',
    body.diet || '',
    body.party_id || '',
    body.role || '',
    body.display_name || '',
    body.source || '',
    body.updated_at || new Date().toISOString(),
  ];
  const mode = upsertRow_(sheet, IDENTITY_KEY_COL, body.line_user_id, row);
  return jsonOk_({ ok: true, mode: mode });
}

// Formula-injection guard. Guest-controlled free-text fields (notes,
// message, real_name, …) are written straight into cells; a value starting
// with = + - @ (or a leading tab/CR that Sheets trims into one) is
// interpreted as a FORMULA and runs server-side when the couple opens the
// Sheet — e.g. =IMPORTXML(...) could exfiltrate the whole guest list. We
// prefix such values with a single quote (Sheets renders it as plain text,
// the quote itself is not shown) and cap length to blunt oversized payloads.
// Numbers and empty strings pass through untouched.
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;
const MAX_CELL_LEN = 500;

function sanitizeCell_(v) {
  if (typeof v !== 'string') return v;
  const s = v.length > MAX_CELL_LEN ? v.slice(0, MAX_CELL_LEN) : v;
  return DANGEROUS_PREFIX.test(s) ? "'" + s : s;
}

function sanitizeRow_(row) {
  return row.map(sanitizeCell_);
}

// Generic UPSERT: updates the row whose value in keyCol matches keyValue, or
// appends a new row if no match (or no keyValue) is found. Shared by all
// three tabs above. Every data row is sanitized here so no handler can
// forget it.
function upsertRow_(sheet, keyCol, keyValue, row) {
  row = sanitizeRow_(row);
  const existingRow = keyValue ? findRowByKey_(sheet, keyCol, keyValue) : -1;
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    return 'updated';
  }
  sheet.appendRow(row);
  return 'appended';
}

function getOrCreateTab_(tabName, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Tab already existed — reconcile row 1 against the expected headers.
  // The live RSVP_Responses tab predates this field model (old 11-column
  // header); without this check, new rows written under the new column
  // model would silently land under stale header labels. NOTE: this only
  // overwrites the header row — historical rows written under the old
  // layout keep their OLD column positions (they are NOT reshuffled), so
  // they may need a one-time manual clear by the couple. As of this change
  // the couple's RSVP data so far is all test data, so a manual wipe is
  // safe.
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const headersMatch = existingHeaders.length === headers.length &&
    headers.every(function (h, i) { return existingHeaders[i] === h; });
  if (!headersMatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function findRowByKey_(sheet, keyCol, keyValue) {
  if (!keyValue) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  // Read only the key column to keep this cheap even at 200+ rows.
  const values = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === keyValue) return i + 2;  // +2 = skip header + 0-index→1-index
  }
  return -1;
}

function jsonOk_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

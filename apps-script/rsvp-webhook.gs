/**
 * RSVP webhook — Apps Script web app.
 *
 * Lives inside the couple's wedding-planning Google Sheet
 * (Extensions → Apps Script). Receives RSVP submissions from the wedding-site
 * Cloudflare Pages Function and appends them to a dedicated `RSVP_Responses`
 * tab, then emails both maintainers.
 *
 * Deploy:
 *   1. Open the Sheet → Extensions → Apps Script. Paste this whole file in.
 *   2. Set the constants below (SHEET_ID, NOTIFY_EMAILS).
 *   3. Deploy → New deployment → Type: Web app.
 *      - Description: "RSVP webhook v1"
 *      - Execute as: Me
 *      - Who has access: Anyone with the link
 *   4. Authorize when prompted. Copy the resulting /exec URL — that goes into
 *      Cloudflare Pages env var RSVP_WEBHOOK_URL.
 *
 * Rotating the secret = redeploy and paste the new URL into Cloudflare.
 */

// ── CONFIG ───────────────────────────────────────────────────────────────
const SHEET_ID = '1EO3CIi1U5hwLpmux--DFeJ7Fe8OPMAsMeeIBf8CrHic';  // the wedding-planning Sheet
const TAB_NAME = 'RSVP_Responses';
const NOTIFY_EMAILS = [
  // both maintainers, per references/context.md
  'zacharyzhuoyc@gmail.com',
  '34reiko56@gmail.com'
];
// ─────────────────────────────────────────────────────────────────────────

const HEADERS = [
  'timestamp', 'source', 'line_user_id', 'name',
  'side', 'relationship', 'attending',
  'headcount', 'child_count', 'diet', 'message',
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const sheet = getOrCreateTab_();
    sheet.appendRow([
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
    ]);
    notify_(body);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
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

function notify_(body) {
  const subject = `[Wedding RSVP] ${body.name} · ${body.attending}`;
  const lines = [
    `姓名：${body.name}`,
    `來源：${body.source}`,
    `賓客方：${body.side}`,
    `關係：${body.relationship}`,
    `是否出席：${body.attending}`,
    `出席人數：${body.headcount}（兒童 ${body.childCount}）`,
    `飲食需求：${body.diet || '—'}`,
    `留言：${body.message || '—'}`,
    `LINE userId：${body.lineUserId || '—'}`,
  ];
  MailApp.sendEmail({
    to: NOTIFY_EMAILS.join(','),
    subject: subject,
    body: lines.join('\n'),
  });
}

// Cloudflare Pages Function: POST /api/rsvp
// Receives RSVP submissions from LIFF and the fallback form, then forwards
// them to an Apps Script web app that appends to the couple's Google Sheet.
//
// Why Apps Script and not Google Sheets API directly?
//   - The Sheet is the source of truth (see skill's references/context.md)
//     and Apps Script runs as the Sheet owner, so it can append without any
//     service-account JWT signing inside the Worker.
//   - The "secret" reduces to one URL (RSVP_WEBHOOK_URL) instead of a
//     long-lived private key — much easier to rotate.
//   - The Apps Script side also handles emailing both maintainers.

interface Env {
  RSVP_WEBHOOK_URL: string
}

interface RsvpBody {
  source: 'liff' | 'fallback'
  lineUserId?: string
  name: string
  side: string
  relationship: string
  attending: string
  headcount: number
  childCount: number
  diet: string
  message: string
}

const ALLOWED = new Set(['男方', '女方', '家長', '親戚', '朋友', '出席', '不克出席'])

// Diet is a fixed dropdown on the form. Empty string is also accepted so
// fallback/older submissions don't 400. Anything outside this set is rejected.
const ALLOWED_DIET = new Set([
  '',
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
])

function isValid(b: Partial<RsvpBody>): b is RsvpBody {
  if (!b || typeof b !== 'object') return false
  if (!b.name || typeof b.name !== 'string') return false
  if (!ALLOWED.has(String(b.side))) return false
  if (!ALLOWED.has(String(b.relationship))) return false
  if (!ALLOWED.has(String(b.attending))) return false
  if (typeof b.headcount !== 'number' || b.headcount < 0 || b.headcount > 50) return false
  if (b.diet !== undefined && !ALLOWED_DIET.has(String(b.diet))) return false
  return true
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.RSVP_WEBHOOK_URL) {
    return json(500, { ok: false, error: 'server not configured' })
  }

  let body: Partial<RsvpBody>
  try { body = await request.json() } catch { return json(400, { ok: false, error: 'invalid json' }) }
  if (!isValid(body)) return json(400, { ok: false, error: 'invalid payload' })

  // Forward to Apps Script. Apps Script's doPost reads e.postData.contents,
  // so we send the JSON body straight through with content-type text/plain
  // to avoid an extra CORS preflight on the Apps Script side.
  const upstream = await fetch(env.RSVP_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      ...body,
      submittedAt: new Date().toISOString(),
    }),
  })

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    return json(502, { ok: false, error: 'upstream failed', detail: text.slice(0, 200) })
  }
  return json(200, { ok: true })
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// POST /api/line/webhook — LINE Messaging API webhook.
//
// Keyword-driven replies: 悄悄話 thank-you cards (any guest), 座位
// placeholder (any guest), and the 後台 admin-console shortcut
// (allowlisted userIds only, silence for everyone else). For 悄悄話 we
// look up the guest's personal card in D1 (keyed by LINE userId, synced
// from the planning Sheet) and reply with a Flex card. No card → warm
// generic reply, never silence. Reply messages are free and unlimited on
// the LINE free plan, which is exactly why these features are
// keyword-driven instead of push-driven.
//
// Signature: X-Line-Signature = base64(HMAC-SHA256(channel secret, raw
// body)). NOTE this is the MESSAGING API channel's secret
// (LINE_MESSAGING_CHANNEL_SECRET) — the env var named LINE_CHANNEL_SECRET
// historically holds the LINE Login channel's secret and will NOT verify
// webhook calls.

import { err, json } from '../../_lib/http'

interface Env {
  DB: D1Database
  LINE_MESSAGING_CHANNEL_SECRET?: string
  LINE_CHANNEL_ACCESS_TOKEN?: string
  ADMIN_LINE_USER_IDS?: string
  NEXT_PUBLIC_LIFF_ID_ADMIN?: string
}

interface LineEvent {
  type: string
  replyToken?: string
  source?: { userId?: string }
  message?: { type?: string; text?: string }
}

const KEYWORD_THANKYOU = '悄悄話'
const KEYWORD_SEAT = '座位'
// Admin console shortcut. Exact match only (a command, not conversation),
// and ONLY answered for userIds on the ADMIN_LINE_USER_IDS allowlist —
// guests typing it get silence, so the keyword's existence never leaks.
// The link itself is not the secret: every /api/admin/* call re-verifies
// idToken + allowlist server-side and fails closed for non-admins.
const KEYWORD_ADMIN = '後台'

// Shown when a guest asks for 悄悄話 before the couple opens it in the admin.
const THANKYOU_CLOSED_MESSAGE =
  '悄悄話還沒開放喔，婚禮當天再回來看看我們想對你說的話 ❤'
// 座位 lookup has no code yet — honest placeholder so the menu tile isn't dead.
const SEAT_PLACEHOLDER_MESSAGE =
  '座位查詢會在婚禮當天開放，現場再麻煩你點開看看你的位子 🪑'

function textMessage(text: string) {
  return { type: 'text', text }
}

async function signatureValid(raw: string, secret: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  // Constant-time compare, same idea as the screen-token check.
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

function flexCard(guestName: string | null, message: string) {
  const title = guestName ? `給 ${guestName}` : '謝謝你'
  return {
    type: 'flex',
    altText: '悄悄話 ❤',
    contents: {
      type: 'bubble',
      styles: {
        body: { backgroundColor: '#faf7f1' },
        footer: { backgroundColor: '#faf7f1' },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '悄 悄 話', size: 'xs', color: '#b98d6f' },
          { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#3f3a36' },
          { type: 'separator', color: '#e5dcd2' },
          { type: 'text', text: message, wrap: true, size: 'md', color: '#3f3a36' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '育辰 ＆ 皖淩 敬上 ❤', size: 'xs', color: '#b98d6f', align: 'end' },
        ],
      },
    },
  }
}

const GENERIC_MESSAGE =
  '謝謝你來參加我們的婚禮，能與你共享這一天，是我們最大的幸福。'

function isAdmin(userId: string | undefined, env: Env): boolean {
  if (!userId) return false
  const allow = (env.ADMIN_LINE_USER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return allow.includes(userId)
}

function adminConsoleFlex(liffId: string) {
  return {
    type: 'flex',
    altText: '管理後台',
    contents: {
      type: 'bubble',
      styles: { body: { backgroundColor: '#faf7f1' } },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '管 理 後 台', size: 'xs', color: '#b98d6f' },
          {
            type: 'text',
            text: '彈幕審核・照片・抽獎・悄悄話開關',
            wrap: true,
            size: 'sm',
            color: '#3f3a36',
          },
          {
            type: 'button',
            style: 'primary',
            color: '#a08254',
            action: {
              type: 'uri',
              label: '開啟管理後台',
              uri: `https://liff.line.me/${liffId}`,
            },
          },
        ],
      },
    },
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = env.LINE_MESSAGING_CHANNEL_SECRET
  const token = env.LINE_CHANNEL_ACCESS_TOKEN
  // Fail closed but quietly — LINE retries on non-2xx and we don't want a
  // misconfig to hammer retries forever, so 503 only when truly unset.
  if (!secret || !token) return err(503, 'webhook not configured')

  const raw = await request.text()
  const signature = request.headers.get('x-line-signature') ?? ''
  if (!(await signatureValid(raw, secret, signature))) {
    return err(403, 'bad signature')
  }

  let body: { events?: LineEvent[] }
  try {
    body = JSON.parse(raw) as { events?: LineEvent[] }
  } catch {
    return err(400, 'invalid json')
  }

  // 悄悄話 gate — one settings read for the whole batch.
  const thankyouRow = await env.DB
    .prepare(`SELECT value FROM settings WHERE key = 'thankyou_mode'`)
    .first<{ value: string }>()
  const thankyouOpen = thankyouRow?.value === 'on'

  for (const ev of body.events ?? []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.replyToken) continue
    const text = (ev.message.text ?? '').normalize('NFKC').trim()

    let reply: object | null = null
    if (text === KEYWORD_ADMIN) {
      // Silence for non-admins is deliberate — see KEYWORD_ADMIN comment.
      if (isAdmin(ev.source?.userId, env) && env.NEXT_PUBLIC_LIFF_ID_ADMIN) {
        reply = adminConsoleFlex(env.NEXT_PUBLIC_LIFF_ID_ADMIN)
      }
    } else if (text.includes(KEYWORD_THANKYOU)) {
      if (!thankyouOpen) {
        // Gated: reveal not opened yet — reply a teaser, never the card.
        reply = textMessage(THANKYOU_CLOSED_MESSAGE)
      } else {
        const userId = ev.source?.userId
        const card = userId
          ? await env.DB
              .prepare(`SELECT guest_name, message FROM thankyou_cards WHERE line_user_id = ?`)
              .bind(userId)
              .first<{ guest_name: string; message: string }>()
          : null
        reply = card
          ? flexCard(card.guest_name, card.message)
          : flexCard(null, GENERIC_MESSAGE)
      }
    } else if (text.includes(KEYWORD_SEAT)) {
      reply = textMessage(SEAT_PLACEHOLDER_MESSAGE)
    }
    if (!reply) continue

    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken: ev.replyToken, messages: [reply] }),
    })
    if (!res.ok) {
      // Log-and-continue: one failed reply must not fail the whole batch
      // (LINE would retry every event, causing duplicate replies).
      console.error(`line reply failed: HTTP ${res.status} ${await res.text().catch(() => '')}`)
    }
  }

  // Always 200 for verified requests — LINE's webhook verifier sends empty
  // event lists and expects success.
  return json(200, { ok: true })
}

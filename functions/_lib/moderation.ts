// Server-side moderation helpers.
//
// Two checks run on every incoming danmaku/caption:
//   1. Keyword filter — env var FORBIDDEN_WORDS, comma-separated, case-insensitive.
//      A hit demotes the message to 'pending' instead of dropping it, because
//      silent drops feel like a bug to the sender (they see "sent" but it never
//      shows up). Admin LIFF surfaces 'pending' for human review.
//   2. Global moderation mode — settings.moderation_mode = 'auto' | 'manual'.
//      'manual' demotes every new message to 'pending' regardless of keyword.

import type { D1Database } from '@cloudflare/workers-types'

export type MessageStatus = 'approved' | 'pending'

function normalize(text: string): string {
  // NFKC + lowercase to defeat fullwidth/halfwidth and case-only evasion.
  return text.normalize('NFKC').toLowerCase()
}

export function matchesForbidden(message: string, list: string | undefined): boolean {
  if (!list) return false
  const haystack = normalize(message)
  return list
    .split(',')
    .map(w => normalize(w.trim()))
    .filter(Boolean)
    .some(w => haystack.includes(w))
}

export async function readModerationMode(db: D1Database): Promise<'auto' | 'manual'> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind('moderation_mode')
    .first<{ value: string }>()
  return row?.value === 'manual' ? 'manual' : 'auto'
}

export async function decideStatus(
  message: string,
  env: { FORBIDDEN_WORDS?: string; DB: D1Database },
): Promise<MessageStatus> {
  const mode = await readModerationMode(env.DB)
  if (mode === 'manual') return 'pending'
  if (matchesForbidden(message, env.FORBIDDEN_WORDS)) return 'pending'
  return 'approved'
}

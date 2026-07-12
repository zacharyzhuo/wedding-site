// POST /api/admin/raffle/mode  with body { mode: 'on' | 'off' }
//
// Raffle mode puts the venue screen into a standby takeover (「抽獎時間」 +
// entrant count + prize list) between draws, so the room knows to get their
// phones out. Stored in the same settings table as moderation_mode.
//
// The off→on transition also stamps raffle_mode_started_at (same settings
// table, no schema change) so admin/raffle GET can report elapsed minutes
// even across a page reload or a second device, instead of relying on a
// client-only timer that only knows about toggles it personally fired.

import { err, ok, readJson } from '../../../_lib/http'
import { LiffAuthError } from '../../../_lib/liff-verify'
import { requireAdmin } from '../../../_lib/admin'

interface Env {
  DB: D1Database
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

interface Body { mode?: unknown }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const mode = body?.mode
  if (mode !== 'on' && mode !== 'off') return err(400, "mode must be 'on' or 'off'")

  const current = await env.DB
    .prepare(`SELECT value FROM settings WHERE key = 'raffle_mode'`)
    .first<{ value: string }>()

  await env.DB
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('raffle_mode', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(mode)
    .run()

  // Only stamp on the off→on edge, not on every repeated 'on' (idempotent).
  if (mode === 'on' && current?.value !== 'on') {
    await env.DB
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('raffle_mode_started_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .bind(String(Date.now()))
      .run()
  }

  return ok({ mode })
}

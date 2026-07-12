// POST /api/admin/mode  with body { mode: 'auto' | 'manual' }
// Flips the global moderation_mode setting. 'manual' demotes all NEW
// messages to 'pending'; existing 'approved' rows stay as they are. This
// same flag gates decideStatus() for photo commits too (see
// functions/_lib/moderation.ts), so flipping it also governs new photo
// uploads — there is no separate demote-on-flip pass to mirror here: an
// already-visible photo, like an already-approved message, is left alone
// when the mode flips to 'manual'.

import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError } from '../../_lib/liff-verify'
import { requireAdmin } from '../../_lib/admin'

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
  if (mode !== 'auto' && mode !== 'manual') return err(400, 'mode must be auto or manual')

  await env.DB
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('moderation_mode', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(mode)
    .run()

  return ok({ mode })
}

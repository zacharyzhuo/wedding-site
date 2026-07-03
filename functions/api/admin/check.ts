// GET /api/admin/check
// First call from /liff/admin — purely existential. If the caller's
// verified userId is in ADMIN_LINE_USER_IDS, return 200 + identity;
// otherwise the admin endpoint helper throws and the LIFF page shows
// "not authorized". Keeps the admin list off the client bundle.

import { err, json } from '../../_lib/http'
import { LiffAuthError } from '../../_lib/liff-verify'
import { requireAdmin } from '../../_lib/admin'

interface Env {
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireAdmin(request, env)
    return json(200, { ok: true, user })
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }
}

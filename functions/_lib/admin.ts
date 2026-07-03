// Admin gating helper. Verifies the LIFF idToken, then checks the resulting
// LINE userId against the ADMIN_LINE_USER_IDS allowlist env var.
//
// The allowlist is a comma-separated list — currently Zachary's + Angelet's
// userIds. The check is done in the API layer (never client-side) so the
// admin LIFF page itself can be statically served without leaking the list.

import { LiffAuthError, verifyLineIdToken, type VerifiedLineUser } from './liff-verify'

interface AdminEnv {
  LINE_LOGIN_CHANNEL_ID?: string
  ADMIN_LINE_USER_IDS?: string
}

export async function requireAdmin(
  request: Request,
  env: AdminEnv,
): Promise<VerifiedLineUser> {
  const user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)

  const allow = (env.ADMIN_LINE_USER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (allow.length === 0) {
    // Fail closed: an empty allowlist is almost certainly a misconfig
    // (forgot to fill the env var on deploy). Better to 503 than to either
    // allow everyone or silently lock the couple out.
    throw new LiffAuthError('admin allowlist not configured', 503)
  }

  if (!allow.includes(user.userId)) {
    throw new LiffAuthError('forbidden', 403)
  }
  return user
}

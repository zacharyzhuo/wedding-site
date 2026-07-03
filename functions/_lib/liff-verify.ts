// Server-side LIFF idToken verification.
//
// LIFF clients send `liff.getIDToken()` as an `x-line-id-token` header.
// We POST it to LINE's verify endpoint along with the LINE Login channel ID.
// LINE returns the verified `sub` (userId) + `name` (displayName) if valid,
// or 4xx if forged / expired / wrong audience.
//
// Why call LINE every request instead of verifying JWKS locally?
//   - Skips JWT parsing + JWKS caching code (~100 lines we don't want to own).
//   - LINE's endpoint is fast (~50–100 ms) and the wedding's traffic is
//     bounded (147 guests × handful of submits each). Workers free tier has
//     ample outbound headroom.
//   - Verifying via the official endpoint also catches revocations.
//
// Reference: https://developers.line.biz/en/reference/line-login/#verify-id-token

export interface VerifiedLineUser {
  userId: string
  displayName: string
  picture?: string
}

interface LineVerifyResponse {
  // Subject (LINE userId)
  sub: string
  // Display name (when `profile` scope is granted, which LIFF does)
  name?: string
  picture?: string
  // Audience must equal client_id we sent in the verify call.
  aud: string
  // Issuer is always https://access.line.me
  iss: string
  // Expiry — LINE already enforces this; we don't double-check.
  exp: number
}

export class LiffAuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

/**
 * Reads the `x-line-id-token` header and verifies it with LINE.
 * Throws LiffAuthError on failure — callers can map to a 401/403 Response.
 */
export async function verifyLineIdToken(
  request: Request,
  channelId: string | undefined,
): Promise<VerifiedLineUser> {
  if (!channelId) {
    throw new LiffAuthError('server not configured (LINE_LOGIN_CHANNEL_ID)', 500)
  }
  const idToken = request.headers.get('x-line-id-token')
  if (!idToken) throw new LiffAuthError('missing x-line-id-token')

  const body = new URLSearchParams({ id_token: idToken, client_id: channelId })
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    // LINE returns { error, error_description } on failure.
    const detail = await res.text().catch(() => '')
    throw new LiffAuthError(`idToken invalid: ${detail.slice(0, 120)}`)
  }

  const data = (await res.json()) as LineVerifyResponse
  if (data.aud !== channelId) {
    // Defensive — LINE already checks, but a mismatch here means we're
    // looking at a token issued for a different LIFF app under another
    // channel. Reject loudly so it's caught in pre-event smoke tests.
    throw new LiffAuthError('idToken audience mismatch', 403)
  }

  return {
    userId: data.sub,
    displayName: data.name ?? '訪客',
    picture: data.picture,
  }
}

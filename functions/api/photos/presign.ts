// POST /api/photos/presign
// Verifies the LIFF idToken, allocates an R2 object key, returns a presigned
// PUT URL the browser can upload to directly. The commit step happens in a
// follow-up POST /api/photos call once the upload succeeds.

import { err, ok, readJson } from '../../_lib/http'
import { LiffAuthError, verifyLineIdToken } from '../../_lib/liff-verify'
import { presignPut } from '../../_lib/r2-presign'

interface Env {
  LINE_LOGIN_CHANNEL_ID?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_ENDPOINT?: string
}

interface Body {
  contentType?: unknown
}

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// YYYY-MM-DD in UTC. Doesn't need to be the wedding date — just a sortable
// shard so listings stay readable if we ever bucket-browse.
function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let user
  try {
    user = await verifyLineIdToken(request, env.LINE_LOGIN_CHANNEL_ID)
  } catch (e) {
    if (e instanceof LiffAuthError) return err(e.status, e.message)
    throw e
  }

  const body = await readJson<Body>(request)
  const contentType = typeof body?.contentType === 'string' ? body.contentType : ''
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return err(400, 'unsupported contentType')
  }

  const ext = EXT_BY_TYPE[contentType]
  const key = `uploads/${utcDate()}/${crypto.randomUUID()}.${ext}`

  let uploadUrl: string
  try {
    uploadUrl = await presignPut(env, key, contentType)
  } catch (e) {
    return err(500, e instanceof Error ? e.message : 'presign failed')
  }

  return ok({
    uploadUrl,
    key,
    // Hint for the client — must echo the same contentType on PUT or the
    // signature won't match.
    contentType,
    // Surface the uploader so the client doesn't need a separate /me call.
    uploader: { userId: user.userId, displayName: user.displayName },
  })
}

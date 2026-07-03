// Generate a presigned PUT URL for direct browser → R2 uploads.
// aws4fetch is a ~2 KB AWS Signature V4 implementation that works in Workers
// without bundling the full AWS SDK. R2 exposes an S3-compatible endpoint at
// https://<account-id>.r2.cloudflarestorage.com, so the same signing flow
// applies as for S3.
//
// We sign with explicit credentials (R2 API token, scoped to the bucket)
// instead of using the Worker's R2 binding — the binding can't generate
// presigned URLs, only `put()` server-side which would mean proxying the
// upload through the Worker.

import { AwsClient } from 'aws4fetch'

interface PresignEnv {
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_ENDPOINT?: string
}

const DEFAULT_EXPIRES = 60 * 5 // 5 min — enough for slow uploads, short enough to be safe

function endpoint(env: PresignEnv): string {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT.replace(/\/$/, '')
  if (!env.R2_ACCOUNT_ID) throw new Error('R2_ACCOUNT_ID is not set')
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
}

function client(env: PresignEnv): AwsClient {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 access key not set (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)')
  }
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    // R2 ignores region but aws4fetch insists on one; "auto" matches R2 docs.
    region: 'auto',
  })
}

export async function presignPut(
  env: PresignEnv,
  key: string,
  contentType: string,
  expiresSeconds: number = DEFAULT_EXPIRES,
): Promise<string> {
  if (!env.R2_BUCKET) throw new Error('R2_BUCKET is not set')
  const url = new URL(`${endpoint(env)}/${env.R2_BUCKET}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds))

  const signed = await client(env).sign(
    new Request(url.toString(), {
      method: 'PUT',
      // R2 enforces matching Content-Type when signed in.
      headers: { 'content-type': contentType },
    }),
    { aws: { signQuery: true } },
  )
  return signed.url
}

export async function presignGet(
  env: PresignEnv,
  key: string,
  expiresSeconds: number = 60 * 10,
): Promise<string> {
  if (!env.R2_BUCKET) throw new Error('R2_BUCKET is not set')
  const url = new URL(`${endpoint(env)}/${env.R2_BUCKET}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds))

  const signed = await client(env).sign(
    new Request(url.toString(), { method: 'GET' }),
    { aws: { signQuery: true } },
  )
  return signed.url
}

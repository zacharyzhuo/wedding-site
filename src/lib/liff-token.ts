// Tiny helper to pull liff.getIDToken() in client components that already
// have a live LIFF profile from useLiffProfile(). Kept separate because
// useLiffProfile intentionally returns just the profile shape — adding
// idToken would force every page to depend on the SDK type.

'use client'

export async function getLiffIdToken(): Promise<string | null> {
  const liff = (await import('@line/liff')).default
  // liff.init() must already have run for getIDToken to return — that's
  // guaranteed inside pages that have rendered after useLiffProfile resolves.
  return liff.getIDToken()
}

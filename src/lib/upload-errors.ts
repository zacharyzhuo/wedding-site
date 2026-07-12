// Maps thrown upload errors to guest-facing zh-Hant copy. Keeps the pinned
// copy strings in one place instead of scattering error-message checks
// across the danmaku page. Upstream code throws Error objects with
// .code-style `message`s (see src/lib/image-resize.ts and the danmaku
// page's upload pipeline) rather than embedding display text at the throw
// site — this is the only place that decides what the guest sees.

// Image-processing failures — the fix is "pick a different photo".
const DECODE_CODES = new Set([
  'DECODE_FAILED',
  'CANVAS_UNAVAILABLE',
  'ENCODE_FAILED',
  'TOO_LARGE',
])

// Connectivity / server round-trip failures — the fix is "try again".
const NETWORK_CODES = new Set([
  'AUTH_TIMEOUT',
  'PRESIGN_FAILED',
  'PUT_FAILED',
  'COMMIT_FAILED',
  'SEND_FAILED',
])

const DECODE_COPY = '圖片格式不支援，請換一張照片（建議 JPG/PNG）'
const NETWORK_COPY = '網路不穩，上傳失敗了，請再試一次'
const FALLBACK_COPY = '出了點小狀況，請稍後再試'

export function mapUploadError(err: unknown): string {
  if (err instanceof Error) {
    if (DECODE_CODES.has(err.message)) return DECODE_COPY
    // Browsers throw a bare TypeError (e.g. "Failed to fetch") when a fetch
    // never reaches the network at all — treat any TypeError as a network
    // failure alongside our own coded PRESIGN_FAILED/PUT_FAILED/etc.
    if (NETWORK_CODES.has(err.message) || err instanceof TypeError) return NETWORK_COPY
  }
  return FALLBACK_COPY
}

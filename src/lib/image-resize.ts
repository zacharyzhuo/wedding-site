// Client-side image downscale + JPEG re-encode. Runs entirely in the browser
// using canvas, so it works inside LIFF's in-app browser without any extra
// dependency.
//
// Why we do this:
//   1. R2 free tier is 10 GB total. Originals would exceed it; resized
//      ≤ 500 KB stays well under. See interactive-features.md.
//   2. Faster uploads on mobile data, which most guests will be on.
//
// Errors are thrown as .code-style identifiers (e.g. `DECODE_FAILED`)
// rather than English prose — src/lib/upload-errors.ts maps them to
// guest-facing zh-Hant copy; this module doesn't own display text.

const MAX_EDGE = 2048
const JPEG_QUALITY = 0.8
const HARD_CAP_BYTES = 2 * 1024 * 1024 // 2 MB after resize

export interface ResizeResult {
  blob: Blob
  contentType: 'image/jpeg'
  width: number
  height: number
  originalBytes: number
  outputBytes: number
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is fastest where supported (modern Safari, Chrome).
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to <img> path; some browsers reject HEIC etc.
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('DECODE_FAILED'))
    img.src = URL.createObjectURL(file)
  })
}

function targetSize(w: number, h: number): { tw: number; th: number } {
  const longest = Math.max(w, h)
  if (longest <= MAX_EDGE) return { tw: w, th: h }
  const ratio = MAX_EDGE / longest
  return { tw: Math.round(w * ratio), th: Math.round(h * ratio) }
}

export async function resizeForUpload(file: File): Promise<ResizeResult> {
  const source = await loadBitmap(file)
  const srcW = 'width' in source ? source.width : 0
  const srcH = 'height' in source ? source.height : 0
  if (!srcW || !srcH) throw new Error('DECODE_FAILED')

  const { tw, th } = targetSize(srcW, srcH)
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  ctx.drawImage(source as CanvasImageSource, 0, 0, tw, th)

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  )
  if (!blob) throw new Error('ENCODE_FAILED')

  if (blob.size > HARD_CAP_BYTES) {
    // Defensive — if a very high-res still produces > 2 MB after resize,
    // reject rather than push past the quota.
    throw new Error('TOO_LARGE')
  }

  return {
    blob,
    contentType: 'image/jpeg',
    width: tw,
    height: th,
    originalBytes: file.size,
    outputBytes: blob.size,
  }
}

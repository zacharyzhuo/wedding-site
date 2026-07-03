'use client'

// LIFF: 上傳照片
// Three-step submit:
//   1. resize in-browser (canvas) → JPEG @ 0.8 quality
//   2. /api/photos/presign → presigned R2 PUT URL
//   3. PUT directly to R2, then /api/photos to commit metadata
//
// Caption is optional and, if non-empty, becomes a danmaku bound to the
// photo via /api/photos's auto-insert path.

import { useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { resizeForUpload, type ResizeResult } from '@/lib/image-resize'

type Phase = 'idle' | 'compressing' | 'uploading' | 'committing' | 'done' | 'error'

const MAX_CAPTION = 60

export default function PhotoLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_PHOTO
  const state = useLiffProfile(liffId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pick, setPick] = useState<{ file: File; previewUrl: string } | null>(null)
  const [caption, setCaption] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  // Release object URL on unmount / replacement to avoid memory leaks.
  useEffect(() => {
    return () => { if (pick) URL.revokeObjectURL(pick.previewUrl) }
  }, [pick])

  if (state.status === 'loading') return <Centered><p className="text-ink/60">載入中…</p></Centered>
  if (state.status === 'error') return <Centered>
    <p className="text-ink/80">無法載入 LINE 資料</p>
    <p className="text-sm text-ink/50 mt-2">{state.message}</p>
  </Centered>
  if (phase === 'done') return <Centered>
    <h1 className="text-3xl">上傳成功 ❤</h1>
    <p className="mt-4 text-ink/70">留意現場大螢幕，幾秒後出現。</p>
    <button
      className="mt-8 text-sm text-accent underline underline-offset-4"
      onClick={() => { setPick(null); setCaption(''); setPhase('idle') }}
    >再上傳一張</button>
  </Centered>

  const profile = state.profile
  const captionTrim = caption.trim()
  const captionTooLong = caption.length > MAX_CAPTION
  const submitDisabled = !pick || captionTooLong || (phase !== 'idle' && phase !== 'error')

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return
    if (pick) URL.revokeObjectURL(pick.previewUrl)
    setPick({ file, previewUrl: URL.createObjectURL(file) })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pick) return
    setError(null)

    let resized: ResizeResult
    try {
      setPhase('compressing')
      resized = await resizeForUpload(pick.file)
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : '圖片處理失敗')
      return
    }

    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')

      setPhase('uploading')
      const presignRes = await fetch('/api/photos/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({ contentType: resized.contentType }),
      })
      const presign = await presignRes.json() as
        { ok?: boolean; uploadUrl?: string; key?: string; error?: string }
      if (!presignRes.ok || !presign.ok || !presign.uploadUrl || !presign.key) {
        throw new Error(presign.error ?? `presign HTTP ${presignRes.status}`)
      }

      // Direct PUT to R2. Content-Type MUST match what the URL was signed for.
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': resized.contentType },
        body: resized.blob,
      })
      if (!putRes.ok) throw new Error(`R2 upload HTTP ${putRes.status}`)

      setPhase('committing')
      const commitRes = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({ key: presign.key, caption: captionTrim || undefined }),
      })
      const commit = await commitRes.json() as { ok?: boolean; error?: string }
      // Treat 409 (already committed) as success so a retry after network
      // hiccup still shows the success state.
      if (!commitRes.ok && commitRes.status !== 409) {
        throw new Error(commit.error ?? `commit HTTP ${commitRes.status}`)
      }
      setPhase('done')
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : '上傳失敗，請稍後再試')
    }
  }

  const buttonLabel: Record<Phase, string> = {
    idle: '上傳並送上大螢幕',
    compressing: '壓縮中…',
    uploading: '上傳中…',
    committing: '寫入中…',
    done: '已完成',
    error: '再試一次',
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">PHOTO</p>
        <h1 className="mt-2 text-2xl">拍張照給新人</h1>
        <p className="mt-3 text-sm text-ink/60">嗨，{profile.displayName}</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={onPick}
          />
          {pick ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pick.previewUrl}
                alt="預覽"
                className="w-full rounded-md border border-champagne object-cover"
              />
              <button
                type="button"
                className="text-sm text-ink/60 underline underline-offset-4"
                onClick={() => fileInputRef.current?.click()}
              >換一張</button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md border border-dashed border-champagne bg-white px-4 py-12 text-center text-ink/60"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="block text-3xl">📷</span>
              <span className="mt-2 block">選擇照片</span>
              <span className="mt-1 block text-xs text-ink/40">拍照 或 從相簿選</span>
            </button>
          )}
        </div>

        <label className="block">
          <span className="field-label">說點什麼？（可不填）</span>
          <textarea
            rows={2}
            className="field-input"
            placeholder="超美的一桌！"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            maxLength={MAX_CAPTION + 20}
          />
          <span className={`mt-1 block text-right text-xs ${captionTooLong ? 'text-red-600' : 'text-ink/50'}`}>
            {caption.length} / {MAX_CAPTION}
          </span>
          <span className="mt-1 block text-xs text-ink/40">
            這句話會同步飛過大螢幕。
          </span>
        </label>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button type="submit" disabled={submitDisabled} className="btn-primary w-full">
          {buttonLabel[phase]}
        </button>
      </form>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
  )
}

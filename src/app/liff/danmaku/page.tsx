'use client'

// LIFF: 想對新人說（可附照片）
// Merged message + photo entry (decision 2026-07-05). One page for both paths
// keeps the rich menu to a single tile and frees a slot for 悄悄話.
// Text-first: the message field is the main act, the photo is an optional
// attachment — pure-text well-wishers must never feel photo is required.
//   - text only  → POST /api/danmaku (keyword + mode filters server-side)
//   - with photo → resize in-browser → /api/photos/presign → PUT to R2 →
//                  /api/photos commit; a non-empty message rides along as the
//                  caption and becomes the danmaku bound to the photo.

import { useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { resizeForUpload, type ResizeResult } from '@/lib/image-resize'

type Phase = 'idle' | 'compressing' | 'uploading' | 'committing' | 'sending' | 'error'

const MAX_LEN = 60

export default function DanmakuLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_DANMAKU
  const state = useLiffProfile(liffId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [message, setMessage] = useState('')
  const [pick, setPick] = useState<{ file: File; previewUrl: string } | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [done, setDone] = useState<null | { pending: boolean; hadPhoto: boolean }>(null)
  const [error, setError] = useState<string | null>(null)

  // Release object URL on unmount / replacement to avoid memory leaks.
  useEffect(() => {
    return () => { if (pick) URL.revokeObjectURL(pick.previewUrl) }
  }, [pick])

  if (state.status === 'loading') {
    return <Centered><p className="text-ink/60">載入中…</p></Centered>
  }
  if (state.status === 'error') {
    return <Centered>
      <p className="text-ink/80">無法載入 LINE 資料</p>
      <p className="text-sm text-ink/50 mt-2">{state.message}</p>
    </Centered>
  }
  if (done) {
    return <Centered>
      <h1 className="text-3xl">
        {done.pending ? '已送出，等待確認' : '已送上大螢幕'} ❤
      </h1>
      <p className="mt-4 text-ink/70">
        {done.pending
          ? done.hadPhoto
            ? '照片已上牆，留言保留給新人確認後亮相。'
            : '訊息保留給新人確認後上牆。'
          : '留意現場大螢幕，幾秒後出現。'}
      </p>
      <button
        className="mt-8 text-sm text-accent underline underline-offset-4"
        onClick={() => { setDone(null); setMessage(''); setPick(null); setPhase('idle') }}
      >再送一則</button>
    </Centered>
  }

  const profile = state.profile
  const trimmed = message.trim()
  const tooLong = message.length > MAX_LEN
  const busy = phase !== 'idle' && phase !== 'error'
  const canSubmit = (trimmed.length > 0 || pick !== null) && !tooLong && !busy

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return
    if (pick) URL.revokeObjectURL(pick.previewUrl)
    setPick({ file, previewUrl: URL.createObjectURL(file) })
  }

  function removePick() {
    if (pick) URL.revokeObjectURL(pick.previewUrl)
    setPick(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    try {
      if (pick) {
        let resized: ResizeResult
        try {
          setPhase('compressing')
          resized = await resizeForUpload(pick.file)
        } catch (err) {
          throw new Error(err instanceof Error ? err.message : '圖片處理失敗')
        }

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
          body: JSON.stringify({ key: presign.key, caption: trimmed || undefined }),
        })
        const commit = await commitRes.json().catch(() => ({})) as
          { ok?: boolean; captionPending?: boolean; error?: string }
        // Treat 409 (already committed) as success so a retry after network
        // hiccup still shows the success state.
        if (!commitRes.ok && commitRes.status !== 409) {
          throw new Error(commit.error ?? `commit HTTP ${commitRes.status}`)
        }
        setDone({ hadPhoto: true, pending: !!commit.captionPending })
      } else {
        setPhase('sending')
        const idToken = await getLiffIdToken()
        if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')

        const res = await fetch('/api/danmaku', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
          body: JSON.stringify({ message: trimmed }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean; pending?: boolean; error?: string
        }
        if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setDone({ hadPhoto: false, pending: !!data.pending })
      }
      setPhase('idle')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : '送出失敗，請稍後再試')
    }
  }

  const buttonLabel: Record<Phase, string> = {
    idle: '送上大螢幕 →',
    sending: '送出中…',
    compressing: '壓縮中…',
    uploading: '上傳中…',
    committing: '寫入中…',
    error: '再試一次',
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">MESSAGE</p>
        <h1 className="mt-2 text-2xl">想對新人說</h1>
        <p className="mt-3 text-sm text-ink/60">嗨，{profile.displayName}</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <label className="block">
          <span className="field-label">訊息會飛過現場大螢幕</span>
          <textarea
            rows={3}
            className="field-input"
            placeholder="恭喜兩位 ❤"
            value={message}
            onChange={e => setMessage(e.target.value)}
            maxLength={MAX_LEN + 20}
          />
          <span className={`mt-1 block text-right text-xs ${tooLong ? 'text-red-600' : 'text-ink/50'}`}>
            {message.length} / {MAX_LEN}
          </span>
        </label>

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
              <div className="flex gap-5 text-sm">
                <button
                  type="button"
                  className="text-ink/60 underline underline-offset-4"
                  onClick={() => fileInputRef.current?.click()}
                >換一張</button>
                <button
                  type="button"
                  className="text-ink/60 underline underline-offset-4"
                  onClick={removePick}
                >移除照片</button>
              </div>
              <p className="text-xs text-ink/40">照片會加入大螢幕輪播。</p>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md border border-dashed border-champagne bg-white px-4 py-4 text-center text-ink/60"
              onClick={() => fileInputRef.current?.click()}
            >
              📷 附加照片（可不附）
            </button>
          )}
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          {buttonLabel[phase]}
        </button>
      </form>

      <p className="mt-8 text-center text-xs text-ink/40">
        文字、照片擇一即可送出；兩者都有就一起上牆。
      </p>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
  )
}

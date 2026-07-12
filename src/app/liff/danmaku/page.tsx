'use client'

// LIFF: 想對新人說（可附照片）
// Merged message + photo entry (decision 2026-07-05). One page for both paths
// keeps the rich menu to a single tile and frees a slot for 悄悄話.
// Text-first: the message field is the main act, the photo is an optional
// attachment — pure-text well-wishers must never feel photo is required.
//   - text only  → POST /api/danmaku (keyword + mode filters server-side)
//   - with photo(s) → resize in-browser → /api/photos/presign → XHR PUT to
//                  R2 (progress-tracked) → /api/photos commit, one photo at
//                  a time; a non-empty message rides along as the caption on
//                  the FIRST photo only and becomes the danmaku bound to it.
//
// Multi-photo uploads run sequentially (not parallel) so the progress bar
// and "第 x/y 張" counter stay meaningful, and so a mid-batch failure only
// ever leaves ONE file in flight to retry — already-committed photos keep
// their `status: 'done'` and are skipped on retry.

import { useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { resizeForUpload, type ResizeResult } from '@/lib/image-resize'
import { mapUploadError } from '@/lib/upload-errors'
import { Spinner, StatusBanner } from '@/components/ui'

type FileStatus = 'pending' | 'uploading' | 'done' | 'error'
type PickedFile = {
  file: File
  previewUrl: string
  status: FileStatus
}
type BatchStatus = 'idle' | 'running' | 'error'

const MAX_LEN = 60
// After this long with no upload-progress movement, reassure the guest the
// upload is still alive rather than let a stalled bar look broken.
const STALL_MS = 5000

// XHR (not fetch) so `upload.onprogress` can drive a determinate bar — fetch
// has no upload-progress event.
function xhrPut(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error('PUT_FAILED'))
    }
    xhr.onerror = () => reject(new Error('PUT_FAILED'))
    xhr.onabort = () => reject(new Error('PUT_FAILED'))
    xhr.send(blob)
  })
}

async function uploadOne(
  file: File,
  caption: string | undefined,
  onProgress: (percent: number) => void,
): Promise<{ status: 'visible' | 'pending' }> {
  const resized: ResizeResult = await resizeForUpload(file) // throws coded errors as-is

  const idToken = await getLiffIdToken()
  if (!idToken) throw new Error('AUTH_TIMEOUT')

  const presignRes = await fetch('/api/photos/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
    body: JSON.stringify({ contentType: resized.contentType }),
  })
  const presign = await presignRes.json().catch(() => ({})) as
    { ok?: boolean; uploadUrl?: string; key?: string }
  if (!presignRes.ok || !presign.ok || !presign.uploadUrl || !presign.key) {
    throw new Error('PRESIGN_FAILED')
  }

  // Content-Type MUST match what the URL was signed for.
  await xhrPut(presign.uploadUrl, resized.blob, resized.contentType, onProgress)

  const commitRes = await fetch('/api/photos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
    body: JSON.stringify({ key: presign.key, caption }),
  })
  const commit = await commitRes.json().catch(() => ({})) as
    { ok?: boolean; status?: 'visible' | 'pending' }
  // Treat 409 (already committed) as success so a retry after network
  // hiccup still shows the success state.
  if (!commitRes.ok && commitRes.status !== 409) throw new Error('COMMIT_FAILED')

  return { status: commit.status === 'pending' ? 'pending' : 'visible' }
}

export default function DanmakuLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_DANMAKU
  const state = useLiffProfile(liffId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [message, setMessage] = useState('')
  const [picks, setPicks] = useState<PickedFile[]>([])
  const [status, setStatus] = useState<BatchStatus>('idle')
  const [progress, setProgress] = useState<{ index: number; total: number; percent: number } | null>(null)
  const [stalled, setStalled] = useState(false)
  const [done, setDone] = useState<null | { hadPhoto: boolean; pending: boolean }>(null)
  const [error, setError] = useState<string | null>(null)

  // Tracks whether ANY photo committed so far this submission came back
  // 'pending' — survives across a mid-batch retry (unlike a local variable
  // scoped to one runBatch() call), reset only when a fresh submission starts.
  const anyPendingRef = useRef(false)
  const stallTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastProgressRef = useRef<{ percent: number; at: number }>({ percent: -1, at: 0 })
  // Mirrors `picks` for the unmount cleanup below, so that cleanup doesn't
  // need to re-run (and prematurely revoke still-live preview URLs) on
  // every picks change — only on actual unmount.
  const picksRef = useRef<PickedFile[]>([])
  useEffect(() => { picksRef.current = picks }, [picks])
  useEffect(() => {
    return () => { picksRef.current.forEach(p => URL.revokeObjectURL(p.previewUrl)) }
  }, [])
  useEffect(() => {
    return () => { if (stallTimerRef.current) clearInterval(stallTimerRef.current) }
  }, [])

  function startStallWatch() {
    if (stallTimerRef.current) clearInterval(stallTimerRef.current)
    lastProgressRef.current = { percent: -1, at: Date.now() }
    setStalled(false)
    stallTimerRef.current = setInterval(() => {
      if (Date.now() - lastProgressRef.current.at > STALL_MS) setStalled(true)
    }, 1000)
  }
  function stopStallWatch() {
    if (stallTimerRef.current) clearInterval(stallTimerRef.current)
    stallTimerRef.current = null
  }
  function reportProgress(index: number, total: number, percent: number) {
    if (percent !== lastProgressRef.current.percent) {
      lastProgressRef.current = { percent, at: Date.now() }
      setStalled(false)
    }
    setProgress({ index, total, percent })
  }

  if (state.status === 'loading') {
    return <Centered><Spinner /></Centered>
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
        {done.pending ? '已送出，等待確認' : '已送上大螢幕'}
      </h1>
      <p className="mt-4 text-ink/70">
        {done.hadPhoto
          ? (done.pending ? '已送出！照片審核通過後就會出現在大螢幕上。' : '留意現場大螢幕，幾秒後出現。')
          : (done.pending ? '訊息保留給新人確認後上牆。' : '留意現場大螢幕，幾秒後出現。')}
      </p>
      <button
        className="mt-8 text-sm text-accent underline underline-offset-4"
        onClick={() => {
          setDone(null)
          setMessage('')
          picks.forEach(p => URL.revokeObjectURL(p.previewUrl))
          setPicks([])
          setStatus('idle')
          setProgress(null)
          setStalled(false)
          setError(null)
          anyPendingRef.current = false
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
      >再送一則</button>
    </Centered>
  }

  const profile = state.profile
  const trimmed = message.trim()
  const tooLong = message.length > MAX_LEN
  const busy = status === 'running'
  const canSubmit = (trimmed.length > 0 || picks.length > 0) && !tooLong && !busy

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const list = e.target.files
    if (!list || list.length === 0) return
    const added: PickedFile[] = Array.from(list).map(file => ({
      file, previewUrl: URL.createObjectURL(file), status: 'pending',
    }))
    setPicks(prev => [...prev, ...added])
    e.target.value = '' // allow re-picking the same file(s) again later
  }

  function removePick(index: number) {
    setPicks(prev => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function runBatch() {
    setStatus('running')
    setError(null)
    const total = picks.length
    startStallWatch()
    try {
      for (let i = 0; i < picks.length; i++) {
        if (picks[i].status === 'done') continue // already committed on a prior attempt
        setPicks(prev => prev.map((p, idx) => (idx === i ? { ...p, status: 'uploading' } : p)))
        try {
          const result = await uploadOne(
            picks[i].file,
            i === 0 ? (trimmed || undefined) : undefined, // message binds to the first photo only
            percent => reportProgress(i + 1, total, percent),
          )
          if (result.status === 'pending') anyPendingRef.current = true
          setPicks(prev => prev.map((p, idx) => (idx === i ? { ...p, status: 'done' } : p)))
        } catch (uploadErr) {
          setPicks(prev => prev.map((p, idx) => (idx === i ? { ...p, status: 'error' } : p)))
          throw uploadErr
        }
      }
      stopStallWatch()
      setProgress(null)
      setDone({ hadPhoto: true, pending: anyPendingRef.current })
      setStatus('idle')
    } catch (batchErr) {
      stopStallWatch()
      setStatus('error')
      setError(mapUploadError(batchErr))
    }
  }

  async function sendMessageOnly() {
    setStatus('running')
    setError(null)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('AUTH_TIMEOUT')

      const res = await fetch('/api/danmaku', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; pending?: boolean }
      if (!res.ok || !data.ok) throw new Error('SEND_FAILED')
      setDone({ hadPhoto: false, pending: !!data.pending })
      setStatus('idle')
    } catch (sendErr) {
      setStatus('error')
      setError(mapUploadError(sendErr))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    if (picks.length > 0) await runBatch()
    else await sendMessageOnly()
  }

  const buttonLabel = status === 'error'
    ? '再試一次'
    : busy
      ? (progress ? `上傳中 第 ${progress.index}/${progress.total} 張…` : '送出中…')
      : '送上大螢幕 →'

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
            placeholder="恭喜兩位"
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
            multiple
            className="sr-only"
            onChange={onPick}
          />
          {picks.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {picks.map((p, i) => (
                  <div key={p.previewUrl} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.previewUrl}
                      alt="預覽"
                      width={200}
                      height={200}
                      className="aspect-square w-full rounded-md border border-champagne object-cover"
                    />
                    {p.status !== 'pending' && (
                      <span className="absolute bottom-1 right-1 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] text-cream">
                        {p.status === 'uploading' ? '上傳中' : p.status === 'done' ? '已完成' : '失敗'}
                      </span>
                    )}
                    {p.status !== 'uploading' && (
                      <button
                        type="button"
                        aria-label="移除照片"
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink/70 text-xs text-cream"
                        onClick={() => removePick(i)}
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-5 text-sm">
                <button
                  type="button"
                  className="text-ink/60 underline underline-offset-4"
                  onClick={() => fileInputRef.current?.click()}
                >再加照片</button>
              </div>
              <p className="text-xs text-ink/40">照片會加入大螢幕輪播；第一張會附上你的留言。</p>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md border border-dashed border-champagne bg-white px-4 py-4 text-center text-ink/60"
              onClick={() => fileInputRef.current?.click()}
            >
              📷 附加照片（可不附，可多選）
            </button>
          )}
        </div>

        {progress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-ink/60">
              <span>第 {progress.index}/{progress.total} 張</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-champagne/40">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            {stalled && <p className="text-xs text-ink/50">還在傳送中，請稍候</p>}
          </div>
        )}

        {error && <StatusBanner kind="error">{error}</StatusBanner>}

        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          {buttonLabel}
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

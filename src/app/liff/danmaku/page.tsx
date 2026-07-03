'use client'

// LIFF: 想對新人說
// Text-only path into the danmaku wall. Reuses useLiffProfile (identity comes
// from LINE — no name input) and ships the message to /api/danmaku, which
// runs keyword + mode filters server-side.

import { useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'

const MAX_LEN = 60

export default function DanmakuLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_DANMAKU
  const state = useLiffProfile(liffId)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<null | { pending: boolean }>(null)
  const [error, setError] = useState<string | null>(null)

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
      <h1 className="text-3xl">{done.pending ? '已送出，等待審核' : '已送上大螢幕'} ❤</h1>
      <p className="mt-4 text-ink/70">
        {done.pending
          ? '訊息保留給新人確認後上牆。'
          : '留意現場大螢幕，幾秒後出現。'}
      </p>
    </Centered>
  }

  const profile = state.profile
  const trimmed = message.trim()
  const tooLong = message.length > MAX_LEN

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed || tooLong) return
    setError(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')

      const res = await fetch('/api/danmaku', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-line-id-token': idToken,
        },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; pending?: boolean; error?: string
      }
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDone({ pending: !!data.pending })
    } catch (e) {
      setError(e instanceof Error ? e.message : '送出失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">DANMAKU</p>
        <h1 className="mt-2 text-2xl">想對新人說</h1>
        <p className="mt-3 text-sm text-ink/60">嗨，{profile.displayName}</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <label className="block">
          <span className="field-label">訊息會飛過現場大螢幕</span>
          <textarea
            rows={4}
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

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !trimmed || tooLong}
          className="btn-primary w-full"
        >
          {submitting ? '送出中…' : '送上大螢幕 →'}
        </button>
      </form>

      <p className="mt-8 text-center text-xs text-ink/40">
        送出後留意現場大螢幕，幾秒後會出現。
      </p>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
  )
}

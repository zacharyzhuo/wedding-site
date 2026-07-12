'use client'

// LIFF: 抽獎報名
// One tap to enter — identity comes from LINE, one account = one entry
// (server-side upsert keeps it idempotent). Winning requires being present;
// the draw itself happens on the venue screen, driven from the admin page.
//
// Fallback identity: a guest can reach this page without ever RSVPing or
// joining a party. We check GET /api/identity/me first — if not identified,
// the entry form collects 真實姓名 (required) + 飲食需求 before submit,
// same shape as /liff/join. Already-identified guests skip the form
// entirely (「已知就跳過」) and get the original one-tap flow.
//
// GET /api/raffle is polled every 5s (both before and after entering) so a
// guest who stepped away from their phone still finds out they won, and the
// entrant count + raffle-mode banner stay live without a manual refresh.

import { useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { DIET_OPTIONS } from '@/lib/diet'
import { Spinner, StatusBanner } from '@/components/ui'

type MeResponse = { ok?: boolean; identified?: boolean }
type RaffleResponse = {
  ok?: boolean
  entered?: boolean
  total?: number
  mode?: 'on' | 'off'
  win?: { prizeName: string } | null
}
type FormState = { realName: string; diet: string }
const initialForm: FormState = { realName: '', diet: DIET_OPTIONS[0] }
const POLL_MS = 5000

export default function RaffleLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_RAFFLE
  const state = useLiffProfile(liffId)
  const [entered, setEntered] = useState<boolean | null>(null)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [mode, setMode] = useState<'on' | 'off'>('off')
  const [win, setWin] = useState<{ prizeName: string } | null>(null)
  const [identified, setIdentified] = useState<boolean | null>(null)
  const [form, setForm] = useState<FormState>(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopPollRef = useRef(false)

  // Raffle status poll: entrant count, raffle-mode banner, and the win
  // reveal all need to keep updating on their own — a guest who won might
  // be at the buffet, not staring at this page.
  useEffect(() => {
    if (state.status !== 'ready') return
    stopPollRef.current = false

    async function poll() {
      if (stopPollRef.current) return
      try {
        const idToken = await getLiffIdToken()
        if (idToken) {
          const res = await fetch('/api/raffle', { headers: { 'x-line-id-token': idToken } })
          const data = await res.json() as RaffleResponse
          if (res.ok && data.ok) {
            setEntered(!!data.entered)
            setTotalCount(data.total ?? null)
            setMode(data.mode === 'on' ? 'on' : 'off')
            setWin(data.win ?? null)
          }
        }
      } catch {
        // Transient — next tick retries; never blank the page over a blip.
      }
      if (!stopPollRef.current) setTimeout(poll, POLL_MS)
    }
    poll()

    return () => { stopPollRef.current = true }
  }, [state.status])

  // Identity check runs once, independent of the raffle poll above.
  useEffect(() => {
    if (state.status !== 'ready') return
    ;(async () => {
      try {
        const idToken = await getLiffIdToken()
        if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
        const meRes = await fetch('/api/identity/me', { headers: { 'x-line-id-token': idToken } })
        const meData = await meRes.json() as MeResponse
        if (!meRes.ok || !meData.ok) throw new Error(`HTTP ${meRes.status}`)
        setIdentified(!!meData.identified)
      } catch (e) {
        setError(e instanceof Error ? e.message : '載入失敗，請稍後再試')
      }
    })()
  }, [state.status])

  async function enter(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
      const res = await fetch('/api/raffle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: identified
          ? undefined
          : JSON.stringify({ realName: form.realName, diet: form.diet }),
      })
      const data = await res.json() as { ok?: boolean; total?: number; error?: string }
      if (!res.ok || !data.ok) {
        // Defensive: server still says a name is needed (e.g. identity check
        // above was stale) — fall back to showing the name field instead of
        // a dead-end error.
        if (data.error === 'name_required') {
          setIdentified(false)
          throw new Error('請先填寫姓名')
        }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setEntered(true)
      setTotalCount(data.total ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '報名失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
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

  const profile = state.profile

  return (
    <main className="mx-auto max-w-md px-6 py-10 text-center">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">LUCKY DRAW</p>
        <h1 className="mt-2 text-2xl">婚禮抽獎</h1>
        <p className="mt-3 text-sm text-ink/60">嗨，{profile.displayName}</p>
      </header>

      {win && (
        <div className="mb-6">
          <StatusBanner kind="success">
            🎉 恭喜中獎：{win.prizeName}！請到主桌附近找工作人員領獎。
          </StatusBanner>
        </div>
      )}
      {mode === 'on' && !win && (
        <div className="mb-6">
          <StatusBanner kind="info">抽獎進行中，請盯著大螢幕！</StatusBanner>
        </div>
      )}

      {entered === true ? (
        <div>
          <h2 className="text-3xl">報名完成 🎉</h2>
          <p className="mt-4 text-ink/70">
            開獎時會在現場大螢幕公布得獎者，
            <br />記得留在現場，人不在會重抽喔！
          </p>
          {totalCount !== null && (
            <p className="mt-6 text-sm text-ink/50">目前共 {totalCount} 人參加</p>
          )}
        </div>
      ) : identified === false ? (
        <div>
          <p className="text-ink/70">
            第一次來，先留下真實姓名讓我們對得上，
            <br />之後報名就不用再填囉。
          </p>
          <form onSubmit={enter} className="mt-8 space-y-5 text-left">
            <Field label="你的真實姓名">
              <input
                type="text" required className="field-input"
                name="realName" autoComplete="name"
                value={form.realName}
                onChange={e => setForm({ ...form, realName: e.target.value })}
              />
            </Field>
            <Field label="你的飲食需求">
              <Select
                value={form.diet}
                onChange={v => setForm({ ...form, diet: v })}
                options={[...DIET_OPTIONS]}
              />
            </Field>
            {error && <StatusBanner kind="error">{error}</StatusBanner>}
            <button
              type="submit"
              disabled={submitting || !form.realName.trim()}
              className="btn-primary w-full"
            >
              {submitting ? '報名中…' : '參加抽獎 🎁'}
            </button>
          </form>
          {totalCount !== null && (
            <p className="mt-6 text-sm text-ink/50">目前共 {totalCount} 人參加</p>
          )}
        </div>
      ) : (
        <div>
          <p className="text-ink/70">
            一鍵報名，用你的 LINE 身分參加。
            <br />每人一票，中獎需在現場領獎。
          </p>
          {error && (
            <div className="mt-4">
              <StatusBanner kind="error">{error}</StatusBanner>
            </div>
          )}
          <button
            className="btn-primary mt-8 w-full"
            disabled={submitting || entered === null || identified === null}
            onClick={() => enter()}
          >
            {submitting ? '報名中…' : entered === null || identified === null ? '載入中…' : '參加抽獎 🎁'}
          </button>
          {totalCount !== null && (
            <p className="mt-6 text-sm text-ink/50">目前共 {totalCount} 人參加</p>
          )}
        </div>
      )}
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

function Select({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className="field-input" name="diet" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

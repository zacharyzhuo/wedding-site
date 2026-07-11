'use client'

// LIFF: 入團 — opened via the RSVP leader's share link/QR (?party=<code>).
// A companion adds the OA (implicit — they had to open a LINE link), then
// self-identifies (real name + diet) and binds to the leader's party. Unlike
// the leader's RSVP form, this never creates a party: a missing/stale code
// is a friendly dead end pointing back at the OA, not a form.

import { useEffect, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { DIET_OPTIONS } from '@/lib/diet'

const ADD_FRIEND_URL =
  process.env.NEXT_PUBLIC_LINE_OA_ADD_FRIEND_URL ?? 'https://line.me/R/ti/p/@160vcltf'

type MeResponse = {
  ok?: boolean
  identified?: boolean
  party?: { partyId: string; leaderName: string | null } | null
}
type JoinResponse = { ok?: boolean; leaderName?: string | null; error?: string }

// 'unknown' until the URL is readable client-side (see /screen's identical
// pattern for why this can't be read at render time during static export).
type PartyCode = { status: 'unknown' } | { status: 'missing' } | { status: 'found'; code: string }

// Distinguishes "haven't checked /api/identity/me yet" from "checked, not
// part of this party yet" from "checked, already joined — here's who led it".
type MeCheck =
  | { status: 'checking' }
  | { status: 'not-joined' }
  | { status: 'already'; leaderName: string | null }

type FormState = { realName: string; diet: string }
const initialForm: FormState = { realName: '', diet: DIET_OPTIONS[0] }

export default function JoinLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_JOIN
  const liffState = useLiffProfile(liffId)

  const [partyCode, setPartyCode] = useState<PartyCode>({ status: 'unknown' })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const code = new URL(window.location.href).searchParams.get('party')?.trim() ?? ''
    setPartyCode(code ? { status: 'found', code } : { status: 'missing' })
  }, [])

  const [meCheck, setMeCheck] = useState<MeCheck>({ status: 'checking' })
  const [checkError, setCheckError] = useState<string | null>(null)

  // Once LIFF identity is ready and the party code is known, check whether
  // this guest is already identified into this exact party — avoids
  // re-showing the form to someone who reopens the same link.
  useEffect(() => {
    if (liffState.status !== 'ready' || partyCode.status !== 'found') return
    let cancelled = false
    ;(async () => {
      try {
        const idToken = await getLiffIdToken()
        if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
        const res = await fetch('/api/identity/me', { headers: { 'x-line-id-token': idToken } })
        const data = await res.json() as MeResponse
        if (!res.ok || !data.ok) throw new Error(`HTTP ${res.status}`)
        if (cancelled) return
        if (data.identified && data.party?.partyId === partyCode.code) {
          setMeCheck({ status: 'already', leaderName: data.party.leaderName ?? null })
        } else {
          setMeCheck({ status: 'not-joined' })
        }
      } catch (e) {
        if (!cancelled) setCheckError(e instanceof Error ? e.message : '載入失敗，請稍後再試')
      }
    })()
    return () => { cancelled = true }
  }, [liffState.status, partyCode])

  const [form, setForm] = useState<FormState>(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [invalidParty, setInvalidParty] = useState(false)
  const [joined, setJoined] = useState(false)
  const [joinedLeaderName, setJoinedLeaderName] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (partyCode.status !== 'found') return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
      const res = await fetch('/api/party/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({ partyId: partyCode.code, realName: form.realName, diet: form.diet }),
      })
      if (res.status === 404) { setInvalidParty(true); return }
      const data = await res.json() as JoinResponse
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setJoinedLeaderName(data.leaderName ?? null)
      setJoined(true)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '送出失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  // --- render, most specific state first ---

  if (partyCode.status === 'missing' || invalidParty) {
    return <InvalidLinkNotice />
  }
  if (partyCode.status === 'unknown' || liffState.status === 'loading') {
    return <Centered><p className="text-ink/60">載入中…</p></Centered>
  }
  if (liffState.status === 'error') {
    return <Centered>
      <p className="text-ink/80">無法載入 LINE 資料</p>
      <p className="text-sm text-ink/50 mt-2">{liffState.message}</p>
    </Centered>
  }
  if (joined) {
    return (
      <Centered>
        <h1 className="text-3xl">加入{joinedLeaderName ?? '對方'}那一團完成 ❤</h1>
        <p className="mt-4 text-ink/70">期待 2027/06/05 與您相見。</p>
      </Centered>
    )
  }
  if (checkError) {
    return <Centered>
      <p className="text-ink/80">載入失敗</p>
      <p className="text-sm text-ink/50 mt-2">{checkError}</p>
    </Centered>
  }
  if (meCheck.status === 'checking') {
    return <Centered><p className="text-ink/60">確認身分中…</p></Centered>
  }
  if (meCheck.status === 'already') {
    return (
      <Centered>
        <h1 className="text-3xl">你已加入{meCheck.leaderName ?? '對方'}那一團 ❤</h1>
        <p className="mt-4 text-ink/70">期待 2027/06/05 與您相見。</p>
      </Centered>
    )
  }

  const profile = liffState.profile

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">JOIN</p>
        <h1 className="mt-2 text-2xl">加入同行的團</h1>
        <p className="mt-3 text-sm text-ink/60">您好，{profile.displayName}</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="你的真實姓名">
          <input
            type="text" required className="field-input"
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

        {submitError && <p className="text-red-600 text-sm">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting || !form.realName.trim()}
          className="btn-primary w-full"
        >
          {submitting ? '送出中…' : '加入這一團'}
        </button>
      </form>
    </main>
  )
}

function InvalidLinkNotice() {
  return (
    <Centered>
      <h1 className="text-2xl">連結無效，請向邀請你的人索取新連結</h1>
      <p className="mt-4 text-ink/70">
        還沒加入婚禮官方帳號嗎？加入後也能直接回覆出席。
      </p>
      <a href={ADD_FRIEND_URL} className="btn-primary mt-8 inline-block">
        加入官方帳號
      </a>
    </Centered>
  )
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
    <select className="field-input" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
}

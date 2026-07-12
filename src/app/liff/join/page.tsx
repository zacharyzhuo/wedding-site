'use client'

// LIFF: 入團 — opened via the RSVP leader's share link/QR (?party=<code>).
// A companion adds the OA (implicit — they had to open a LINE link), then
// self-identifies (real name + diet) and binds to the leader's party. Unlike
// the leader's RSVP form, this never creates a party: a missing/stale code
// is a friendly dead end pointing back at the OA, not a form.

import { useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { DIET_OPTIONS, buildDietValue, needsDietDetail } from '@/lib/diet'
import { Field, SelectField, Spinner, StatusBanner } from '@/components/ui'
import { mapApiError } from '@/lib/api-errors'

const GENERIC_ERROR = '送出失敗，請稍後再試，或直接聯絡新人'
const LINE_TIMEOUT_ERROR = 'LINE 連線逾時了，請關掉頁面、從官方帳號選單重新打開'
const ADD_FRIEND_URL =
  process.env.NEXT_PUBLIC_LINE_OA_ADD_FRIEND_URL ?? 'https://line.me/R/ti/p/@160vcltf'
const RSVP_LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID_RSVP}`

type MeResponse = {
  ok?: boolean
  identified?: boolean
  party?: { partyId: string; leaderName: string | null } | null
}
type JoinResponse = { ok?: boolean; leaderName?: string | null; mismatch?: boolean; error?: string }
type CodeCheckResponse = { ok?: boolean; leaderName?: string | null; error?: string }

// 'unknown' until the URL is readable client-side (see /screen's identical
// pattern for why this can't be read at render time during static export).
type PartyCode = { status: 'unknown' } | { status: 'missing' } | { status: 'found'; code: string }

// Contract 3 preflight (GET /api/party/join?code=X): tells "bad link" apart
// from "valid, here's who's leading it" before the guest fills anything in,
// so an invalid link never wastes their time on a form that will 404.
type CodeCheck =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'valid'; leaderName: string | null }

// Distinguishes "haven't checked /api/identity/me yet" from "checked, not
// part of this party yet" from "checked, already joined — here's who led it".
type MeCheck =
  | { status: 'checking' }
  | { status: 'not-joined' }
  | { status: 'already'; leaderName: string | null }

type FormState = { realName: string; diet: string; dietDetail: string }
const initialForm: FormState = { realName: '', diet: DIET_OPTIONS[0], dietDetail: '' }

export default function JoinLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_JOIN
  const liffState = useLiffProfile(liffId)

  const [partyCode, setPartyCode] = useState<PartyCode>({ status: 'unknown' })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const code = new URL(window.location.href).searchParams.get('party')?.trim() ?? ''
    setPartyCode(code ? { status: 'found', code } : { status: 'missing' })
  }, [])

  const [codeCheck, setCodeCheck] = useState<CodeCheck>({ status: 'checking' })
  const [codeCheckError, setCodeCheckError] = useState<string | null>(null)

  // Runs independently of LIFF login readiness — it's an unauthenticated
  // read, so there's no reason to make the guest wait for LINE login to
  // find out their link is already dead.
  useEffect(() => {
    if (partyCode.status !== 'found') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/party/join?code=${encodeURIComponent(partyCode.code)}`)
        if (res.status === 404) { if (!cancelled) setCodeCheck({ status: 'invalid' }); return }
        const data = await res.json() as CodeCheckResponse
        if (!res.ok || !data.ok) throw new Error(data.error ? mapApiError(data.error) : GENERIC_ERROR)
        if (!cancelled) setCodeCheck({ status: 'valid', leaderName: data.leaderName ?? null })
      } catch (e) {
        if (!cancelled) setCodeCheckError(e instanceof Error ? e.message : '載入失敗，請稍後再試')
      }
    })()
    return () => { cancelled = true }
  }, [partyCode])

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
        if (!idToken) throw new Error(LINE_TIMEOUT_ERROR)
        const res = await fetch('/api/identity/me', { headers: { 'x-line-id-token': idToken } })
        const data = await res.json() as MeResponse
        if (!res.ok || !data.ok) throw new Error(GENERIC_ERROR)
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
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [invalidParty, setInvalidParty] = useState(false)
  const [joined, setJoined] = useState(false)
  const [joinedLeaderName, setJoinedLeaderName] = useState<string | null>(null)
  const [joinedMismatch, setJoinedMismatch] = useState(false)
  const realNameRef = useRef<HTMLInputElement>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (partyCode.status !== 'found') return
    const trimmedName = form.realName.trim()
    if (!trimmedName) {
      setNameError('請輸入姓名')
      setSubmitError('請輸入姓名')
      realNameRef.current?.focus()
      return
    }
    setNameError(undefined)
    setSubmitError(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error(LINE_TIMEOUT_ERROR)
      const res = await fetch('/api/party/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({
          partyId: partyCode.code,
          realName: trimmedName,
          diet: buildDietValue(form.diet, form.dietDetail),
        }),
      })
      if (res.status === 404) { setInvalidParty(true); return }
      const data = await res.json() as JoinResponse
      if (!res.ok || !data.ok) throw new Error(data.error ? mapApiError(data.error) : GENERIC_ERROR)
      setJoinedLeaderName(data.leaderName ?? null)
      setJoinedMismatch(!!data.mismatch)
      setJoined(true)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : GENERIC_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  // --- render, most specific state first ---

  if (partyCode.status === 'missing' || invalidParty || codeCheck.status === 'invalid') {
    return <InvalidLinkNotice />
  }
  if (partyCode.status === 'unknown' || liffState.status === 'loading' || codeCheck.status === 'checking') {
    return <Centered><Spinner /></Centered>
  }
  if (codeCheckError) {
    return <Centered>
      <p className="text-ink/80">載入失敗</p>
      <p className="text-sm text-ink/50 mt-2">{codeCheckError}</p>
    </Centered>
  }
  if (liffState.status === 'error') {
    return <Centered>
      <p className="text-ink/80">無法載入 LINE 資料</p>
      <p className="text-sm text-ink/50 mt-2">{liffState.message}</p>
    </Centered>
  }
  if (joined) {
    if (joinedMismatch) {
      return (
        <Centered>
          <StatusBanner kind="info">
            你已經是「{joinedLeaderName ?? '對方'}」那一團的成員，不會重複計算。如需調整請至 RSVP 頁面修改。
          </StatusBanner>
        </Centered>
      )
    }
    return (
      <Centered>
        <h1 className="text-3xl">加入{joinedLeaderName ?? '對方'}那一團完成</h1>
        <p className="mt-4 text-ink/70">期待 2027/06/05 與你相見。</p>
        <UpdateLaterHint />
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
    return <Centered><Spinner label="確認身分中…" /></Centered>
  }
  if (meCheck.status === 'already') {
    return (
      <Centered>
        <h1 className="text-3xl">你已加入{meCheck.leaderName ?? '對方'}那一團</h1>
        <p className="mt-4 text-ink/70">期待 2027/06/05 與你相見。</p>
        <UpdateLaterHint />
      </Centered>
    )
  }

  const profile = liffState.profile
  const leaderName = codeCheck.status === 'valid' ? codeCheck.leaderName : null

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">JOIN</p>
        <h1 className="mt-2 text-2xl">加入{leaderName ?? '對方'}那一團</h1>
        <p className="mt-3 text-sm text-ink/60">嗨，{profile.displayName}</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="你的姓名（方便核對名單、安排座位）" error={nameError}>
          <input
            ref={realNameRef}
            type="text" name="realName" autoComplete="name" className="field-input"
            value={form.realName}
            onChange={e => setForm({ ...form, realName: e.target.value })}
          />
        </Field>

        <SelectField
          label="你的飲食需求" name="diet" value={form.diet}
          onChange={v => setForm({ ...form, diet: v, dietDetail: needsDietDetail(v) ? form.dietDetail : '' })}
          options={DIET_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        {needsDietDetail(form.diet) && (
          <Field label="過敏原或其他說明（會轉達給餐廳）">
            <input
              type="text" name="dietDetail" autoComplete="off" className="field-input"
              value={form.dietDetail}
              onChange={e => setForm({ ...form, dietDetail: e.target.value })}
            />
          </Field>
        )}

        {submitError && <StatusBanner kind="error">{submitError}</StatusBanner>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? '送出中…' : '加入這一團'}
        </button>
      </form>
    </main>
  )
}

function UpdateLaterHint() {
  return (
    <p className="mt-6 text-sm text-ink/50">
      之後想更新飲食需求或姓名，到<a className="underline underline-offset-4" href={RSVP_LIFF_URL}>回覆出席</a>頁面即可修改。
    </p>
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

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
}

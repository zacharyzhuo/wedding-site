'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { DIET_OPTIONS } from '@/lib/diet'
import { toSvgMarkup } from '@/lib/qr'

// Field shape follows the party-identity field model (§4.5): the leader
// submits party-level fields (side/relationship/attending/counts/notes) plus
// their own identity (realName/leaderDiet). The rest of the party joins
// later via the share link this form returns — see joinUrl in ShareBlock.
type FormState = {
  realName: string
  side: '男方' | '女方' | ''
  relationship: '家長' | '親戚' | '朋友' | ''
  attending: '出席' | '不克出席' | ''
  adultCount: string       // keep as string for form input; coerce on submit
  childCount: string
  childSeatCount: string
  leaderDiet: string
  notes: string
  message: string
}

const initial: FormState = {
  realName: '',
  side: '', relationship: '', attending: '',
  adultCount: '1', childCount: '0', childSeatCount: '0',
  leaderDiet: '無特殊需求', notes: '', message: '',
}

type MeResponse = {
  ok?: boolean
  identified?: boolean
  role?: 'leader' | 'member' | 'solo' | null
  realName?: string | null
  diet?: string | null
  party?: {
    partyId: string
    leaderName: string | null
    // Present only for the leader of this party (from /api/identity/me):
    side?: string
    relationship?: string
    attending?: string
    adultCount?: number
    childCount?: number
    childSeatCount?: number
    notes?: string | null
    message?: string | null
    identifiedCount?: number
  } | null
  error?: string
}

// A party MEMBER shouldn't see the leader form at all — submitting it would
// wrongly promote them via mergeIdentity's role-adoption rule (see
// _lib/identity.ts), detaching them from their real party. 'checking' guards
// against a flash of the leader form before /api/identity/me resolves.
type MeCheck =
  | { status: 'checking' }
  | { status: 'leader-form' }
  | { status: 'leader-done'; joinUrl: string }
  | { status: 'member'; leaderName: string | null; diet: string | null }

export default function RsvpLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_RSVP
  const state = useLiffProfile(liffId)
  const [form, setForm] = useState<FormState>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [meCheck, setMeCheck] = useState<MeCheck>({ status: 'checking' })
  const [meCheckError, setMeCheckError] = useState<string | null>(null)
  // A leader who already submitted lands on the "here's your link again" view;
  // this lets them opt back into the form to revise their answers.
  const [forceForm, setForceForm] = useState(false)
  // The leader's own submitted answers, so tapping "edit" pre-fills the form
  // instead of making them re-type everything.
  const [leaderPrefill, setLeaderPrefill] = useState<FormState | null>(null)

  useEffect(() => {
    if (state.status !== 'ready') return
    let cancelled = false
    ;(async () => {
      try {
        const idToken = await getLiffIdToken()
        if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
        const res = await fetch('/api/identity/me', { headers: { 'x-line-id-token': idToken } })
        const data = await res.json() as MeResponse
        if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        if (cancelled) return
        if (data.role === 'member') {
          setMeCheck({ status: 'member', leaderName: data.party?.leaderName ?? null, diet: data.diet ?? null })
        } else if (data.role === 'leader' && data.party?.partyId) {
          // Leader already created their party — re-opening RSVP should surface
          // the share link again, not a blank form. Build the join URL the same
          // way /api/rsvp does (join LIFF id + party code), and stash their
          // answers so an edit pre-fills the form.
          const joinLiffId = process.env.NEXT_PUBLIC_LIFF_ID_JOIN
          const p = data.party
          setLeaderPrefill({
            realName: data.realName ?? '',
            side: (p.side as FormState['side']) ?? '',
            relationship: (p.relationship as FormState['relationship']) ?? '',
            attending: (p.attending as FormState['attending']) ?? '',
            adultCount: String(p.adultCount ?? 1),
            childCount: String(p.childCount ?? 0),
            childSeatCount: String(p.childSeatCount ?? 0),
            leaderDiet: data.diet || '無特殊需求',
            notes: p.notes ?? '',
            message: p.message ?? '',
          })
          setMeCheck({ status: 'leader-done', joinUrl: `https://liff.line.me/${joinLiffId}?party=${p.partyId}` })
        } else {
          setMeCheck({ status: 'leader-form' })
        }
      } catch (e) {
        if (!cancelled) setMeCheckError(e instanceof Error ? e.message : '載入失敗，請稍後再試')
      }
    })()
    return () => { cancelled = true }
  }, [state.status])

  if (state.status === 'loading') {
    return <Centered><p className="text-ink/60">載入中…</p></Centered>
  }
  if (state.status === 'error') {
    return <Centered>
      <p className="text-ink/80">無法載入 LINE 資料</p>
      <p className="text-sm text-ink/50 mt-2">{state.message}</p>
    </Centered>
  }
  if (meCheckError) {
    return <Centered>
      <p className="text-ink/80">載入失敗</p>
      <p className="text-sm text-ink/50 mt-2">{meCheckError}</p>
    </Centered>
  }
  if (meCheck.status === 'checking') {
    return <Centered><p className="text-ink/60">確認身分中…</p></Centered>
  }
  if (meCheck.status === 'member') {
    return <MemberDedupView leaderName={meCheck.leaderName} initialDiet={meCheck.diet} />
  }
  if (meCheck.status === 'leader-done' && !forceForm) {
    return (
      <LeaderDoneView
        joinUrl={meCheck.joinUrl}
        onEdit={() => { if (leaderPrefill) setForm(leaderPrefill); setForceForm(true) }}
      />
    )
  }

  const profile = state.profile

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({
          source: 'liff',
          ...form,
          adultCount: Number(form.adultCount) || 1,
          childCount: Number(form.childCount) || 0,
          childSeatCount: Number(form.childSeatCount) || 0,
        }),
      })
      const data = await res.json() as { ok?: boolean; joinUrl?: string; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      // Route straight to the leader "done" view (share link + live progress);
      // remember what was just submitted so a follow-up edit pre-fills.
      setLeaderPrefill(form)
      setForceForm(false)
      setMeCheck({ status: 'leader-done', joinUrl: data.joinUrl ?? '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '送出失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">RSVP</p>
        <h1 className="mt-2 text-2xl">回覆出席</h1>
        <p className="mt-3 text-sm text-ink/60">
          您好，{profile.displayName}
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="你的真實姓名">
          <input
            type="text" required className="field-input"
            value={form.realName}
            onChange={e => setForm({ ...form, realName: e.target.value })}
          />
        </Field>

        <Field label="您是男方還是女方的賓客？">
          <Select
            value={form.side}
            onChange={v => setForm({ ...form, side: v as FormState['side'] })}
            options={['男方', '女方']}
          />
        </Field>

        <Field label="與新人的關係">
          <Select
            value={form.relationship}
            onChange={v => setForm({ ...form, relationship: v as FormState['relationship'] })}
            options={['家長', '親戚', '朋友']}
          />
        </Field>

        <Field label="是否出席">
          <Select
            value={form.attending}
            onChange={v => setForm({ ...form, attending: v as FormState['attending'] })}
            options={['出席', '不克出席']}
          />
        </Field>

        {form.attending === '出席' && (
          <>
            <Field label="大人人數（含本人）">
              <input
                type="number" min={1} className="field-input"
                value={form.adultCount}
                onChange={e => setForm({ ...form, adultCount: e.target.value })}
              />
            </Field>
            <Field label="兒童人數">
              <input
                type="number" min={0} className="field-input"
                value={form.childCount}
                onChange={e => {
                  const childCount = e.target.value
                  // Keep the seat count from silently exceeding the new child
                  // count (e.g. dropping childCount from 3 to 1 after having
                  // set childSeatCount to 3).
                  const seatCap = Number(childCount) || 0
                  const childSeatCount = Math.min(Number(form.childSeatCount) || 0, seatCap).toString()
                  setForm({ ...form, childCount, childSeatCount })
                }}
              />
            </Field>
            <Field label="其中需要兒童椅">
              <input
                type="number" min={0} max={Number(form.childCount) || 0} className="field-input"
                value={form.childSeatCount}
                onChange={e => setForm({ ...form, childSeatCount: e.target.value })}
              />
            </Field>
            <Field label="你的飲食需求">
              <Select
                value={form.leaderDiet}
                onChange={v => setForm({ ...form, leaderDiet: v })}
                options={[...DIET_OPTIONS]}
              />
            </Field>
          </>
        )}

        <Field
          label="備註（幫不用 LINE 的同行者代填）"
          hint="會用 LINE 的大人，等一下把你拿到的連結傳給他，讓他自己加入就好。這欄只填「不會用 LINE、需要你代填」的人（例如長輩、小孩）：他們的姓名、素食／過敏、兒童餐或兒童椅需求。"
        >
          <textarea
            rows={3} className="field-input"
            placeholder="例：我爸媽兩位不用 LINE，都吃素；小孩 1 位要兒童餐 + 兒童椅"
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <Field label="想對新人說的話">
          <textarea
            rows={3} className="field-input"
            value={form.message}
            onChange={e => setForm({ ...form, message: e.target.value })}
          />
        </Field>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !form.realName || !form.side || !form.relationship || !form.attending}
          className="btn-primary w-full"
        >
          {submitting ? '送出中…' : '送出回覆'}
        </button>
      </form>
    </main>
  )
}

// Shown to a party MEMBER instead of the leader form (see MeCheck above):
// the leader already answered for the whole party, so all this guest needs
// is a way to keep their own diet up to date.
function MemberDedupView({
  leaderName, initialDiet,
}: { leaderName: string | null; initialDiet: string | null }) {
  const validInitialDiet = initialDiet && (DIET_OPTIONS as readonly string[]).includes(initialDiet)
    ? initialDiet
    : DIET_OPTIONS[0]
  const [diet, setDiet] = useState(validInitialDiet)
  const [submitting, setSubmitting] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedMsg(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error('LINE 登入逾時，請重新進入。')
      const res = await fetch('/api/party/member-diet', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({ diet }),
      })
      const data = await res.json() as { ok?: boolean; diet?: string; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSavedMsg('已更新你的飲食需求 ❤')
    } catch (e) {
      setError(e instanceof Error ? e.message : '送出失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-2xl">
        你是{leaderName ?? '對方'}那一團，團長已回覆出席 ❤
      </h1>
      <p className="mt-4 text-ink/70">期待 2027/06/05 與您相見。</p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5 text-left">
        <Field label="更新我的飲食需求">
          <Select value={diet} onChange={setDiet} options={[...DIET_OPTIONS]} includeBlank={false} />
        </Field>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {savedMsg && <p className="text-sm text-ink/70">{savedMsg}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? '送出中…' : '更新'}
        </button>
      </form>
    </main>
  )
}

// Shown once the leader's RSVP is recorded. joinUrl carries the party code;
// sharing it (via LINE's native picker, a copied link, or the QR) is how the
// rest of the party gets added without re-typing the leader's answers.
// Shown to a leader who has already submitted (re-opening RSVP), so their
// share link is one tap away instead of buried behind re-filling the form.
function LeaderDoneView({ joinUrl, onEdit }: { joinUrl: string; onEdit: () => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadProgress = useCallback(async () => {
    setRefreshing(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) return
      const res = await fetch('/api/identity/me', { headers: { 'x-line-id-token': idToken } })
      const data = await res.json() as MeResponse
      if (res.ok && data.ok && data.party?.adultCount != null) {
        setProgress({ done: data.party.identifiedCount ?? 1, total: data.party.adultCount })
      }
    } catch {
      // progress is a convenience; the share link below works regardless
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadProgress() }, [loadProgress])

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-2xl">你的回覆已送出 ❤</h1>
      <p className="mt-4 text-ink/70">把下面的連結傳給同行的人，他們加入就完成登記。</p>

      {progress && (
        <div className="mt-6 rounded-2xl border border-champagne bg-white/70 p-5">
          <p className="text-sm text-ink/60">同行大人 LINE 登記進度</p>
          <p className="mt-1 font-serif text-4xl text-ink">
            {progress.done}<span className="mx-1 text-ink/30">/</span>{progress.total}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink/45">
            不用 LINE 的長輩由你在備註代填、不會自己登記，所以這裡可能不會填滿。
          </p>
          <button
            type="button"
            className="mt-3 text-xs text-accent underline underline-offset-4 disabled:opacity-50"
            onClick={loadProgress}
            disabled={refreshing}
          >
            {refreshing ? '更新中…' : '重新整理進度'}
          </button>
        </div>
      )}

      <ShareBlock joinUrl={joinUrl} />
      <button type="button" className="btn-outline mt-6" onClick={onEdit}>
        需要修改回覆？重新填寫
      </button>
    </main>
  )
}

function ShareBlock({ joinUrl }: { joinUrl: string }) {
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    toSvgMarkup(joinUrl)
      .then(svg => { if (!cancelled) setQrSvg(svg) })
      .catch(() => { /* QR is a convenience; link + copy still work without it */ })
    return () => { cancelled = true }
  }, [joinUrl])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can be unavailable in some in-app webviews — the link
      // text below is still visible for a manual copy.
    }
  }

  // Share cascade: LINE's own picker (best inside LINE — pick a LINE contact
  // and send in one step) → the OS native share sheet (which also routes to
  // LINE) → copy as a last resort. Always shown, since there's always a path.
  async function share() {
    const text = `一起參加卓育辰＆楊皖淩的婚禮吧！點連結登記出席：${joinUrl}`
    try {
      const liff = (await import('@line/liff')).default
      if (liff.isApiAvailable('shareTargetPicker')) {
        await liff.shareTargetPicker([{ type: 'text', text }])
        return
      }
    } catch {
      // picker unavailable / cancelled → try the OS share sheet
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try { await navigator.share({ text }) } catch { /* user cancelled — non-fatal */ }
      return
    }
    copyLink()
  }

  return (
    <div className="mt-10 rounded-2xl border border-champagne bg-white/70 p-6">
      <p className="text-ink/80">
        把這個連結傳給同行的人，他們加入就完成登記
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button type="button" className="btn-primary" onClick={share}>
          分享給同行的人
        </button>
        <button type="button" className="btn-outline" onClick={copyLink}>
          {copied ? '已複製' : '複製連結'}
        </button>
      </div>
      <p className="mt-3 break-all rounded-md bg-champagne/30 px-3 py-2 text-xs text-ink/60">
        {joinUrl}
      </p>
      {qrSvg && (
        <div
          className="mx-auto mt-6 h-40 w-40 [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {hint && <span className="mt-1 mb-1 block text-xs leading-relaxed text-ink/50">{hint}</span>}
      {children}
    </label>
  )
}

function Select({
  value, onChange, options, includeBlank = true,
}: { value: string; onChange: (v: string) => void; options: string[]; includeBlank?: boolean }) {
  return (
    <select
      className="field-input"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {includeBlank && <option value="">請選擇</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
  )
}

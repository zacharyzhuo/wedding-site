'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { DIET_OPTIONS, buildDietValue, needsDietDetail, splitDietDetail } from '@/lib/diet'
import { toSvgMarkup } from '@/lib/qr'
import { Field, SelectField, Spinner, StatusBanner, Card } from '@/components/ui'
import { mapApiError } from '@/lib/api-errors'

const GENERIC_ERROR = '送出失敗，請稍後再試，或直接聯絡新人'
const LINE_TIMEOUT_ERROR = 'LINE 連線逾時了，請關掉頁面、從官方帳號選單重新打開'

// Field shape follows the party-identity field model (§4.5): the leader
// submits party-level fields (side/relationship/attending/counts/notes) plus
// their own identity (realName/leaderDiet). The rest of the party joins
// later via the share link this form returns — see joinUrl in ShareBlock.
// leaderDiet always holds a bare DIET_OPTIONS value (never the merged
// "食物過敏（花生）" form) — leaderDietDetail carries the free text
// separately, merged via buildDietValue only at submit time.
type FormState = {
  realName: string
  side: '男方' | '女方' | ''
  relationship: '家長' | '親戚' | '朋友' | ''
  attending: '出席' | '不克出席' | ''
  adultCount: string       // keep as string for form input; coerce on submit
  childCount: string
  childSeatCount: string
  leaderDiet: string
  leaderDietDetail: string
  notes: string
  message: string
}

const initial: FormState = {
  realName: '',
  side: '', relationship: '', attending: '',
  adultCount: '1', childCount: '0', childSeatCount: '0',
  leaderDiet: '無特殊需求', leaderDietDetail: '', notes: '', message: '',
}

type FieldErrors = Partial<Record<'realName' | 'side' | 'relationship' | 'attending', string>>

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
  | { status: 'leader-done'; joinUrl: string; attending: string }
  | { status: 'member'; leaderName: string | null; diet: string | null; realName: string | null }

export default function RsvpLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_RSVP
  const state = useLiffProfile(liffId)
  const [form, setForm] = useState<FormState>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const realNameRef = useRef<HTMLInputElement>(null)
  const sideRef = useRef<HTMLSelectElement>(null)
  const relationshipRef = useRef<HTMLSelectElement>(null)
  const attendingRef = useRef<HTMLSelectElement>(null)

  const [meCheck, setMeCheck] = useState<MeCheck>({ status: 'checking' })
  const [meCheckError, setMeCheckError] = useState<string | null>(null)
  // A leader who already submitted lands on the "here's your link again" view;
  // this lets them opt back into the form to revise their answers.
  const [forceForm, setForceForm] = useState(false)
  // The leader's own submitted answers, so tapping "edit" pre-fills the form
  // instead of making them re-type everything. Also doubles as the "is there
  // a previous answer to cancel back to" flag for the edit form's 取消 link.
  const [leaderPrefill, setLeaderPrefill] = useState<FormState | null>(null)

  useEffect(() => {
    if (state.status !== 'ready') return
    let cancelled = false
    ;(async () => {
      try {
        const idToken = await getLiffIdToken()
        if (!idToken) throw new Error(LINE_TIMEOUT_ERROR)
        const res = await fetch('/api/identity/me', { headers: { 'x-line-id-token': idToken } })
        const data = await res.json() as MeResponse
        if (!res.ok || !data.ok) throw new Error(data.error ? mapApiError(data.error) : GENERIC_ERROR)
        if (cancelled) return
        if (data.role === 'member') {
          setMeCheck({
            status: 'member',
            leaderName: data.party?.leaderName ?? null,
            diet: data.diet ?? null,
            realName: data.realName ?? null,
          })
        } else if (data.role === 'leader' && data.party?.partyId) {
          // Leader already created their party — re-opening RSVP should surface
          // the share link again, not a blank form. Build the join URL the same
          // way /api/rsvp does (join LIFF id + party code), and stash their
          // answers so an edit pre-fills the form.
          const joinLiffId = process.env.NEXT_PUBLIC_LIFF_ID_JOIN
          const p = data.party
          const { base: dietBase, detail: dietDetail } = splitDietDetail(data.diet || '無特殊需求')
          setLeaderPrefill({
            realName: data.realName ?? '',
            side: (p.side as FormState['side']) ?? '',
            relationship: (p.relationship as FormState['relationship']) ?? '',
            attending: (p.attending as FormState['attending']) ?? '',
            adultCount: String(p.adultCount ?? 1),
            childCount: String(p.childCount ?? 0),
            childSeatCount: String(p.childSeatCount ?? 0),
            leaderDiet: dietBase,
            leaderDietDetail: dietDetail,
            notes: p.notes ?? '',
            message: p.message ?? '',
          })
          setMeCheck({
            status: 'leader-done',
            joinUrl: `https://liff.line.me/${joinLiffId}?party=${p.partyId}`,
            attending: p.attending ?? '出席',
          })
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
    return <Centered><Spinner /></Centered>
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
    return <Centered><Spinner label="確認身分中…" /></Centered>
  }
  if (meCheck.status === 'member') {
    return (
      <MemberDedupView
        leaderName={meCheck.leaderName}
        initialDiet={meCheck.diet}
        initialRealName={meCheck.realName}
      />
    )
  }
  if (meCheck.status === 'leader-done' && !forceForm) {
    return (
      <LeaderDoneView
        joinUrl={meCheck.joinUrl}
        attending={meCheck.attending}
        onEdit={() => { if (leaderPrefill) setForm(leaderPrefill); setForceForm(true) }}
      />
    )
  }

  const profile = state.profile

  function validate(): boolean {
    const next: FieldErrors = {}
    if (!form.realName.trim()) next.realName = '請輸入姓名'
    if (!form.side) next.side = '請選擇你是男方或女方的賓客'
    if (!form.relationship) next.relationship = '請選擇與新人的關係'
    if (!form.attending) next.attending = '請選擇是否出席'
    setFieldErrors(next)

    const order: Array<[keyof FieldErrors, React.RefObject<HTMLElement | null>]> = [
      ['realName', realNameRef], ['side', sideRef], ['relationship', relationshipRef], ['attending', attendingRef],
    ]
    const firstInvalid = order.find(([key]) => next[key])
    if (firstInvalid) {
      setError(next[firstInvalid[0]]!)
      firstInvalid[1].current?.focus()
      return false
    }
    setError(null)
    return true
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error(LINE_TIMEOUT_ERROR)
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({
          source: 'liff',
          ...form,
          leaderDiet: buildDietValue(form.leaderDiet, form.leaderDietDetail),
          adultCount: Number(form.adultCount) || 1,
          childCount: Number(form.childCount) || 0,
          childSeatCount: Number(form.childSeatCount) || 0,
        }),
      })
      const data = await res.json() as { ok?: boolean; joinUrl?: string; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ? mapApiError(data.error) : GENERIC_ERROR)
      // Route straight to the leader "done" view (share link + live progress);
      // remember what was just submitted so a follow-up edit pre-fills.
      setLeaderPrefill(form)
      setForceForm(false)
      setMeCheck({ status: 'leader-done', joinUrl: data.joinUrl ?? '', attending: form.attending })
    } catch (e) {
      setError(e instanceof Error ? e.message : GENERIC_ERROR)
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
          嗨，{profile.displayName}
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="你的姓名（方便核對名單、安排座位）" error={fieldErrors.realName}>
          <input
            ref={realNameRef}
            type="text" name="realName" autoComplete="name" className="field-input"
            value={form.realName}
            onChange={e => setForm({ ...form, realName: e.target.value })}
          />
        </Field>

        <Field label="你是男方還是女方的賓客？" error={fieldErrors.side}>
          <select
            ref={sideRef} name="side" autoComplete="off" className="field-input"
            value={form.side}
            onChange={e => setForm({ ...form, side: e.target.value as FormState['side'] })}
          >
            <option value="">請選擇</option>
            <option value="男方">男方</option>
            <option value="女方">女方</option>
          </select>
        </Field>

        <Field label="與新人的關係" error={fieldErrors.relationship}>
          <select
            ref={relationshipRef} name="relationship" autoComplete="off" className="field-input"
            value={form.relationship}
            onChange={e => setForm({ ...form, relationship: e.target.value as FormState['relationship'] })}
          >
            <option value="">請選擇</option>
            <option value="家長">家長</option>
            <option value="親戚">親戚</option>
            <option value="朋友">朋友</option>
          </select>
        </Field>

        <Field label="是否出席" error={fieldErrors.attending}>
          <select
            ref={attendingRef} name="attending" autoComplete="off" className="field-input"
            value={form.attending}
            onChange={e => setForm({ ...form, attending: e.target.value as FormState['attending'] })}
          >
            <option value="">請選擇</option>
            <option value="出席">出席</option>
            <option value="不克出席">不克出席</option>
          </select>
        </Field>

        {form.attending === '出席' && (
          <>
            <Field label="大人人數（含本人）">
              <input
                type="number" name="adultCount" autoComplete="off" min={1} className="field-input"
                value={form.adultCount}
                onChange={e => setForm({ ...form, adultCount: e.target.value })}
              />
            </Field>
            <Field label="兒童人數">
              <input
                type="number" name="childCount" autoComplete="off" min={0} className="field-input"
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
                type="number" name="childSeatCount" autoComplete="off"
                min={0} max={Number(form.childCount) || 0} className="field-input"
                value={form.childSeatCount}
                onChange={e => setForm({ ...form, childSeatCount: e.target.value })}
              />
            </Field>
            <SelectField
              label="你的飲食需求" name="leaderDiet"
              value={form.leaderDiet}
              onChange={v => setForm({ ...form, leaderDiet: v, leaderDietDetail: needsDietDetail(v) ? form.leaderDietDetail : '' })}
              options={DIET_OPTIONS.map(o => ({ value: o, label: o }))}
            />
            {needsDietDetail(form.leaderDiet) && (
              <Field label="過敏原或其他說明（會轉達給餐廳）">
                <input
                  type="text" name="leaderDietDetail" autoComplete="off" className="field-input"
                  value={form.leaderDietDetail}
                  onChange={e => setForm({ ...form, leaderDietDetail: e.target.value })}
                />
              </Field>
            )}
          </>
        )}

        <Field
          label="備註（幫不用 LINE 的同行者代填）"
          hint="會用 LINE 的大人，等一下把你拿到的連結傳給他，讓他自己加入就好。這欄只填「不會用 LINE、需要你代填」的人（例如長輩、小孩）：他們的姓名、素食／過敏、兒童餐或兒童椅需求。"
        >
          <textarea
            rows={3} name="notes" autoComplete="off" className="field-input"
            placeholder="例：我爸媽兩位不用 LINE，都吃素；小孩 1 位要兒童餐 + 兒童椅"
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <Field label="想對新人說的話">
          <textarea
            rows={3} name="message" autoComplete="off" className="field-input"
            value={form.message}
            onChange={e => setForm({ ...form, message: e.target.value })}
          />
        </Field>

        {error && <StatusBanner kind="error">{error}</StatusBanner>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? '送出中…' : '送出回覆'}
        </button>

        {forceForm && leaderPrefill && (
          <button
            type="button"
            className="block w-full text-center text-sm text-ink/50 underline underline-offset-4"
            onClick={() => { setForceForm(false); setFieldErrors({}); setError(null) }}
          >
            取消
          </button>
        )}
      </form>
    </main>
  )
}

// Shown to a party MEMBER instead of the leader form (see MeCheck above):
// the leader already answered for the whole party, so this guest just keeps
// their own diet and (per contract 4) their own name up to date.
function MemberDedupView({
  leaderName, initialDiet, initialRealName,
}: { leaderName: string | null; initialDiet: string | null; initialRealName: string | null }) {
  const { base: initialBase, detail: initialDetail } = splitDietDetail(initialDiet || '無特殊需求')
  const validInitialDiet = (DIET_OPTIONS as readonly string[]).includes(initialBase) ? initialBase : DIET_OPTIONS[0]
  const [diet, setDiet] = useState(validInitialDiet)
  const [dietDetail, setDietDetail] = useState(initialDetail)
  const [realName, setRealName] = useState(initialRealName ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const realNameRef = useRef<HTMLInputElement>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = realName.trim()
    if (!trimmedName) {
      setNameError('請輸入姓名')
      setError('請輸入姓名')
      realNameRef.current?.focus()
      return
    }
    setNameError(undefined)
    setError(null)
    setSavedMsg(null)
    setSubmitting(true)
    try {
      const idToken = await getLiffIdToken()
      if (!idToken) throw new Error(LINE_TIMEOUT_ERROR)
      const res = await fetch('/api/party/member-diet', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-line-id-token': idToken },
        body: JSON.stringify({ diet: buildDietValue(diet, dietDetail), realName: trimmedName }),
      })
      const data = await res.json() as { ok?: boolean; diet?: string; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ? mapApiError(data.error) : GENERIC_ERROR)
      setSavedMsg('已幫你更新囉')
    } catch (e) {
      setError(e instanceof Error ? e.message : GENERIC_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-2xl">
        你是{leaderName ?? '對方'}那一團，團長已回覆出席
      </h1>
      <p className="mt-4 text-ink/70">期待 2027/06/05 與你相見。</p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5 text-left" noValidate>
        <Field label="你的姓名（方便核對名單、安排座位）" error={nameError}>
          <input
            ref={realNameRef}
            type="text" name="realName" autoComplete="name" className="field-input"
            value={realName}
            onChange={e => setRealName(e.target.value)}
          />
        </Field>

        <SelectField
          label="更新我的飲食需求" name="diet" value={diet}
          onChange={v => { setDiet(v); if (!needsDietDetail(v)) setDietDetail('') }}
          options={DIET_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        {needsDietDetail(diet) && (
          <Field label="過敏原或其他說明（會轉達給餐廳）">
            <input
              type="text" name="dietDetail" autoComplete="off" className="field-input"
              value={dietDetail}
              onChange={e => setDietDetail(e.target.value)}
            />
          </Field>
        )}

        {error && <StatusBanner kind="error">{error}</StatusBanner>}
        {savedMsg && <StatusBanner kind="success">{savedMsg}</StatusBanner>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? '送出中…' : '更新'}
        </button>
      </form>
    </main>
  )
}

// Shown once the leader's RSVP is recorded. A not-attending leader gets a
// simple thanks view (pinned copy, no share link or progress — there's
// nothing to coordinate) but keeps the edit entry in case plans change.
function LeaderDoneView({
  joinUrl, attending, onEdit,
}: { joinUrl: string; attending: string; onEdit: () => void }) {
  if (attending === '不克出席') {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-2xl">已收到你的回覆</h1>
        <p className="mt-4 text-ink/70">謝謝你特地告訴我們。若之後可以出席，隨時回來修改回覆。</p>
        <button type="button" className="btn-outline mt-8" onClick={onEdit}>
          需要修改回覆？重新填寫
        </button>
      </main>
    )
  }

  return <AttendingDoneView joinUrl={joinUrl} onEdit={onEdit} />
}

// Shown to a leader who has already submitted (re-opening RSVP) and is
// attending, so their share link is one tap away instead of buried behind
// re-filling the form.
function AttendingDoneView({ joinUrl, onEdit }: { joinUrl: string; onEdit: () => void }) {
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

  // Guests often background the LIFF app while sharing the link elsewhere
  // (LINE's own picker, a chat) and come back later — refetch so the count
  // isn't stale without needing the manual button every time.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') loadProgress()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadProgress])

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-2xl">你的回覆已送出 ❤</h1>
      <p className="mt-4 text-ink/70">把下面的連結傳給同行的人，他們加入就完成登記。</p>

      {progress && (
        <Card className="mt-6">
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
        </Card>
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
    <Card className="mt-10">
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
    </Card>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
  )
}

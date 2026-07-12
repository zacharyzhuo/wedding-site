'use client'

// Non-LINE fallback. Same fields as the LIFF form except the guest types
// their name (no LINE profile to read). Used by guests without LINE — e.g.
// elderly relatives, hence the larger base text size and taller tap targets
// (min-h ~48px) on every input/button below. Spam protection (Turnstile) to
// be added before public launch; this is the unprotected starter.

import { useRef, useState } from 'react'
import { DIET_OPTIONS, buildDietValue, needsDietDetail } from '@/lib/diet'
import { Field, SelectField, StatusBanner } from '@/components/ui'

const GENERIC_ERROR = '送出失敗，請稍後再試，或直接聯絡新人'
const BIG_INPUT = 'field-input min-h-12 text-lg'
const RESUBMIT_WARNING =
  '再次送出會新增一筆回覆，不會覆蓋先前資料。填錯了也沒關係，直接聯絡新人幫你改。'

type FieldErrors = Partial<Record<'name' | 'side' | 'relationship' | 'attending', string>>

export default function RsvpFallbackPage() {
  const [form, setForm] = useState({
    name: '', side: '', relationship: '', attending: '',
    headcount: '1', childCount: '0', diet: '無特殊需求', dietDetail: '', notes: '', message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const nameRef = useRef<HTMLInputElement>(null)
  const sideRef = useRef<HTMLSelectElement>(null)
  const relationshipRef = useRef<HTMLSelectElement>(null)
  const attendingRef = useRef<HTMLSelectElement>(null)

  function validate(): boolean {
    const next: FieldErrors = {}
    if (!form.name.trim()) next.name = '請輸入姓名'
    if (!form.side) next.side = '請選擇您是男方或女方的賓客'
    if (!form.relationship) next.relationship = '請選擇與新人的關係'
    if (!form.attending) next.attending = '請選擇是否出席'
    setFieldErrors(next)

    const order: Array<[keyof FieldErrors, React.RefObject<HTMLElement | null>]> = [
      ['name', nameRef], ['side', sideRef], ['relationship', relationshipRef], ['attending', attendingRef],
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
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'fallback',
          realName: form.name,
          side: form.side,
          relationship: form.relationship,
          attending: form.attending,
          adultCount: Number(form.headcount) || 1,
          childCount: Number(form.childCount) || 0,
          // No child-seat question on this simplified fallback form —
          // defaults to 0, which always satisfies the server's
          // childSeatCount <= childCount check.
          childSeatCount: 0,
          leaderDiet: buildDietValue(form.diet, form.dietDetail),
          notes: form.notes,
          message: form.message,
        }),
      })
      if (!res.ok) {
        // Never surface a raw "HTTP 400" to the guest — read the server's
        // JSON error field first, fall back to a friendly generic message
        // only if the body isn't JSON (or has no error field).
        let message = GENERIC_ERROR
        try {
          const data = await res.json() as { error?: string }
          if (data?.error) message = data.error
        } catch {
          // non-JSON error body — keep the generic message
        }
        throw new Error(message)
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : GENERIC_ERROR)
    } finally { setSubmitting(false) }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-md px-6 py-20 text-center text-lg">
        <h1 className="text-3xl">收到您的回覆 ❤</h1>
        <p className="mt-4 text-ink/70">期待 2027/06/05 與您相見。</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10 text-lg">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">RSVP</p>
        <h1 className="mt-2 text-2xl">回覆出席</h1>
        <p className="mt-3 text-sm text-ink/50">網頁版（無使用 LINE 的賓客）</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="姓名" error={fieldErrors.name}>
          <input
            ref={nameRef}
            type="text" name="name" autoComplete="name" className={BIG_INPUT}
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="您是男方還是女方的賓客？" error={fieldErrors.side}>
          <select
            ref={sideRef} name="side" autoComplete="off" className={BIG_INPUT}
            value={form.side} onChange={e => setForm({ ...form, side: e.target.value })}
          >
            <option value="">請選擇</option>
            <option value="男方">男方</option>
            <option value="女方">女方</option>
          </select>
        </Field>
        <Field label="與新人的關係" error={fieldErrors.relationship}>
          <select
            ref={relationshipRef} name="relationship" autoComplete="off" className={BIG_INPUT}
            value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })}
          >
            <option value="">請選擇</option>
            <option value="家長">家長</option>
            <option value="親戚">親戚</option>
            <option value="朋友">朋友</option>
          </select>
        </Field>
        <Field label="是否出席" error={fieldErrors.attending}>
          <select
            ref={attendingRef} name="attending" autoComplete="off" className={BIG_INPUT}
            value={form.attending} onChange={e => setForm({ ...form, attending: e.target.value })}
          >
            <option value="">請選擇</option>
            <option value="出席">出席</option>
            <option value="不克出席">不克出席</option>
          </select>
        </Field>
        {form.attending === '出席' && (
          <>
            <Field label="出席人數（含本人）">
              <input
                type="number" name="headcount" autoComplete="off" min={1} className={BIG_INPUT}
                value={form.headcount} onChange={e => setForm({ ...form, headcount: e.target.value })}
              />
            </Field>
            <Field label="其中兒童人數">
              <input
                type="number" name="childCount" autoComplete="off" min={0} className={BIG_INPUT}
                value={form.childCount} onChange={e => setForm({ ...form, childCount: e.target.value })}
              />
            </Field>
            <SelectField
              label="飲食需求" name="diet" value={form.diet}
              onChange={v => setForm({ ...form, diet: v, dietDetail: needsDietDetail(v) ? form.dietDetail : '' })}
              options={DIET_OPTIONS.map(o => ({ value: o, label: o }))}
            />
            {needsDietDetail(form.diet) && (
              <Field label="過敏原或其他說明（會轉達給餐廳）">
                <input
                  type="text" name="dietDetail" autoComplete="off" className={BIG_INPUT}
                  value={form.dietDetail} onChange={e => setForm({ ...form, dietDetail: e.target.value })}
                />
              </Field>
            )}
          </>
        )}

        <Field
          label="備註（若還要一併登記其他不用網路的同行者）"
          hint="例如同行的長輩姓名、素食／過敏、兒童餐或兒童椅需求，方便新人安排座位與餐點。"
        >
          <textarea
            rows={3} name="notes" autoComplete="off" className={BIG_INPUT}
            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <Field label="想對新人說的話">
          <textarea
            rows={3} name="message" autoComplete="off" className={BIG_INPUT}
            value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}
          />
        </Field>

        <StatusBanner kind="info">{RESUBMIT_WARNING}</StatusBanner>

        {error && <StatusBanner kind="error">{error}</StatusBanner>}

        <button type="submit" disabled={submitting}
          className="btn-primary w-full min-h-12 text-lg">
          {submitting ? '送出中…' : '送出回覆'}
        </button>
      </form>
    </main>
  )
}

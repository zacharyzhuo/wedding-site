'use client'

import { useState } from 'react'
import { useLiffProfile } from '@/lib/liff'

// Field shape mirrors the Sheet's existing guest-list vocabulary so RSVP
// responses reconcile cleanly with the draft list (see skill's
// references/rsvp-forms.md + assets/templates/rsvp-schema.md).
type FormState = {
  side: '男方' | '女方' | ''
  relationship: '家長' | '親戚' | '朋友' | ''
  attending: '出席' | '不克出席' | ''
  headcount: string  // keep as string for form input; coerce on submit
  childCount: string
  diet: string
  message: string
}

// Fixed vocabulary so the value lands in the Sheet as a stable label;
// avoids free-text variants like "全素"/"純素"/"vegan" that mean the same thing.
const DIET_OPTIONS = [
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
] as const

const initial: FormState = {
  side: '', relationship: '', attending: '',
  headcount: '1', childCount: '0', diet: '無特殊需求', message: '',
}

export default function RsvpLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_RSVP
  const state = useLiffProfile(liffId)
  const [form, setForm] = useState<FormState>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
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
      <h1 className="text-3xl">收到您的回覆 ❤</h1>
      <p className="mt-4 text-ink/70">期待 2027/06/05 與您相見。</p>
    </Centered>
  }

  const profile = state.profile

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'liff',
          lineUserId: profile.userId,
          name: profile.displayName,
          ...form,
          headcount: Number(form.headcount) || 1,
          childCount: Number(form.childCount) || 0,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDone(true)
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
            <Field label="出席人數（含本人）">
              <input
                type="number" min={1} className="field-input"
                value={form.headcount}
                onChange={e => setForm({ ...form, headcount: e.target.value })}
              />
            </Field>
            <Field label="其中兒童人數（需兒童椅）">
              <input
                type="number" min={0} className="field-input"
                value={form.childCount}
                onChange={e => setForm({ ...form, childCount: e.target.value })}
              />
            </Field>
            <Field label="飲食需求">
              <Select
                value={form.diet}
                onChange={v => setForm({ ...form, diet: v })}
                options={[...DIET_OPTIONS]}
              />
            </Field>
          </>
        )}

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
          disabled={submitting || !form.side || !form.relationship || !form.attending}
          className="btn-primary w-full"
        >
          {submitting ? '送出中…' : '送出回覆'}
        </button>
      </form>
    </main>
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
    <select
      className="field-input"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">請選擇</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
  )
}

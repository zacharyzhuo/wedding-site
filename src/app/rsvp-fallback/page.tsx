'use client'

// Non-LINE fallback. Same fields as the LIFF form except the guest types
// their name (no LINE profile to read). Used by guests without LINE — e.g.
// elderly relatives. Spam protection (Turnstile) to be added before public
// launch; this is the unprotected starter.

import { useState } from 'react'
import { DIET_OPTIONS } from '@/lib/diet'

export default function RsvpFallbackPage() {
  const [form, setForm] = useState({
    name: '', side: '', relationship: '', attending: '',
    headcount: '1', childCount: '0', diet: '無特殊需求', message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSubmitting(true)
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
          leaderDiet: form.diet,
          notes: '',
          message: form.message,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '送出失敗')
    } finally { setSubmitting(false) }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-3xl">收到您的回覆 ❤</h1>
        <p className="mt-4 text-ink/70">期待 2027/06/05 與您相見。</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <header className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-accent">RSVP</p>
        <h1 className="mt-2 text-2xl">回覆出席</h1>
        <p className="mt-3 text-xs text-ink/50">網頁版（無使用 LINE 的賓客）</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <Labeled label="姓名">
          <input type="text" required className="field-input"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </Labeled>
        <Labeled label="您是男方還是女方的賓客？">
          <Select value={form.side} onChange={v => setForm({ ...form, side: v })}
            options={['男方', '女方']} />
        </Labeled>
        <Labeled label="與新人的關係">
          <Select value={form.relationship} onChange={v => setForm({ ...form, relationship: v })}
            options={['家長', '親戚', '朋友']} />
        </Labeled>
        <Labeled label="是否出席">
          <Select value={form.attending} onChange={v => setForm({ ...form, attending: v })}
            options={['出席', '不克出席']} />
        </Labeled>
        {form.attending === '出席' && (
          <>
            <Labeled label="出席人數（含本人）">
              <input type="number" min={1} className="field-input"
                value={form.headcount} onChange={e => setForm({ ...form, headcount: e.target.value })} />
            </Labeled>
            <Labeled label="其中兒童人數">
              <input type="number" min={0} className="field-input"
                value={form.childCount} onChange={e => setForm({ ...form, childCount: e.target.value })} />
            </Labeled>
            <Labeled label="飲食需求">
              <Select value={form.diet} onChange={v => setForm({ ...form, diet: v })}
                options={[...DIET_OPTIONS]} />
            </Labeled>
          </>
        )}
        <Labeled label="想對新人說的話">
          <textarea rows={3} className="field-input"
            value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
        </Labeled>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button type="submit"
          disabled={submitting || !form.name || !form.side || !form.relationship || !form.attending}
          className="btn-primary w-full">
          {submitting ? '送出中…' : '送出回覆'}
        </button>
      </form>
    </main>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="field-label">{label}</span>{children}</label>
}
function Select({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className="field-input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">請選擇</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

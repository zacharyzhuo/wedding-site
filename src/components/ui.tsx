'use client'

// Shared design-system primitives. Extracted from the landing page's original
// look (arch cards, offset solid shadows, wide-tracked eyebrows) so every
// LIFF mini-app and the fallback form reuse the same tokens and a11y wiring
// instead of re-inventing them per page.

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Eyebrow({ script, children }: { script?: string; children: ReactNode }) {
  return (
    <div className="text-center">
      {script && <p className="font-script text-2xl text-accent/90">{script}</p>}
      <h2 className="mt-3 text-2xl tracking-[0.25em] text-ink">{children}</h2>
      <div className="ornament mx-auto mt-5" aria-hidden />
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <p role="status" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-ink/50">{hint}</p>
      )}
    </label>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  name,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  name?: string
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select
        name={name}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="field-input"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Spinner({ label = '載入中…' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink/60">
      <span className="spinner" aria-hidden />
      {label}
    </span>
  )
}

const CONFIRM_WINDOW_MS = 3000

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  disabled,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  className?: string
  disabled?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (revertTimer.current) clearTimeout(revertTimer.current)
    }
  }, [])

  const handleClick = () => {
    if (confirming) {
      if (revertTimer.current) clearTimeout(revertTimer.current)
      setConfirming(false)
      onConfirm()
      return
    }
    setConfirming(true)
    revertTimer.current = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS)
  }

  return (
    <button type="button" onClick={handleClick} disabled={disabled} className={className}>
      <span aria-live="polite">{confirming ? confirmLabel : label}</span>
    </button>
  )
}

const STATUS_STYLES = {
  error: 'border-red-300 bg-red-50 text-red-700',
  success: 'border-accent/40 bg-champagne/40 text-ink',
  info: 'border-champagne bg-white/70 text-ink/70',
} as const

export function StatusBanner({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info'
  children: ReactNode
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`rounded-md border px-4 py-3 text-sm ${STATUS_STYLES[kind]}`}
    >
      {children}
    </p>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-champagne bg-white/70 p-8 shadow-[10px_10px_0_#e8dccb] ${className}`}
    >
      {children}
    </div>
  )
}

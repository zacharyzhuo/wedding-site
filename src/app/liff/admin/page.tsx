'use client'

// LIFF: 管理介面 (Zachary + Angelet only)
// Three jobs:
//   1. Live feed of danmaku + photos with delete / hide buttons.
//   2. Toggle between auto-approve and manual moderation mode.
//   3. Promote pending messages (keyword filter hits) to approved.
//
// Auth gate runs in /api/admin/check on first load. The page itself is just
// served statically — without an admin idToken every API call returns 403,
// so non-admins see "未授權".

import { useCallback, useEffect, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'

type DanmakuItem = {
  id: number
  displayName: string
  message: string
  photoId: number | null
  status: 'approved' | 'pending' | 'deleted'
  createdAt: number
}
type PhotoItem = {
  id: number
  url: string
  uploaderName: string
  caption: string | null
  status: 'visible' | 'hidden'
  createdAt: number
}
type RaffleDraw = {
  id: number
  prize: string
  winnerName: string
  status: 'active' | 'forfeited'
  drawnAt: number
}

const POLL_MS = 5000

export default function AdminLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_ADMIN
  const state = useLiffProfile(liffId)
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading')
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [filter, setFilter] = useState<'all' | 'pending'>('all')
  const [raffleTotal, setRaffleTotal] = useState(0)
  const [draws, setDraws] = useState<RaffleDraw[]>([])
  const [prizeInput, setPrizeInput] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [raffleError, setRaffleError] = useState<string | null>(null)

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const idToken = await getLiffIdToken()
    if (!idToken) throw new Error('idToken missing')
    return fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'x-line-id-token': idToken,
        'content-type': 'application/json',
      },
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch('/api/admin/feed')
      if (res.status === 403) { setAuthState('forbidden'); return }
      if (!res.ok) { setAuthState('error'); setAuthMessage(`HTTP ${res.status}`); return }
      const data = await res.json() as {
        ok: boolean; mode: 'auto' | 'manual'
        danmaku: DanmakuItem[]; photos: PhotoItem[]
      }
      setMode(data.mode)
      setDanmaku(data.danmaku)
      setPhotos(data.photos)
      setAuthState('ok')
      // Raffle state rides the same refresh cadence; a failure here should
      // not blank the moderation feed, so it swallows independently.
      try {
        const r = await authedFetch('/api/admin/raffle')
        if (r.ok) {
          const rd = await r.json() as { ok: boolean; total: number; draws: RaffleDraw[] }
          if (rd.ok) { setRaffleTotal(rd.total); setDraws(rd.draws) }
        }
      } catch { /* next poll retries */ }
    } catch (e) {
      setAuthState('error')
      setAuthMessage(e instanceof Error ? e.message : 'unknown')
    }
  }, [authedFetch])

  // Initial auth + first feed pull.
  useEffect(() => {
    if (state.status !== 'ready') return
    ;(async () => {
      try {
        const res = await authedFetch('/api/admin/check')
        if (res.status === 403) { setAuthState('forbidden'); return }
        if (!res.ok) { setAuthState('error'); setAuthMessage(`HTTP ${res.status}`); return }
        await refresh()
      } catch (e) {
        setAuthState('error')
        setAuthMessage(e instanceof Error ? e.message : 'unknown')
      }
    })()
  }, [state.status, authedFetch, refresh])

  // Live polling once authed.
  useEffect(() => {
    if (authState !== 'ok') return
    const t = setInterval(() => { refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [authState, refresh])

  // All three actions update the UI optimistically — the buttons were
  // unusably laggy when every click waited for the API round-trip plus a
  // full feed refresh. On failure we revert; the 5s poll reconciles any
  // remaining drift either way.
  async function setDanmakuStatus(id: number, action: 'delete' | 'approve') {
    const nextStatus = action === 'delete' ? 'deleted' as const : 'approved' as const
    const before = danmaku
    setDanmaku(ds => ds.map(d => (d.id === id ? { ...d, status: nextStatus } : d)))
    const res = await authedFetch(`/api/admin/danmaku/${id}`, {
      method: 'POST', body: JSON.stringify({ action }),
    }).catch(() => null)
    if (!res || !res.ok) setDanmaku(before)
  }
  async function setPhotoStatus(id: number, action: 'hide' | 'unhide') {
    const nextStatus = action === 'hide' ? 'hidden' as const : 'visible' as const
    const before = photos
    setPhotos(ps => ps.map(p => (p.id === id ? { ...p, status: nextStatus } : p)))
    const res = await authedFetch(`/api/admin/photos/${id}`, {
      method: 'POST', body: JSON.stringify({ action }),
    }).catch(() => null)
    if (!res || !res.ok) setPhotos(before)
  }
  async function doDraw(prize: string) {
    const trimmed = prize.trim()
    if (!trimmed || drawing) return
    setDrawing(true)
    setRaffleError(null)
    try {
      const res = await authedFetch('/api/admin/raffle/draw', {
        method: 'POST', body: JSON.stringify({ prize: trimmed }),
      })
      const data = await res.json() as { ok?: boolean; draw?: RaffleDraw; error?: string }
      if (!res.ok || !data.ok || !data.draw) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDraws(ds => [data.draw!, ...ds])
      setPrizeInput('')
    } catch (e) {
      setRaffleError(e instanceof Error ? e.message : '開抽失敗')
    } finally {
      setDrawing(false)
    }
  }

  // 重抽 = forfeit the absent winner, then immediately draw the same prize.
  async function redraw(d: RaffleDraw) {
    if (drawing) return
    setDrawing(true)
    setRaffleError(null)
    try {
      const f = await authedFetch(`/api/admin/raffle/${d.id}`, {
        method: 'POST', body: JSON.stringify({ action: 'forfeit' }),
      })
      if (!f.ok) throw new Error(`forfeit HTTP ${f.status}`)
      setDraws(ds => ds.map(x => (x.id === d.id ? { ...x, status: 'forfeited' as const } : x)))
      const res = await authedFetch('/api/admin/raffle/draw', {
        method: 'POST', body: JSON.stringify({ prize: d.prize }),
      })
      const data = await res.json() as { ok?: boolean; draw?: RaffleDraw; error?: string }
      if (!res.ok || !data.ok || !data.draw) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDraws(ds => [data.draw!, ...ds])
    } catch (e) {
      setRaffleError(e instanceof Error ? e.message : '重抽失敗')
    } finally {
      setDrawing(false)
    }
  }

  async function toggleMode() {
    const prev = mode
    const next = mode === 'auto' ? 'manual' : 'auto'
    setMode(next)
    const res = await authedFetch('/api/admin/mode', {
      method: 'POST', body: JSON.stringify({ mode: next }),
    }).catch(() => null)
    if (!res || !res.ok) setMode(prev)
  }

  if (state.status === 'loading' || authState === 'loading') {
    return <Centered><p className="text-ink/60">驗證中…</p></Centered>
  }
  if (state.status === 'error') {
    return <Centered>
      <p className="text-ink/80">LINE 載入失敗</p>
      <p className="text-sm text-ink/50 mt-2">{state.message}</p>
    </Centered>
  }
  if (authState === 'forbidden') {
    return <Centered>
      <p className="text-ink/80">未授權</p>
      <p className="text-sm text-ink/50 mt-2">此頁面只開放給新人。</p>
      <p className="text-xs text-ink/40 mt-4">
        如果你是 Zachary 或 Angelet，請把你的 LINE userId 加進 ADMIN_LINE_USER_IDS。
      </p>
    </Centered>
  }
  if (authState === 'error') {
    return <Centered>
      <p className="text-ink/80">載入失敗</p>
      <p className="text-sm text-ink/50 mt-2">{authMessage ?? 'unknown'}</p>
    </Centered>
  }

  const visible = filter === 'pending'
    ? danmaku.filter(d => d.status === 'pending')
    : danmaku

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-serif">即時審核</h1>
        <button
          className={`rounded-full px-4 py-1 text-sm font-medium ${
            mode === 'auto' ? 'bg-accent text-cream' : 'bg-red-600 text-cream'
          }`}
          onClick={toggleMode}
        >
          {mode === 'auto' ? 'AUTO' : 'MANUAL'}
        </button>
      </header>

      <div className="mb-4 flex gap-2 text-sm">
        <button
          className={`rounded-full px-3 py-1 ${filter === 'all' ? 'bg-ink text-cream' : 'bg-white border border-champagne'}`}
          onClick={() => setFilter('all')}
        >全部</button>
        <button
          className={`rounded-full px-3 py-1 ${filter === 'pending' ? 'bg-ink text-cream' : 'bg-white border border-champagne'}`}
          onClick={() => setFilter('pending')}
        >待審 ({danmaku.filter(d => d.status === 'pending').length})</button>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">彈幕</h2>
        <ul className="space-y-2">
          {visible.length === 0 && <li className="text-sm text-ink/50">沒有訊息。</li>}
          {visible.map(d => (
            <li key={d.id} className={`rounded-md border bg-white p-3 ${
              d.status === 'pending' ? 'border-amber-400' :
              d.status === 'deleted' ? 'border-champagne opacity-40' :
              'border-champagne'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm">{d.message}</p>
                  <p className="mt-1 text-xs text-ink/50">
                    {d.displayName} · {new Date(d.createdAt).toLocaleTimeString('zh-TW', { hour12: false })}
                    {d.photoId && ' · 附照片'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {d.status === 'pending' && (
                    <button
                      className="rounded bg-emerald-600 px-2 py-1 text-xs text-cream"
                      onClick={() => setDanmakuStatus(d.id, 'approve')}
                    >通過</button>
                  )}
                  {d.status !== 'deleted' && (
                    <button
                      className="rounded bg-red-600 px-2 py-1 text-xs text-cream"
                      onClick={() => setDanmakuStatus(d.id, 'delete')}
                    >刪除</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">
          抽獎 <span className="normal-case tracking-normal text-ink/50">（{raffleTotal} 人參加）</span>
        </h2>
        <div className="flex gap-2">
          <input
            className="field-input flex-1"
            placeholder="獎項名稱，例如：頭獎 iPhone"
            value={prizeInput}
            onChange={e => setPrizeInput(e.target.value)}
            maxLength={40}
          />
          <button
            className="btn-primary shrink-0 px-5"
            disabled={drawing || !prizeInput.trim()}
            onClick={() => doDraw(prizeInput)}
          >
            {drawing ? '抽獎中…' : '開抽 🎲'}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink/40">
          按下開抽後 3 秒內，大螢幕會播放開獎動畫並公布得主。
        </p>
        {raffleError && <p className="mt-2 text-sm text-red-600">{raffleError}</p>}
        {draws.length > 0 && (
          <ul className="mt-3 space-y-2">
            {draws.map(d => (
              <li key={d.id} className={`rounded-md border bg-white p-3 ${
                d.status === 'forfeited' ? 'border-champagne opacity-40' : 'border-champagne'
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm">
                      {d.prize} → <span className="font-medium">{d.winnerName}</span>
                      {d.status === 'forfeited' && <span className="ml-2 text-xs text-red-600">已作廢</span>}
                    </p>
                    <p className="mt-1 text-xs text-ink/50">
                      {new Date(d.drawnAt).toLocaleTimeString('zh-TW', { hour12: false })}
                    </p>
                  </div>
                  {d.status === 'active' && (
                    <button
                      className="shrink-0 rounded bg-amber-600 px-2 py-1 text-xs text-cream"
                      disabled={drawing}
                      onClick={() => redraw(d)}
                    >人不在，重抽</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">照片</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.length === 0 && <li className="text-sm text-ink/50">沒有照片。</li>}
          {photos.map(p => (
            <li key={p.id} className={`overflow-hidden rounded-md border bg-white ${
              p.status === 'hidden' ? 'border-red-400 opacity-50' : 'border-champagne'
            }`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="aspect-square w-full object-cover" />
              <div className="p-2">
                <p className="truncate text-xs text-ink/60">{p.uploaderName}</p>
                {p.caption && <p className="truncate text-xs text-ink/40">{p.caption}</p>}
                <button
                  className={`mt-2 w-full rounded px-2 py-1 text-xs ${
                    p.status === 'hidden' ? 'bg-emerald-600 text-cream' : 'bg-red-600 text-cream'
                  }`}
                  onClick={() => setPhotoStatus(p.id, p.status === 'hidden' ? 'unhide' : 'hide')}
                >
                  {p.status === 'hidden' ? '取消隱藏' : '隱藏'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
}

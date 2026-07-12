'use client'

// LIFF: 管理介面 (Zachary + Angelet only)
// Three jobs:
//   1. Live feed of danmaku + photos with delete / hide buttons.
//   2. Toggle between auto-approve and manual moderation mode.
//   3. Promote pending messages (keyword filter hits) and pending photos to approved.
//
// Auth gate runs in /api/admin/check on first load. The page itself is just
// served statically — without an admin idToken every API call returns 403,
// so non-admins see "未授權".
//
// Resilience note: this page runs on the couple's phones during the actual
// event. A transient network blip must never freeze the poll loop or drop
// the whole UI into an error screen — only a real 403 (not on the allowlist)
// or a persistently failing initial auth check does that. See `runCheck` /
// `refresh` below.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiffProfile } from '@/lib/liff'
import { getLiffIdToken } from '@/lib/liff-token'
import { ConfirmButton, Spinner, StatusBanner } from '@/components/ui'

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
  status: 'visible' | 'hidden' | 'pending'
  createdAt: number
}
type RaffleDraw = {
  id: number
  prize: string
  prizeId: number | null
  winnerName: string
  status: 'active' | 'forfeited'
  drawnAt: number
}
type RafflePrize = {
  id: number
  name: string
  quantity: number
  remaining: number
}
type UnidentifiedGuest = {
  userId: string
  displayName: string
  avatarUrl: string | null
}

const POLL_MS = 5000
const AUTH_MAX_ATTEMPTS = 3
const AUTH_RETRY_BASE_MS = 500
const ACTION_ERROR_DISMISS_MS = 5000
const WINNER_REVEAL_DELAY_MS = 3000

const TABS = [
  ['danmaku', '彈幕'],
  ['photos', '照片'],
  ['raffle', '抽獎'],
  ['thankyou', '悄悄話'],
  ['identity', '身分'],
] as const
type TabKey = (typeof TABS)[number][0]
const VALID_TABS: readonly string[] = TABS.map(([key]) => key)

export default function AdminLiffPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID_ADMIN
  const state = useLiffProfile(liffId)
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading')
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [pollFailCount, setPollFailCount] = useState(0)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [thankyouMode, setThankyouMode] = useState<'on' | 'off'>('off')
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [filter, setFilter] = useState<'all' | 'pending'>('all')
  const [tab, setTab] = useState<TabKey>('danmaku')
  const [raffleTotal, setRaffleTotal] = useState(0)
  const [raffleMode, setRaffleMode] = useState<'on' | 'off'>('off')
  const [raffleModeStartedAt, setRaffleModeStartedAt] = useState<number | null>(null)
  const [prizes, setPrizes] = useState<RafflePrize[]>([])
  const [draws, setDraws] = useState<RaffleDraw[]>([])
  const [newPrizeName, setNewPrizeName] = useState('')
  const [newPrizeQty, setNewPrizeQty] = useState('1')
  const [drawing, setDrawing] = useState(false)
  const [pendingReveal, setPendingReveal] = useState<Set<number>>(new Set())
  const [unidentified, setUnidentified] = useState<UnidentifiedGuest[]>([])
  const [identityDrafts, setIdentityDrafts] = useState<Record<string, { realName: string; partyId: string }>>({})
  const [identitySaving, setIdentitySaving] = useState<string | null>(null)
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const actionErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      if (actionErrorTimer.current) clearTimeout(actionErrorTimer.current)
      revealTimers.current.forEach(t => clearTimeout(t))
    }
  }, [])

  const flashActionError = useCallback((message: string) => {
    if (actionErrorTimer.current) clearTimeout(actionErrorTimer.current)
    setActionError(message)
    actionErrorTimer.current = setTimeout(() => setActionError(null), ACTION_ERROR_DISMISS_MS)
  }, [])

  const scheduleReveal = useCallback((id: number) => {
    setPendingReveal(prev => new Set(prev).add(id))
    const t = setTimeout(() => {
      setPendingReveal(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      revealTimers.current.delete(id)
    }, WINNER_REVEAL_DELAY_MS)
    revealTimers.current.set(id, t)
  }, [])

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

  // Poll loop. Transient failures (network blip, 5xx) must NOT tear down the
  // interval or blank the authenticated view — they just bump pollFailCount,
  // which drives a small "reconnecting" banner. Only a 403 (real deauth,
  // e.g. removed from the allowlist mid-event) flips the whole page over.
  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch('/api/admin/feed')
      if (res.status === 403) { setAuthState('forbidden'); return }
      if (!res.ok) { setPollFailCount(c => c + 1); return }
      const data = await res.json() as {
        ok: boolean; mode: 'auto' | 'manual'; thankyouMode?: 'on' | 'off'
        danmaku: DanmakuItem[]; photos: PhotoItem[]
      }
      setMode(data.mode)
      setThankyouMode(data.thankyouMode ?? 'off')
      setDanmaku(data.danmaku)
      setPhotos(data.photos)
      setAuthState('ok')
      setPollFailCount(0)
      // Raffle state rides the same refresh cadence; a failure here should
      // not blank the moderation feed, so it swallows independently.
      try {
        const r = await authedFetch('/api/admin/raffle')
        if (r.ok) {
          const rd = await r.json() as {
            ok: boolean; mode: 'on' | 'off'; total: number; modeStartedAt: number | null
            prizes: RafflePrize[]; draws: RaffleDraw[]
          }
          if (rd.ok) {
            setRaffleMode(rd.mode)
            setRaffleModeStartedAt(rd.modeStartedAt ?? null)
            setRaffleTotal(rd.total)
            setPrizes(rd.prizes)
            setDraws(rd.draws)
          }
        }
      } catch { /* next poll retries */ }
      // Same treatment: identity list rides the same refresh cadence and
      // must not blank the moderation feed if it fails.
      try {
        const idRes = await authedFetch('/api/admin/identity/list')
        if (idRes.ok) {
          const idData = await idRes.json() as { ok: boolean; unidentified: UnidentifiedGuest[] }
          if (idData.ok) setUnidentified(idData.unidentified)
        }
      } catch { /* next poll retries */ }
    } catch {
      setPollFailCount(c => c + 1)
    }
  }, [authedFetch])

  // Initial auth check, with backoff retry — a cold LINE WebView connection
  // or a single dropped packet shouldn't require the couple to manually
  // reload. Only a real 403 or repeated failure past AUTH_MAX_ATTEMPTS
  // surfaces a screen.
  const runCheck = useCallback(async () => {
    setAuthState('loading')
    setAuthMessage(null)
    for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await authedFetch('/api/admin/check')
        if (res.status === 403) { setAuthState('forbidden'); return }
        if (res.ok) { setAuthState('ok'); void refresh(); return }
        if (attempt === AUTH_MAX_ATTEMPTS) {
          setAuthState('error'); setAuthMessage(`HTTP ${res.status}`); return
        }
      } catch (e) {
        if (attempt === AUTH_MAX_ATTEMPTS) {
          setAuthState('error'); setAuthMessage(e instanceof Error ? e.message : 'unknown'); return
        }
      }
      await new Promise(r => setTimeout(r, AUTH_RETRY_BASE_MS * attempt))
    }
  }, [authedFetch, refresh])

  useEffect(() => {
    if (state.status !== 'ready') return
    void runCheck()
  }, [state.status, runCheck])

  // Live polling once authed.
  useEffect(() => {
    if (authState !== 'ok') return
    const t = setInterval(() => { refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [authState, refresh])

  // Read ?tab= once on mount (static export — no router, plain history API).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab')
    if (q && VALID_TABS.includes(q)) setTab(q as TabKey)
  }, [])
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url)
  }, [tab])

  // All mutating actions update the UI optimistically — the buttons were
  // unusably laggy when every click waited for the API round-trip plus a
  // full feed refresh. On failure we revert AND surface one shared toast;
  // the 5s poll reconciles any remaining drift either way.
  async function setDanmakuStatus(id: number, action: 'delete' | 'approve') {
    const nextStatus = action === 'delete' ? 'deleted' as const : 'approved' as const
    const before = danmaku
    setDanmaku(ds => ds.map(d => (d.id === id ? { ...d, status: nextStatus } : d)))
    const res = await authedFetch(`/api/admin/danmaku/${id}`, {
      method: 'POST', body: JSON.stringify({ action }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setDanmaku(before)
      flashActionError(action === 'delete' ? '刪除失敗，請再試一次' : '操作失敗，請再試一次')
    }
  }
  async function setPhotoStatus(id: number, action: 'hide' | 'unhide') {
    const nextStatus = action === 'hide' ? 'hidden' as const : 'visible' as const
    const before = photos
    setPhotos(ps => ps.map(p => (p.id === id ? { ...p, status: nextStatus } : p)))
    const res = await authedFetch(`/api/admin/photos/${id}`, {
      method: 'POST', body: JSON.stringify({ action }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setPhotos(before)
      flashActionError('操作失敗，請再試一次')
    }
  }
  async function approvePhoto(id: number) {
    const before = photos
    setPhotos(ps => ps.map(p => (p.id === id ? { ...p, status: 'visible' as const } : p)))
    const res = await authedFetch(`/api/admin/photos/${id}`, {
      method: 'POST', body: JSON.stringify({ action: 'approve' }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setPhotos(before)
      flashActionError('照片通過失敗，請再試一次')
    }
  }

  async function bulkApprovePending() {
    if (bulkApproving) return
    const ids = danmaku.filter(d => d.status === 'pending').map(d => d.id)
    if (ids.length === 0) return
    setBulkApproving(true)
    setBulkProgress({ done: 0, total: ids.length })
    for (const id of ids) {
      await setDanmakuStatus(id, 'approve')
      setBulkProgress(p => (p ? { ...p, done: p.done + 1 } : p))
    }
    setBulkApproving(false)
    setBulkProgress(null)
  }

  async function doDraw(prizeId: number) {
    if (drawing) return
    setDrawing(true)
    try {
      const res = await authedFetch('/api/admin/raffle/draw', {
        method: 'POST', body: JSON.stringify({ prizeId }),
      })
      const data = await res.json() as { ok?: boolean; draw?: RaffleDraw; error?: string }
      if (!res.ok || !data.ok || !data.draw) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDraws(ds => [data.draw!, ...ds])
      scheduleReveal(data.draw.id)
      setPrizes(ps => ps.map(p => (p.id === prizeId ? { ...p, remaining: Math.max(0, p.remaining - 1) } : p)))
    } catch (e) {
      flashActionError(e instanceof Error ? e.message : '開抽失敗')
    } finally {
      setDrawing(false)
    }
  }

  // 重抽 = forfeit the absent winner, then immediately draw the same prize.
  async function redraw(d: RaffleDraw) {
    if (drawing || d.prizeId === null) return
    setDrawing(true)
    try {
      const f = await authedFetch(`/api/admin/raffle/${d.id}`, {
        method: 'POST', body: JSON.stringify({ action: 'forfeit' }),
      })
      if (!f.ok) throw new Error(`forfeit HTTP ${f.status}`)
      setDraws(ds => ds.map(x => (x.id === d.id ? { ...x, status: 'forfeited' as const } : x)))
      const res = await authedFetch('/api/admin/raffle/draw', {
        method: 'POST', body: JSON.stringify({ prizeId: d.prizeId }),
      })
      const data = await res.json() as { ok?: boolean; draw?: RaffleDraw; error?: string }
      if (!res.ok || !data.ok || !data.draw) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDraws(ds => [data.draw!, ...ds])
      scheduleReveal(data.draw.id)
    } catch (e) {
      flashActionError(e instanceof Error ? e.message : '重抽失敗')
    } finally {
      setDrawing(false)
    }
  }

  async function toggleRaffleMode() {
    const prev = raffleMode
    const next = prev === 'on' ? 'off' : 'on'
    setRaffleMode(next)
    const res = await authedFetch('/api/admin/raffle/mode', {
      method: 'POST', body: JSON.stringify({ mode: next }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setRaffleMode(prev)
      flashActionError('切換抽獎模式失敗')
    }
  }

  async function toggleThankyouMode() {
    const prev = thankyouMode
    const next = prev === 'on' ? 'off' : 'on'
    setThankyouMode(next)
    const res = await authedFetch('/api/admin/thankyou/mode', {
      method: 'POST', body: JSON.stringify({ mode: next }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setThankyouMode(prev)
      flashActionError('切換悄悄話開關失敗')
    }
  }

  async function addPrize() {
    const name = newPrizeName.trim()
    const quantity = Number(newPrizeQty)
    if (!name || !Number.isInteger(quantity) || quantity < 1) return
    try {
      const res = await authedFetch('/api/admin/raffle/prizes', {
        method: 'POST', body: JSON.stringify({ name, quantity }),
      })
      const data = await res.json() as { ok?: boolean; id?: number; error?: string }
      if (!res.ok || !data.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`)
      setPrizes(ps => [...ps, { id: data.id!, name, quantity, remaining: quantity }])
      setNewPrizeName('')
      setNewPrizeQty('1')
    } catch (e) {
      flashActionError(e instanceof Error ? e.message : '新增獎項失敗')
    }
  }

  async function removePrize(id: number) {
    const before = prizes
    setPrizes(ps => ps.filter(p => p.id !== id))
    const res = await authedFetch(`/api/admin/raffle/prizes?id=${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null) as { error?: string } | null
      setPrizes(before)
      flashActionError(data?.error ?? '刪除獎項失敗')
    }
  }

  async function toggleMode() {
    const prev = mode
    const next = mode === 'auto' ? 'manual' : 'auto'
    setMode(next)
    const res = await authedFetch('/api/admin/mode', {
      method: 'POST', body: JSON.stringify({ mode: next }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setMode(prev)
      flashActionError('切換審核模式失敗')
    }
  }

  function identityDraft(userId: string) {
    return identityDrafts[userId] ?? { realName: '', partyId: '' }
  }
  function setIdentityDraft(userId: string, patch: Partial<{ realName: string; partyId: string }>) {
    setIdentityDrafts(d => ({ ...d, [userId]: { ...identityDraft(userId), ...patch } }))
  }
  async function saveIdentity(userId: string) {
    const draft = identityDraft(userId)
    const realName = draft.realName.trim()
    if (!realName) return
    setIdentitySaving(userId)
    try {
      const res = await authedFetch('/api/admin/identity/set', {
        method: 'POST',
        body: JSON.stringify({ userId, realName, partyId: draft.partyId.trim() || undefined }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setUnidentified(us => us.filter(u => u.userId !== userId))
      setIdentityDrafts(d => Object.fromEntries(Object.entries(d).filter(([id]) => id !== userId)))
    } catch (e) {
      flashActionError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setIdentitySaving(null)
    }
  }

  if (state.status === 'loading' || authState === 'loading') {
    return <Centered><Spinner label="驗證中…" /></Centered>
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
      <button className="btn-primary mt-6 px-6 py-2" onClick={() => void runCheck()}>重新連線</button>
    </Centered>
  }

  const visible = filter === 'pending'
    ? danmaku.filter(d => d.status === 'pending')
    : danmaku
  const pendingCount = danmaku.filter(d => d.status === 'pending').length
  const raffleElapsedMin = raffleModeStartedAt
    ? Math.max(0, Math.floor((Date.now() - raffleModeStartedAt) / 60000))
    : null
  const prizeQtyNum = Number(newPrizeQty)
  const prizeQtyValid = Number.isInteger(prizeQtyNum) && prizeQtyNum >= 1

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-serif">即時審核</h1>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-ink/50">審核模式（彈幕與照片）</span>
          <button
            className={`rounded-full px-4 py-1 text-sm font-medium ${
              mode === 'auto' ? 'bg-accent text-cream' : 'bg-red-600 text-cream'
            }`}
            onClick={toggleMode}
          >
            {mode === 'auto' ? 'AUTO' : 'MANUAL'}
          </button>
        </div>
      </header>

      {pollFailCount > 0 && (
        <div className="mb-4"><StatusBanner kind="info">連線不穩，重試中…</StatusBanner></div>
      )}
      {actionError && (
        <div className="mb-4"><StatusBanner kind="error">{actionError}</StatusBanner></div>
      )}

      <nav className="mb-6 flex gap-2 overflow-x-auto border-b border-champagne pb-3 text-sm">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={`shrink-0 rounded-full px-4 py-1 ${tab === key ? 'bg-ink text-cream' : 'bg-white border border-champagne'}`}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'danmaku' && danmaku.some(d => d.status === 'pending') && (
              <span className="ml-1 text-amber-400">●</span>
            )}
            {key === 'photos' && photos.some(p => p.status === 'pending') && (
              <span className="ml-1 text-amber-400">●</span>
            )}
            {key === 'identity' && unidentified.length > 0 && (
              <span className="ml-1 text-amber-400">●</span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'danmaku' && (<>
      <div className="mb-4 flex items-center gap-2 text-sm">
        <button
          className={`shrink-0 rounded-full px-3 py-1 ${filter === 'all' ? 'bg-ink text-cream' : 'bg-white border border-champagne'}`}
          onClick={() => setFilter('all')}
        >全部</button>
        <button
          className={`shrink-0 rounded-full px-3 py-1 ${filter === 'pending' ? 'bg-ink text-cream' : 'bg-white border border-champagne'}`}
          onClick={() => setFilter('pending')}
        >待審 ({pendingCount})</button>
        {filter === 'pending' && pendingCount > 0 && (
          <button
            className="ml-auto shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-cream disabled:opacity-50"
            disabled={bulkApproving}
            onClick={bulkApprovePending}
          >
            {bulkApproving
              ? `審核中 (${bulkProgress?.done ?? 0}/${bulkProgress?.total ?? pendingCount})`
              : `全部通過（${pendingCount}）`}
          </button>
        )}
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
                  {d.status === 'deleted' && (
                    <button
                      className="rounded border border-champagne bg-white px-2 py-1 text-xs text-ink/70"
                      onClick={() => setDanmakuStatus(d.id, 'approve')}
                    >復原</button>
                  )}
                  {d.status !== 'deleted' && (
                    <ConfirmButton
                      label="刪除"
                      confirmLabel="確定刪除？"
                      className="rounded bg-red-600 px-2 py-1 text-xs text-cream"
                      onConfirm={() => setDanmakuStatus(d.id, 'delete')}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      </>)}

      {tab === 'raffle' && (
      <section>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm text-ink/60">{raffleTotal} 人參加</p>
          <button
            className={`rounded-full px-4 py-1 text-sm font-medium ${
              raffleMode === 'on' ? 'bg-amber-600 text-cream' : 'bg-white border border-champagne text-ink/70'
            }`}
            onClick={toggleRaffleMode}
          >
            {raffleMode === 'on' ? '⏸ 結束抽獎時間' : '▶ 開始抽獎時間'}
          </button>
        </div>
        {raffleMode === 'on' && raffleElapsedMin !== null && (
          <p className="mb-1 text-xs text-accent">抽獎模式已開啟 {raffleElapsedMin} 分鐘</p>
        )}
        <p className="mb-5 text-xs text-ink/40">
          抽獎時間開啟時，大螢幕會顯示「抽獎時間」與獎項清單；開抽後 3 秒內播放開獎動畫。
        </p>

        {draws.length > 0 && (
          <>
            <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">得獎紀錄</h2>
            <ul className="mb-8 space-y-2">
              {draws.map(d => (
                <li key={d.id} className={`rounded-md border bg-white p-3 ${
                  d.status === 'forfeited' ? 'border-champagne opacity-40' : 'border-champagne'
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm">
                        {d.prize} → <span className="font-medium">
                          {pendingReveal.has(d.id) ? '大螢幕開獎中…' : d.winnerName}
                        </span>
                        {d.status === 'forfeited' && <span className="ml-2 text-xs text-red-600">已作廢</span>}
                      </p>
                      <p className="mt-1 text-xs text-ink/50">
                        {new Date(d.drawnAt).toLocaleTimeString('zh-TW', { hour12: false })}
                      </p>
                    </div>
                    {d.status === 'active' && d.prizeId !== null && (
                      <ConfirmButton
                        label="人不在，重抽"
                        confirmLabel="確定重抽？"
                        className="shrink-0 rounded bg-amber-600 px-2 py-1 text-xs text-cream disabled:opacity-50"
                        disabled={drawing}
                        onConfirm={() => redraw(d)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">獎項</h2>
        <ul className="space-y-2">
          {prizes.length === 0 && <li className="text-sm text-ink/50">尚無獎項。</li>}
          {prizes.map(p => (
            <li key={p.id} className={`rounded-md border border-champagne bg-white p-3 ${
              p.remaining === 0 ? 'opacity-40' : ''
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-ink/50">
                    {p.remaining === 0 ? '已抽完' : `剩 ${p.remaining} / ${p.quantity}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ConfirmButton
                    label={drawing ? '抽獎中…' : '開抽 🎲'}
                    confirmLabel="確定開抽？"
                    className="btn-primary px-4 py-1 text-sm disabled:opacity-50"
                    disabled={drawing || p.remaining === 0}
                    onConfirm={() => doDraw(p.id)}
                  />
                  {p.remaining === p.quantity && (
                    <ConfirmButton
                      label="刪除"
                      confirmLabel="確定刪除？"
                      className="min-h-[44px] shrink-0 rounded-md border border-champagne bg-white px-4 text-sm text-ink/70"
                      onConfirm={() => removePrize(p.id)}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex gap-2">
          <input
            className="field-input flex-1"
            placeholder="新增獎項名稱"
            value={newPrizeName}
            onChange={e => setNewPrizeName(e.target.value)}
            maxLength={40}
          />
          <input
            className="field-input w-20"
            type="number"
            min={1}
            value={newPrizeQty}
            onChange={e => setNewPrizeQty(e.target.value)}
          />
          <button
            className="shrink-0 rounded-md border border-champagne bg-white px-4 text-sm"
            disabled={!newPrizeName.trim() || !prizeQtyValid}
            onClick={addPrize}
          >新增</button>
        </div>
        {newPrizeQty !== '' && !prizeQtyValid && (
          <p className="mt-1 text-xs text-red-600">數量需為 1 以上的整數</p>
        )}
      </section>
      )}

      {tab === 'thankyou' && (
      <section>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-ink/60">悄悄話（賓客的專屬感謝卡）</p>
          <button
            className={`rounded-full px-4 py-1 text-sm font-medium ${
              thankyouMode === 'on' ? 'bg-emerald-600 text-cream' : 'bg-white border border-champagne text-ink/70'
            }`}
            onClick={toggleThankyouMode}
          >
            {thankyouMode === 'on' ? '✓ 已開放' : '🔒 未開放'}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-ink/50">
          關閉時，賓客在聊天室送出「悄悄話」只會看到「婚禮當天再開放」的提示，看不到你們準備的卡片內容。
          打開後，所有人送出「悄悄話」就會立刻收到自己的專屬卡片。建議在婚禮當天想公開的時刻再打開。
        </p>
      </section>
      )}

      {tab === 'identity' && (
      <section>
        <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">未命名賓客</h2>
        <p className="mb-4 text-xs leading-relaxed text-ink/50">
          這些人只透過抽獎留下 LINE 資料，還沒有真實姓名。補上姓名（可選填團編號）方便對照名單與座位。
        </p>
        <ul className="space-y-2">
          {unidentified.length === 0 && <li className="text-sm text-ink/50">目前沒有未命名的人。</li>}
          {unidentified.map(u => {
            const draft = identityDraft(u.userId)
            const saving = identitySaving === u.userId
            return (
              <li key={u.userId} className="rounded-md border border-champagne bg-white p-3">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {u.avatarUrl
                    ? <img src={u.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    : <div className="h-10 w-10 shrink-0 rounded-full bg-champagne" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink/70">{u.displayName}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        className="field-input min-w-0 flex-1"
                        placeholder="真實姓名"
                        value={draft.realName}
                        onChange={e => setIdentityDraft(u.userId, { realName: e.target.value })}
                        maxLength={40}
                      />
                      <input
                        className="field-input w-28"
                        placeholder="團編號（選填）"
                        value={draft.partyId}
                        onChange={e => setIdentityDraft(u.userId, { partyId: e.target.value })}
                        maxLength={20}
                      />
                      <button
                        className="btn-primary px-4 py-1 text-sm"
                        disabled={saving || !draft.realName.trim()}
                        onClick={() => saveIdentity(u.userId)}
                      >{saving ? '儲存中…' : '儲存'}</button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
      )}

      {tab === 'photos' && (
      <section>
        <h2 className="mb-2 text-sm uppercase tracking-widest text-accent">照片</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.length === 0 && <li className="text-sm text-ink/50">沒有照片。</li>}
          {photos.map(p => (
            <li key={p.id} className={`overflow-hidden rounded-md border bg-white ${
              p.status === 'pending' ? 'border-amber-400' :
              p.status === 'hidden' ? 'border-red-400 opacity-50' :
              'border-champagne'
            }`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="aspect-square w-full object-cover" />
              <div className="p-2">
                <p className="truncate text-xs text-ink/60">{p.uploaderName}</p>
                {p.caption && <p className="truncate text-xs text-ink/40">{p.caption}</p>}
                {p.status === 'pending' ? (
                  <button
                    className="mt-2 w-full rounded bg-emerald-600 px-2 py-1 text-xs text-cream"
                    onClick={() => approvePhoto(p.id)}
                  >通過</button>
                ) : (
                  <button
                    className={`mt-2 w-full rounded px-2 py-1 text-xs ${
                      p.status === 'hidden' ? 'bg-emerald-600 text-cream' : 'bg-red-600 text-cream'
                    }`}
                    onClick={() => setPhotoStatus(p.id, p.status === 'hidden' ? 'unhide' : 'hide')}
                  >
                    {p.status === 'hidden' ? '取消隱藏' : '隱藏'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      )}
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-6 py-20 text-center">{children}</main>
}

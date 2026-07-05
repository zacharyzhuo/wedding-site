'use client'

// Venue display: photo carousel as the background, danmaku flying across the
// top. Polled, not WebSocket — at one viewer this is the simplest model that
// could work.
//
// URL: /screen?token=<SCREEN_TOKEN>
// Token validation lives in /api/screen/feed; a missing/wrong token returns
// no data and the page renders "等待連線中…".
//
// Operate it: on the AV laptop, open the URL, F11 to fullscreen, leave it.

import { useCallback, useEffect, useRef, useState } from 'react'

type DanmakuItem = {
  id: number
  displayName: string
  message: string
  photoId: number | null
  createdAt: number
}
type PhotoItem = {
  id: number
  url: string
  uploaderName: string
  caption: string | null
  createdAt: number
}

const POLL_BASE_MS = 3000
const POLL_JITTER_MS = 500
const CAROUSEL_INTERVAL_MS = 4000
const DANMAKU_LIFETIME_MS = 14500 // matches CSS animation + a small safety margin
const DANMAKU_ROW_COUNT = 4
// The carousel keeps the WHOLE night chronologically and loops it — every
// photo keeps getting airtime. The cap is a memory backstop only.
const PHOTO_CAP = 1000
// Replay: when the live stream goes quiet, re-fly a random old message so the
// screen never sits empty between bursts. The pool is REPLACED on every
// refresh (not accumulated), so a message the admin deletes stops replaying
// within one refresh cycle at worst.
const REPLAY_IDLE_MS = 9000
const REPLAY_POOL_REFRESH_MS = 30000
const REPLAY_CHECK_MS = 3000

export default function ScreenPage() {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState<string>('')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [currentPhoto, setCurrentPhoto] = useState<PhotoItem | null>(null)
  const [previousPhoto, setPreviousPhoto] = useState<PhotoItem | null>(null)
  const [liveDanmaku, setLiveDanmaku] = useState<Array<DanmakuItem & { rowY: number; key: string }>>([])
  const cursorRef = useRef<number>(0)
  const seenDanmakuRef = useRef<Set<number>>(new Set())
  const seenPhotoRef = useRef<Set<number>>(new Set())
  const stopRef = useRef(false)
  const replayPoolRef = useRef<DanmakuItem[]>([])
  const lastLaunchRef = useRef<number>(0)
  const lastReplayIdRef = useRef<number>(0)
  // Mirrors of the display state so the poll closure can report what is
  // currently on screen (for server-side removal reconciliation) without
  // re-subscribing the polling effect to every state change.
  const liveDanmakuRef = useRef<Array<DanmakuItem & { rowY: number; key: string }>>([])
  const photosRef = useRef<PhotoItem[]>([])
  useEffect(() => { liveDanmakuRef.current = liveDanmaku }, [liveDanmaku])
  useEffect(() => { photosRef.current = photos }, [photos])
  const currentPhotoRef = useRef<PhotoItem | null>(null)
  useEffect(() => { currentPhotoRef.current = currentPhoto }, [currentPhoto])
  // New uploads jump the display queue — the uploader is standing in front
  // of the screen waiting for exactly this moment.
  const freshQueueRef = useRef<PhotoItem[]>([])
  const posRef = useRef(0) // position of currentPhoto in the chronological loop

  // Raffle reveal. lastDrawIdRef === null means "haven't synced yet": the
  // first poll records the current latest draw WITHOUT animating, so a
  // screen restart mid-event doesn't replay an old reveal to the room.
  const lastDrawIdRef = useRef<number | null>(null)
  const raffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [raffleMode, setRaffleMode] = useState<'on' | 'off'>('off')
  const [raffleStandby, setRaffleStandby] = useState<null | {
    total: number
    prizes: Array<{
      name: string; quantity: number; remaining: number
      winners: Array<{ name: string; avatar: string | null }>
    }>
  }>(null)
  const [raffleShow, setRaffleShow] = useState<null | {
    prize: string; winnerName: string; winnerAvatar: string | null
  }>(null)
  const [raffleStage, setRaffleStage] = useState<'rolling' | 'reveal'>('rolling')
  const [rolling, setRolling] = useState<{ name: string; avatar: string | null }>({ name: '', avatar: null })
  useEffect(() => () => { if (raffleTimerRef.current) clearTimeout(raffleTimerRef.current) }, [])

  const startRaffleReveal = useCallback((
    draw: { prize: string; winnerName: string; winnerAvatar: string | null },
    entrants: Array<{ name: string; avatar: string | null }>,
  ) => {
    if (raffleTimerRef.current) clearTimeout(raffleTimerRef.current)
    const pool = entrants.length > 0
      ? entrants
      : [{ name: draw.winnerName, avatar: draw.winnerAvatar }]
    setRaffleShow({ prize: draw.prize, winnerName: draw.winnerName, winnerAvatar: draw.winnerAvatar })
    setRaffleStage('rolling')
    // Avatar+name roll that decelerates like a slot machine, then the reveal
    // holds for 10 s before the screen falls back to standby / carousel.
    let delay = 70
    const spin = () => {
      setRolling(pool[Math.floor(Math.random() * pool.length)])
      delay *= 1.13
      if (delay < 420) {
        raffleTimerRef.current = setTimeout(spin, delay)
      } else {
        raffleTimerRef.current = setTimeout(() => {
          setRaffleStage('reveal')
          raffleTimerRef.current = setTimeout(() => setRaffleShow(null), 10000)
        }, delay)
      }
    }
    spin()
  }, [])

  // Lift token from the query string. Done in an effect so this stays
  // statically renderable.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = new URL(window.location.href).searchParams.get('token') ?? ''
    setToken(t)
    setReady(true)
  }, [])

  // Put one message on screen. No dedupe here — replays go through this
  // directly; the live path dedupes in pushDanmaku before calling it.
  const launchDanmaku = useCallback((item: DanmakuItem) => {
    // Random row + 0–60 px jitter so two messages don't perfectly stack.
    const row = Math.floor(Math.random() * DANMAKU_ROW_COUNT)
    const rowY = 64 + row * 96 + Math.floor(Math.random() * 60)
    const entry = { ...item, rowY, key: `${item.id}-${Math.random().toString(36).slice(2, 7)}` }
    lastLaunchRef.current = Date.now()
    setLiveDanmaku(prev => [...prev, entry])
    // Each entry self-removes after the animation completes; safety net here
    // covers cases where the animationend event is missed.
    setTimeout(() => {
      setLiveDanmaku(prev => prev.filter(d => d.key !== entry.key))
    }, DANMAKU_LIFETIME_MS)
  }, [])

  const pushDanmaku = useCallback((items: DanmakuItem[]) => {
    for (const item of items) {
      if (seenDanmakuRef.current.has(item.id)) continue
      seenDanmakuRef.current.add(item.id)
      launchDanmaku(item)
    }
  }, [launchDanmaku])

  // Advance the carousel one step: freshly uploaded photos jump the queue,
  // otherwise continue the chronological all-night loop.
  const advancePhoto = useCallback(() => {
    const list = photosRef.current
    if (list.length === 0) {
      setPreviousPhoto(null)
      setCurrentPhoto(null)
      return
    }
    let nextIdx = -1
    // Skip fresh entries that were removed before they got their turn.
    while (freshQueueRef.current.length > 0 && nextIdx < 0) {
      const fresh = freshQueueRef.current.shift()!
      nextIdx = list.findIndex(p => p.id === fresh.id)
    }
    if (nextIdx < 0) nextIdx = (posRef.current + 1) % list.length
    const next = list[nextIdx]
    const cur = currentPhotoRef.current
    if (cur && next.id === cur.id) return // single-photo night: hold still
    posRef.current = nextIdx
    setPreviousPhoto(cur)
    setCurrentPhoto(next)
  }, [])

  const ingestPhotos = useCallback((items: PhotoItem[]) => {
    if (items.length === 0) return
    const fresh = items.filter(p => !seenPhotoRef.current.has(p.id))
    if (fresh.length === 0) return
    fresh.forEach(p => seenPhotoRef.current.add(p.id))
    // Append chronologically (items arrive oldest-first after the caller's
    // reverse). PHOTO_CAP only drops the oldest as a memory backstop.
    const merged = [...photosRef.current, ...fresh]
    const next = merged.length > PHOTO_CAP ? merged.slice(merged.length - PHOTO_CAP) : merged
    photosRef.current = next
    setPhotos(next)
    freshQueueRef.current.push(...fresh)
    // First photo of the night: show it now instead of waiting for the tick.
    if (currentPhotoRef.current === null) advancePhoto()
  }, [advancePhoto])

  // Polling loop.
  useEffect(() => {
    if (!ready || !token) return
    stopRef.current = false

    async function tick() {
      if (stopRef.current) return
      try {
        // Report what's on screen so the server can tell us what the admin
        // has deleted/hidden in the meantime.
        const activeD = liveDanmakuRef.current.map(d => d.id).join(',')
        const activeP = photosRef.current.map(p => p.id).join(',')
        const url = `/api/screen/feed?token=${encodeURIComponent(token)}&since=${cursorRef.current}`
          + (activeD ? `&active_d=${activeD}` : '')
          + (activeP ? `&active_p=${activeP}` : '')
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as {
            ok: boolean; danmaku: DanmakuItem[]; photos: PhotoItem[]; cursor: number
            removedDanmaku?: number[]; removedPhotos?: number[]
            raffle?: {
              mode: 'on' | 'off'
              standby: {
                total: number
                prizes: Array<{
                  name: string; quantity: number; remaining: number
                  winners: Array<{ name: string; avatar: string | null }>
                }>
              } | null
              entrants: Array<{ name: string; avatar: string | null }>
              draw: {
                id: number; prize: string; winnerName: string
                winnerAvatar: string | null; drawnAt: number
              } | null
            } | null
          }
          if (data.ok) {
            // Insert oldest-first so the visual order on screen matches send order.
            pushDanmaku([...data.danmaku].reverse())
            ingestPhotos([...data.photos].reverse())
            cursorRef.current = data.cursor

            const rmD = new Set(data.removedDanmaku ?? [])
            const rmP = new Set(data.removedPhotos ?? [])
            if (rmD.size > 0) {
              // Pull deleted messages out mid-flight and out of the replay
              // pool — an admin delete must not keep circling the room.
              setLiveDanmaku(prev => prev.filter(d => !rmD.has(d.id)))
              replayPoolRef.current = replayPoolRef.current.filter(d => !rmD.has(d.id))
            }
            if (rmP.size > 0) {
              const next = photosRef.current.filter(p => !rmP.has(p.id))
              photosRef.current = next
              setPhotos(next)
              freshQueueRef.current = freshQueueRef.current.filter(p => !rmP.has(p.id))
              const cur = currentPhotoRef.current
              if (cur) {
                if (rmP.has(cur.id)) {
                  advancePhoto() // pull the hidden photo off screen now
                } else {
                  posRef.current = Math.max(0, next.findIndex(p => p.id === cur.id))
                }
              }
            }

            const raffle = data.raffle ?? null
            if (raffle) {
              setRaffleMode(raffle.mode)
              setRaffleStandby(raffle.standby)
              if (raffle.draw) {
                if (lastDrawIdRef.current === null) {
                  lastDrawIdRef.current = raffle.draw.id // sync without replaying
                } else if (raffle.draw.id > lastDrawIdRef.current) {
                  lastDrawIdRef.current = raffle.draw.id
                  startRaffleReveal(raffle.draw, raffle.entrants)
                }
              } else if (lastDrawIdRef.current === null) {
                lastDrawIdRef.current = 0 // no draws yet; the first one animates
              }
            }
          }
        }
      } catch {
        // Swallow transient errors — next tick will retry. Don't blank the
        // screen in front of guests just because Wi-Fi flickered.
      }
      const delay = POLL_BASE_MS + Math.floor(Math.random() * POLL_JITTER_MS)
      setTimeout(tick, delay)
    }
    tick()

    return () => { stopRef.current = true }
  }, [ready, token, pushDanmaku, ingestPhotos, advancePhoto, startRaffleReveal])

  // Replay pool refresh. Fetches the latest approved set from scratch and
  // REPLACES the pool, so admin deletions age out of replays within
  // REPLAY_POOL_REFRESH_MS at worst.
  useEffect(() => {
    if (!ready || !token) return
    let stopped = false

    async function refreshPool() {
      if (stopped) return
      try {
        const res = await fetch(`/api/screen/feed?token=${encodeURIComponent(token)}&since=0`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as { ok: boolean; danmaku: DanmakuItem[] }
          if (data.ok) replayPoolRef.current = data.danmaku
        }
      } catch {
        // Same rationale as the live poll: never blank the screen over a blip.
      }
      setTimeout(refreshPool, REPLAY_POOL_REFRESH_MS)
    }
    refreshPool()

    return () => { stopped = true }
  }, [ready, token])

  // Replay scheduler: if nothing has launched for REPLAY_IDLE_MS, re-fly a
  // random already-shown message. Live traffic resets the idle clock via
  // launchDanmaku, so replays only fill genuine gaps. Only messages this
  // session has already flown are eligible — that keeps a brand-new message
  // from double-flying (once as replay, once when the live poll lands it).
  useEffect(() => {
    if (!ready || !token) return
    const t = setInterval(() => {
      if (Date.now() - lastLaunchRef.current < REPLAY_IDLE_MS) return
      const candidates = replayPoolRef.current.filter(d => seenDanmakuRef.current.has(d.id))
      if (candidates.length === 0) return
      let pick = candidates[Math.floor(Math.random() * candidates.length)]
      if (candidates.length > 1 && pick.id === lastReplayIdRef.current) {
        pick = candidates[(candidates.indexOf(pick) + 1) % candidates.length]
      }
      lastReplayIdRef.current = pick.id
      launchDanmaku(pick)
    }, REPLAY_CHECK_MS)
    return () => clearInterval(t)
  }, [ready, token, launchDanmaku])

  // Carousel rotation. Gated on a boolean (not photos.length) so upload
  // bursts don't keep resetting the interval; advancePhoto holds still on a
  // single-photo night.
  const hasPhotos = photos.length > 0
  useEffect(() => {
    if (!hasPhotos) return
    const t = setInterval(advancePhoto, CAROUSEL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [hasPhotos, advancePhoto])

  return (
    <div className="fixed inset-0 bg-ink overflow-hidden">
      {/* Photo carousel */}
      <div className="absolute inset-0">
        {currentPhoto === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-cream/40 text-2xl">
            等待第一張照片…
          </div>
        ) : (
          /* Only the outgoing and incoming slides live in the DOM — the
             all-night list can run to hundreds of photos. */
          <>
            {previousPhoto && previousPhoto.id !== currentPhoto.id && (
              <div key={`prev-${previousPhoto.id}`} className="carousel-slide prev" aria-hidden>
                <div
                  className="carousel-backdrop"
                  style={{ backgroundImage: `url(${previousPhoto.url})` }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="carousel-photo" src={previousPhoto.url} alt="" />
              </div>
            )}
            <div key={currentPhoto.id} className="carousel-slide active">
              <div
                className="carousel-backdrop"
                style={{ backgroundImage: `url(${currentPhoto.url})` }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="carousel-photo" src={currentPhoto.url} alt="" />
            </div>
          </>
        )}
      </div>

      {/* Danmaku overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {liveDanmaku.map(d => (
          <div
            key={d.key}
            className="danmaku-item"
            style={{ ['--row-y' as string]: `${d.rowY}px` }}
            onAnimationEnd={() => {
              setLiveDanmaku(prev => prev.filter(x => x.key !== d.key))
            }}
          >
            <span>{d.message}</span>
            <span className="name">— {d.displayName}</span>
          </div>
        ))}
      </div>

      {/* Raffle standby takeover — between draws while raffle mode is ON. */}
      {raffleMode === 'on' && !raffleShow && (
        <div className="raffle-overlay standby">
          <p className="raffle-prize">🎁 抽獎時間 🎁</p>
          {raffleStandby && raffleStandby.prizes.length > 0 && (
            <ul className="raffle-prizelist">
              {raffleStandby.prizes.map(p => (
                <li key={p.name} className={p.remaining === 0 ? 'done' : ''}>
                  <div>
                    {p.name}
                    <span className="count">
                      {p.remaining === 0 ? '已抽完' : `剩 ${p.remaining} / ${p.quantity}`}
                    </span>
                  </div>
                  {p.winners.length > 0 && (
                    <div className="winners">
                      {p.winners.map((w, i) => (
                        <span key={i} className="winner-chip">
                          {w.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={w.avatar} alt="" />
                          ) : (
                            <span className="winner-fallback">{w.name.slice(0, 1)}</span>
                          )}
                          {w.name}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="raffle-standby-hint">
            {raffleStandby ? `目前 ${raffleStandby.total} 人參加` : ''}
            　·　官方帳號選單「抽獎」即可報名
          </p>
        </div>
      )}

      {/* Raffle reveal overlay — sits above carousel, danmaku and standby. */}
      {raffleShow && (
        <div className="raffle-overlay">
          <p className="raffle-prize">{raffleShow.prize}</p>
          {raffleStage === 'rolling' ? (
            <>
              <RaffleAvatar name={rolling.name} avatar={rolling.avatar} size="roll" />
              <p className="raffle-name">{rolling.name}</p>
            </>
          ) : (
            <>
              <RaffleAvatar name={raffleShow.winnerName} avatar={raffleShow.winnerAvatar} size="reveal" />
              <p className="raffle-name reveal">{raffleShow.winnerName}</p>
              <p className="raffle-congrats">🎉 恭喜中獎 🎉</p>
              <div className="raffle-confetti" aria-hidden>
                {/* Deterministic positions/delays — no randomness in render. */}
                {Array.from({ length: 36 }).map((_, i) => (
                  <span
                    key={i}
                    style={{
                      left: `${(i * 137) % 100}%`,
                      animationDelay: `${(i % 12) * 0.25}s`,
                      background: ['#e8b4b8', '#f5e6c8', '#b8c8e8', '#d8e8c8'][i % 4],
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Connection hint, only when nothing comes in. Kept out of the way. */}
      {!token && (
        <div className="absolute bottom-4 right-6 text-cream/40 text-sm">
          缺少 token 參數 — 請使用 /screen?token=…
        </div>
      )}
    </div>
  )
}

// LINE avatars are optional (users can hide them) — fall back to an initial.
function RaffleAvatar({ name, avatar, size }: { name: string; avatar: string | null; size: 'roll' | 'reveal' }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`raffle-avatar ${size}`} src={avatar} alt="" />
  }
  return <span className={`raffle-avatar fallback ${size}`}>{name.slice(0, 1)}</span>
}

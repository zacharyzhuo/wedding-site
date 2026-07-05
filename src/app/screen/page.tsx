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
const CAROUSEL_INTERVAL_MS = 6000
const DANMAKU_LIFETIME_MS = 14500 // matches CSS animation + a small safety margin
const DANMAKU_ROW_COUNT = 4
const PHOTO_RING_CAP = 30

export default function ScreenPage() {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState<string>('')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [liveDanmaku, setLiveDanmaku] = useState<Array<DanmakuItem & { rowY: number; key: string }>>([])
  const cursorRef = useRef<number>(0)
  const seenDanmakuRef = useRef<Set<number>>(new Set())
  const seenPhotoRef = useRef<Set<number>>(new Set())
  const stopRef = useRef(false)

  // Lift token from the query string. Done in an effect so this stays
  // statically renderable.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = new URL(window.location.href).searchParams.get('token') ?? ''
    setToken(t)
    setReady(true)
  }, [])

  const pushDanmaku = useCallback((items: DanmakuItem[]) => {
    if (items.length === 0) return
    const additions: Array<DanmakuItem & { rowY: number; key: string }> = []
    for (const item of items) {
      if (seenDanmakuRef.current.has(item.id)) continue
      seenDanmakuRef.current.add(item.id)
      // Random row + 0–60 px jitter so two messages don't perfectly stack.
      const row = Math.floor(Math.random() * DANMAKU_ROW_COUNT)
      const rowY = 64 + row * 96 + Math.floor(Math.random() * 60)
      additions.push({ ...item, rowY, key: `${item.id}-${Math.random().toString(36).slice(2, 7)}` })
    }
    if (additions.length === 0) return
    setLiveDanmaku(prev => [...prev, ...additions])
    // Each entry self-removes after the animation completes; safety net here
    // covers cases where the animationend event is missed.
    additions.forEach(a => {
      setTimeout(() => {
        setLiveDanmaku(prev => prev.filter(d => d.key !== a.key))
      }, DANMAKU_LIFETIME_MS)
    })
  }, [])

  const ingestPhotos = useCallback((items: PhotoItem[]) => {
    if (items.length === 0) return
    const fresh = items.filter(p => !seenPhotoRef.current.has(p.id))
    if (fresh.length === 0) return
    fresh.forEach(p => seenPhotoRef.current.add(p.id))
    setPhotos(prev => {
      // Newest first, dedupe by id, cap to a sliding ring so memory stays bounded.
      const merged = [...fresh, ...prev]
      const seen = new Set<number>()
      const out: PhotoItem[] = []
      for (const p of merged) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
        if (out.length >= PHOTO_RING_CAP) break
      }
      return out
    })
  }, [])

  // Polling loop.
  useEffect(() => {
    if (!ready || !token) return
    stopRef.current = false

    async function tick() {
      if (stopRef.current) return
      try {
        const url = `/api/screen/feed?token=${encodeURIComponent(token)}&since=${cursorRef.current}`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as {
            ok: boolean; danmaku: DanmakuItem[]; photos: PhotoItem[]; cursor: number
          }
          if (data.ok) {
            // Insert oldest-first so the visual order on screen matches send order.
            pushDanmaku([...data.danmaku].reverse())
            ingestPhotos([...data.photos].reverse())
            cursorRef.current = data.cursor
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
  }, [ready, token, pushDanmaku, ingestPhotos])

  // Carousel rotation.
  useEffect(() => {
    if (photos.length <= 1) return
    const t = setInterval(() => {
      setCarouselIndex(i => (i + 1) % photos.length)
    }, CAROUSEL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [photos.length])

  return (
    <div className="fixed inset-0 bg-ink overflow-hidden">
      {/* Photo carousel */}
      <div className="absolute inset-0">
        {photos.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-cream/40 text-2xl">
            等待第一張照片…
          </div>
        ) : (
          photos.map((p, i) => (
            <div
              key={p.id}
              className={`carousel-slide ${i === carouselIndex ? 'active' : ''}`}
              style={{ backgroundImage: `url(${p.url})` }}
              aria-hidden={i !== carouselIndex}
            />
          ))
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

      {/* Connection hint, only when nothing comes in. Kept out of the way. */}
      {!token && (
        <div className="absolute bottom-4 right-6 text-cream/40 text-sm">
          缺少 token 參數 — 請使用 /screen?token=…
        </div>
      )}
    </div>
  )
}

'use client'

// Public landing = the digital invitation (喜帖). Rebuilt 2026-07-06 in the
// style language of the reference invitation the couple loves (arch photo
// cards + offset solid shadows, three-font pairing, wide-tracked eyebrows)
// on the site's own cream/champagne palette.
//
// Photo slots are PLACEHOLDERS until the pre-wedding shoot (2026-09-07):
// every arch tile is a gradient block that swaps to a background-image with
// zero layout change. Copy marked 佔位 below is placeholder too.
//
// The funnel job is unchanged: every RSVP path leads to adding the LINE OA
// (see references/line-oa.md); /rsvp-fallback stays one click away for
// non-LINE guests.

import { useEffect, useState } from 'react'
import { Eyebrow } from '@/components/ui'

const ADD_FRIEND_URL =
  process.env.NEXT_PUBLIC_LINE_OA_ADD_FRIEND_URL ?? 'https://line.me/R/ti/p/@160vcltf'
const FALLBACK_RSVP_URL = '/rsvp-fallback'
const MAP_URL = 'https://maps.app.goo.gl/sP5bShxFgY8Lqd5d7'
const WEDDING_TS = new Date('2027-06-05T18:00:00+08:00').getTime()

// Ceremony flow — 佔位 times, finalised with the paper invitation.
const TIMELINE = [
  { time: '17:30', label: '迎賓入席' },
  { time: '18:00', label: '婚宴開始' },
  { time: '19:30', label: '互動抽獎' },
  { time: '21:00', label: '送客合影' },
]

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.15 },
    )
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])
}

function useCountdown() {
  const [left, setLeft] = useState<null | { d: number; h: number; m: number; s: number }>(null)
  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, WEDDING_TS - Date.now())
      setLeft({
        d: Math.floor(ms / 86400000),
        h: Math.floor(ms / 3600000) % 24,
        m: Math.floor(ms / 60000) % 60,
        s: Math.floor(ms / 1000) % 60,
      })
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  return left
}

export default function InvitationPage() {
  useReveal()
  const left = useCountdown()

  return (
    <main className="overflow-hidden">
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="hero-item font-display text-sm tracking-[0.5em] text-accent" style={{ animationDelay: '0ms' }}>
          2027 · 06 · 05
        </p>

        <div className="hero-item relative mt-10" style={{ animationDelay: '150ms' }}>
          <div className="arch arch-hero flex items-end justify-center">
            <span className="mb-10 font-display text-5xl text-cream/95">Z&nbsp;&amp;&nbsp;A</span>
          </div>
          <p className="mt-4 text-[11px] tracking-[0.3em] text-ink/35">婚紗照 · 2026 秋登場</p>
        </div>

        <h1 className="hero-item mt-8 text-4xl font-semibold tracking-[0.1em] sm:text-5xl" style={{ animationDelay: '300ms' }}>
          卓育辰 <span className="font-display text-accent">&amp;</span> 楊皖淩
        </h1>
        <p className="hero-item mt-4 font-script text-2xl text-ink/60" style={{ animationDelay: '450ms' }}>
          We&rsquo;re getting married
        </p>

        <p
          className="hero-item mt-12 animate-bounce motion-reduce:animate-none text-ink/30"
          style={{ animationDelay: '600ms' }}
          aria-hidden
        >
          ↓
        </p>
      </section>

      {/* ─── 新郎新娘 ─────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <div className="reveal">
          <Eyebrow script="the groom &amp; the bride">新郎新娘</Eyebrow>
        </div>
        <div className="mx-auto mt-14 grid max-w-lg grid-cols-2 gap-x-6 gap-y-10 sm:gap-x-10">
          <figure className="reveal text-center">
            <div className="arch arch-portrait -rotate-2 bg-gradient-to-br from-champagne via-[#ddc9b2] to-accent/60 flex items-center justify-center">
              <span className="font-display text-6xl text-cream/90">Z</span>
            </div>
            <figcaption className="mt-6">
              <p className="text-lg font-semibold tracking-[0.2em]">卓育辰</p>
              <p className="mt-1 font-display text-xs tracking-[0.25em] text-accent">ZACHARY</p>
              <p className="mt-3 text-sm leading-relaxed text-ink/60">
                工程師。這個網站的每一行程式，都是為了今天寫的。
              </p>
            </figcaption>
          </figure>
          <figure className="reveal reveal-delay-1 text-center">
            <div className="arch arch-portrait rotate-2 bg-gradient-to-bl from-[#eedfd6] via-[#e4c9bd] to-[#cfa08e]/70 flex items-center justify-center">
              <span className="font-display text-6xl text-cream/90">A</span>
            </div>
            <figcaption className="mt-6">
              <p className="text-lg font-semibold tracking-[0.2em]">楊皖淩</p>
              <p className="mt-1 font-display text-xs tracking-[0.25em] text-accent">ANGELET</p>
              <p className="mt-3 text-sm leading-relaxed text-ink/60">
                （佔位）皖淩的一句話介紹，之後換成你們想寫的。
              </p>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ─── Our Story（佔位文案） ───────────────────────────── */}
      <section className="bg-white/50 px-6 py-24">
        <div className="reveal">
          <Eyebrow script="our story">我們的故事</Eyebrow>
        </div>
        <div className="reveal mx-auto mt-10 max-w-md space-y-6 text-center leading-loose text-ink/70">
          <p>
            （佔位）從相遇到決定牽手一生，這裡會放你們的故事——
            怎麼認識的、哪一刻確定是彼此、求婚那天發生了什麼。
          </p>
          <p>
            兩三段就好，講給來吃喜酒的人聽，也講給多年後的自己聽。
          </p>
          <p className="font-script text-xl text-accent/80">— perfectly, we met —</p>
        </div>
      </section>

      {/* ─── 婚禮資訊 ─────────────────────────────────────────── */}
      <section className="px-6 py-24">
        <div className="reveal">
          <Eyebrow script="wedding day">婚禮資訊</Eyebrow>
        </div>

        <div className="reveal mx-auto mt-12 max-w-md rounded-2xl border border-champagne bg-white/70 p-8 text-center shadow-[10px_10px_0_#e8dccb]">
          <p className="font-display text-3xl tracking-[0.2em] text-ink">06 · 05</p>
          <p className="mt-1 font-display text-sm tracking-[0.4em] text-accent">SAT · 2027</p>
          <p className="mt-5 text-lg font-semibold tracking-[0.15em]">CHALET V · 台北</p>
          <p className="mt-1 text-sm text-ink/50">詳細地址與交通指引將隨喜帖公布</p>

          <ul className="mx-auto mt-8 max-w-[240px] text-left">
            {TIMELINE.map((t, i) => (
              <li key={t.time} className="timeline-item">
                <span className="timeline-dot" aria-hidden />
                {i < TIMELINE.length - 1 && <span className="timeline-line" aria-hidden />}
                <span className="font-display text-sm tracking-[0.15em] text-accent">{t.time}</span>
                <span className="ml-4 text-ink/80">{t.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[11px] text-ink/35">流程時間以正式喜帖為準</p>

          <a
            href={MAP_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-outline mt-8"
          >
            在 Google 地圖開啟 →
          </a>
        </div>
      </section>

      {/* ─── 相簿（佔位跑馬燈） ──────────────────────────────── */}
      <section className="py-24">
        <div className="reveal px-6">
          <Eyebrow script="gallery">相簿</Eyebrow>
          <p className="mt-4 text-center text-sm text-ink/50">
            婚紗照拍攝於 2026 年秋天，屆時在這裡與大家見面。
          </p>
        </div>
        <div className="reveal mt-12 overflow-hidden">
          <div className="invite-marquee">
            {[0, 1].map(copy => (
              <div key={copy} className="flex shrink-0 gap-5 pr-5" aria-hidden={copy === 1}>
                {['Z', '&', 'A', '06', '·', '05', '❦', '2027'].map((glyph, i) => (
                  <div
                    key={`${copy}-${i}`}
                    className={`invite-tile flex items-center justify-center ${
                      i % 3 === 0
                        ? 'bg-gradient-to-b from-champagne to-accent/50'
                        : i % 3 === 1
                          ? 'bg-gradient-to-b from-[#eedfd6] to-[#cfa08e]/60'
                          : 'bg-gradient-to-b from-[#e9e4da] to-champagne'
                    }`}
                  >
                    <span className="font-display text-3xl text-cream/90">{glyph}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 倒數 ─────────────────────────────────────────────── */}
      <section className="bg-white/50 px-6 py-24 text-center">
        <div className="reveal">
          <Eyebrow script="counting down">倒數計時</Eyebrow>
        </div>
        <div className="reveal mx-auto mt-12 flex max-w-md items-start justify-center gap-6 sm:gap-10">
          {(
            [
              ['DAYS', left?.d],
              ['HRS', left?.h],
              ['MIN', left?.m],
              ['SEC', left?.s],
            ] as const
          ).map(([unit, value]) => (
            <div key={unit} className="text-center">
              <p className="font-display text-4xl tabular-nums text-ink sm:text-5xl">
                {value === undefined || value === null ? '—' : String(value).padStart(2, '0')}
              </p>
              <p className="mt-2 font-display text-[10px] tracking-[0.3em] text-accent">{unit}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── RSVP / 加入官方帳號 ─────────────────────────────── */}
      <section className="bg-ink px-6 py-28 text-center text-cream">
        <p className="reveal font-script text-2xl text-champagne/90">save your seat</p>
        <h2 className="reveal mt-4 text-2xl tracking-[0.25em]">敬邀出席</h2>
        <p className="reveal mx-auto mt-8 max-w-md leading-relaxed text-cream/70">
          加入我們的官方帳號「皖美育見你」，線上回覆出席、
          上傳照片、參加抽獎，婚禮的一切都在裡面。
        </p>
        <p className="reveal mx-auto mt-4 max-w-md text-xs leading-relaxed text-cream/40">
          『皖美育見你』取自皖淩的「皖」與育辰的「育」，諧音「完美遇見你」。
        </p>
        <div className="reveal mt-10">
          <a href={ADD_FRIEND_URL} className="btn-invert">
            加入官方帳號 · 回覆出席
          </a>
        </div>
        <p className="reveal mt-8 text-sm text-cream/50">
          沒有使用 LINE？{' '}
          <a href={FALLBACK_RSVP_URL} className="underline underline-offset-4">
            改用網頁回覆出席
          </a>
        </p>
      </section>

      <footer className="px-6 py-12 text-center">
        <p className="font-display text-sm tracking-[0.3em] text-ink/60">Z &amp; A · 2027.06.05</p>
        <p className="mt-2 text-xs text-ink/35">皖美育見你 · CHALET V 台北</p>
      </footer>
    </main>
  )
}

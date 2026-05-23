// Public landing.
// Single job: convert visitors into LINE OA followers (see references/line-oa.md
// "guest onboarding funnel"). Everything else (RSVP, seating, lucky draw) lives
// behind the OA — that's deliberate, the value gating IS the funnel.
const ADD_FRIEND_URL =
  process.env.NEXT_PUBLIC_LINE_OA_ADD_FRIEND_URL ?? 'https://line.me/R/ti/p/@160vcltf'

const FALLBACK_RSVP_URL = '/rsvp-fallback'

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-20 text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-accent">
        2027 · 06 · 05
      </p>

      <h1 className="mt-6 text-5xl leading-tight">
        卓育辰 <span className="text-accent">＆</span> 楊皖淩
      </h1>
      <p className="mt-2 font-serif italic text-lg text-ink/70">
        Zachary &amp; Angelet · We&apos;re getting married
      </p>

      <p className="mt-10 text-ink/80 leading-relaxed">
        誠摯邀請您加入我們的官方帳號 <strong>皖美育見你</strong>，<br />
        線上回覆出席、查看您的座位、參加當天的抽獎與相簿活動。
      </p>

      <a href={ADD_FRIEND_URL} className="btn-primary mt-10">
        加入官方帳號
      </a>

      <p className="mt-12 text-sm text-ink/50">
        沒有使用 LINE？
        {' '}
        <a href={FALLBACK_RSVP_URL} className="underline underline-offset-4">
          改用網頁回覆出席
        </a>
      </p>

      <footer className="mt-24 text-xs text-ink/40">
        CHALET V · 台北
      </footer>
    </main>
  )
}

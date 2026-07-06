import type { Metadata } from 'next'
import { Aboreto, Petit_Formal_Script, Noto_Serif_TC } from 'next/font/google'
import './globals.css'

// Type trio (borrowed from the reference invitation the couple loves):
//   Aboreto            — latin display, wide uncial feel, dates & monograms
//   Petit Formal Script — script accents on section eyebrows
//   Noto Serif TC       — zh-Hant body serif, carries all Chinese text
const display = Aboreto({ weight: '400', subsets: ['latin'], variable: '--font-display' })
const script = Petit_Formal_Script({ weight: '400', subsets: ['latin'], variable: '--font-script' })
const serifTC = Noto_Serif_TC({ weight: ['400', '600', '900'], preload: false, variable: '--font-serif' })

export const metadata: Metadata = {
  title: '皖美育見你 · 卓育辰 ＆ 楊皖淩 婚禮',
  description:
    '2027 年 6 月 5 日｜CHALET V 台北。加入官方帳號，回覆出席、查看座位、參加抽獎。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className={`${display.variable} ${script.variable} ${serifTC.variable}`}>
      <body>{children}</body>
    </html>
  )
}

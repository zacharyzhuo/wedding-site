import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '皖美育見你 · 卓育辰 ＆ 楊皖淩 婚禮',
  description:
    '2027 年 6 月 5 日｜CHALET V 台北。加入官方帳號，回覆出席、查看座位、參加抽獎。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  )
}

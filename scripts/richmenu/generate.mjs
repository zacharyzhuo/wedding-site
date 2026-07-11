// Regenerate the LINE rich menu background image (2500x1686, 6 tiles).
//
//   node scripts/richmenu/generate.mjs   →  scripts/richmenu/richmenu.png
//
// Rendered from an inline SVG via sharp so the CJK glyphs use the system serif
// (Songti TC). Keep this in sync with richmenu.json (the tile hit-areas +
// actions). Deploy both with the Messaging API — see README.md.

import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = 2500, H = 1686
const colC = [W / 6, W / 2, (5 * W) / 6]
const rowC = [H / 4, (3 * H) / 4]

// Order matches richmenu.json areas: row-major, 3 columns × 2 rows.
const cells = [
  { cn: '喜帖', en: 'THE INVITATION', size: 120 },
  { cn: 'RSVP', en: '出席回覆', size: 96, latin: true },
  { cn: '我的座位', en: 'YOUR SEAT', size: 102 },
  { cn: '抽獎', en: 'LUCKY DRAW', size: 120 },
  { cn: '想對新人說', en: 'MESSAGE', size: 88 },
  { cn: '悄悄話', en: 'A SECRET NOTE', size: 104 },
]

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

let texts = ''
cells.forEach((c, i) => {
  const cx = colC[i % 3]
  const cy = rowC[Math.floor(i / 3)]
  const cnFont = c.latin ? "'Times New Roman',serif" : "'Songti TC','Heiti TC',serif"
  const cnLs = c.latin ? 10 : 4
  texts += `<text x="${cx}" y="${cy - 2}" font-family="${cnFont}" font-size="${c.size}" font-weight="500" fill="#33302c" text-anchor="middle" letter-spacing="${cnLs}">${esc(c.cn)}</text>`
  const subLatin = /^[A-Za-z ]+$/.test(c.en)
  const enFont = subLatin ? "'Helvetica Neue',Arial,sans-serif" : "'PingFang TC','Heiti TC',sans-serif"
  texts += `<text x="${cx}" y="${cy + 72}" font-family="${enFont}" font-size="30" font-weight="600" fill="#b98d6f" text-anchor="middle" letter-spacing="${subLatin ? 9 : 5}">${esc(c.en)}</text>`
})

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#faf7f1"/>
<g stroke="#e2d7c4" stroke-width="2.5">
<line x1="${W / 3}" y1="110" x2="${W / 3}" y2="${H - 110}"/>
<line x1="${(2 * W) / 3}" y1="110" x2="${(2 * W) / 3}" y2="${H - 110}"/>
<line x1="120" y1="${H / 2}" x2="${W - 120}" y2="${H / 2}"/>
</g>${texts}</svg>`

const out = join(__dirname, 'richmenu.png')
await sharp(Buffer.from(svg)).png().toFile(out)
console.log('wrote', out)

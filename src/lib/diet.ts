// Fixed vocabulary so the value lands in the Sheet/D1 as a stable label;
// avoids free-text variants like "全素"/"純素"/"vegan" that mean the same
// thing. Shared by the LIFF RSVP form, the non-LINE fallback form, and the
// member-diet self-service update.
export const DIET_OPTIONS = [
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
] as const

// The two options above end in a placeholder parenthetical telling the guest
// to explain themselves elsewhere. needsDietDetail flags exactly those two so
// the form can swap the placeholder for a real inline detail input instead.
const DETAIL_OPTIONS = new Set<string>([DIET_OPTIONS[3], DIET_OPTIONS[4]])

export function needsDietDetail(diet: string): boolean {
  return DETAIL_OPTIONS.has(diet)
}

const TRAILING_PAREN = /[（(][^（）()]*[）)]\s*$/
const PAREN_CHARS = /[（）()]/g

// Merges a diet option with the guest's free-text detail into the single
// string stored on the identity/party row, e.g. ('食物過敏（請於留言備註）',
// '花生') → '食物過敏（花生）'. Detail input may contain stray parens (users
// copy-paste or type their own) — those are stripped so the merged value
// always has exactly one paren pair. Empty/blank detail passes the original
// diet value through unchanged.
export function buildDietValue(diet: string, detail?: string): string {
  const trimmedDetail = detail?.trim() ?? ''
  if (!trimmedDetail) return diet
  const normalizedDetail = trimmedDetail.replace(PAREN_CHARS, '').trim()
  if (!normalizedDetail) return diet
  const base = diet.replace(TRAILING_PAREN, '').trim()
  return `${base}（${normalizedDetail}）`
}

// Reverses buildDietValue for prefilling an edit form: given a previously
// stored value, recovers which dropdown option it came from plus the detail
// text, so re-opening the form doesn't show a blank/mismatched <select>.
export function splitDietDetail(diet: string): { base: string; detail: string } {
  if ((DIET_OPTIONS as readonly string[]).includes(diet)) return { base: diet, detail: '' }
  const match = diet.match(/^(食物過敏|其他)（([^（）]*)）$/)
  if (!match) return { base: diet, detail: '' }
  const placeholder = DIET_OPTIONS.find(o => o.startsWith(match[1]))
  return { base: placeholder ?? diet, detail: match[2] }
}

// Fixed vocabulary so the value lands in the Sheet/D1 as a stable label;
// avoids free-text variants like "全素"/"純素"/"vegan" that mean the same
// thing. Shared by the LIFF RSVP form, the non-LINE fallback form, and (per
// party-identity spec) the future member-diet update form.
export const DIET_OPTIONS = [
  '無特殊需求',
  '全素',
  '蛋奶素',
  '食物過敏（請於留言備註）',
  '其他（請於留言備註）',
] as const

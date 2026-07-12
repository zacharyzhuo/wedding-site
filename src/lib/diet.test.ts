import { describe, it, expect } from 'vitest'
import { DIET_OPTIONS, buildDietValue, needsDietDetail, splitDietDetail } from './diet'

describe('needsDietDetail', () => {
  it('食物過敏／其他需要補充說明', () => {
    expect(needsDietDetail(DIET_OPTIONS[3])).toBe(true)
    expect(needsDietDetail(DIET_OPTIONS[4])).toBe(true)
  })
  it('其他選項不需要補充說明', () => {
    expect(needsDietDetail(DIET_OPTIONS[0])).toBe(false)
    expect(needsDietDetail(DIET_OPTIONS[1])).toBe(false)
    expect(needsDietDetail(DIET_OPTIONS[2])).toBe(false)
  })
})

describe('buildDietValue', () => {
  it('沒有 detail → 原樣傳回（no detail passthrough）', () => {
    expect(buildDietValue(DIET_OPTIONS[3])).toBe(DIET_OPTIONS[3])
    expect(buildDietValue(DIET_OPTIONS[3], '')).toBe(DIET_OPTIONS[3])
    expect(buildDietValue(DIET_OPTIONS[3], '   ')).toBe(DIET_OPTIONS[3])
  })
  it('detail 會被 trim', () => {
    expect(buildDietValue(DIET_OPTIONS[3], '  花生  ')).toBe('食物過敏（花生）')
  })
  it('detail 內的半形/全形括號會被正規化，輸出只有一組括號', () => {
    expect(buildDietValue(DIET_OPTIONS[4], '不吃(辣)的')).toBe('其他（不吃辣的）')
    expect(buildDietValue(DIET_OPTIONS[4], '（嚴重）花生')).toBe('其他（嚴重花生）')
    expect(buildDietValue(DIET_OPTIONS[3], '花生(過敏)（嚴重）')).toBe('食物過敏（花生過敏嚴重）')
  })
})

describe('splitDietDetail', () => {
  it('未合併過的原始選項 → detail 為空字串', () => {
    expect(splitDietDetail(DIET_OPTIONS[3])).toEqual({ base: DIET_OPTIONS[3], detail: '' })
    expect(splitDietDetail(DIET_OPTIONS[0])).toEqual({ base: DIET_OPTIONS[0], detail: '' })
  })
  it('可還原 buildDietValue 合併過的字串', () => {
    expect(splitDietDetail('食物過敏（花生）')).toEqual({ base: DIET_OPTIONS[3], detail: '花生' })
    expect(splitDietDetail('其他（不吃辣）')).toEqual({ base: DIET_OPTIONS[4], detail: '不吃辣' })
  })
})

import { describe, it, expect } from 'vitest'
import { mapUploadError } from './upload-errors'

describe('mapUploadError', () => {
  it('圖片處理相關代碼 → 格式不支援文案', () => {
    expect(mapUploadError(new Error('DECODE_FAILED'))).toBe('圖片格式不支援，請換一張照片（建議 JPG/PNG）')
    expect(mapUploadError(new Error('CANVAS_UNAVAILABLE'))).toBe('圖片格式不支援，請換一張照片（建議 JPG/PNG）')
    expect(mapUploadError(new Error('ENCODE_FAILED'))).toBe('圖片格式不支援，請換一張照片（建議 JPG/PNG）')
    expect(mapUploadError(new Error('TOO_LARGE'))).toBe('圖片格式不支援，請換一張照片（建議 JPG/PNG）')
  })

  it('網路 / presign / PUT 相關代碼與原生 TypeError → 網路不穩文案', () => {
    expect(mapUploadError(new Error('AUTH_TIMEOUT'))).toBe('網路不穩，上傳失敗了，請再試一次')
    expect(mapUploadError(new Error('PRESIGN_FAILED'))).toBe('網路不穩，上傳失敗了，請再試一次')
    expect(mapUploadError(new Error('PUT_FAILED'))).toBe('網路不穩，上傳失敗了，請再試一次')
    expect(mapUploadError(new Error('COMMIT_FAILED'))).toBe('網路不穩，上傳失敗了，請再試一次')
    expect(mapUploadError(new Error('SEND_FAILED'))).toBe('網路不穩，上傳失敗了，請再試一次')
    // fetch() itself throws a bare TypeError on real connectivity loss.
    expect(mapUploadError(new TypeError('Failed to fetch'))).toBe('網路不穩，上傳失敗了，請再試一次')
  })

  it('未知代碼 → fallback 文案', () => {
    expect(mapUploadError(new Error('SOMETHING_ELSE'))).toBe('出了點小狀況，請稍後再試')
    expect(mapUploadError(new Error())).toBe('出了點小狀況，請稍後再試')
  })

  it('非 Error 輸入 → fallback 文案', () => {
    expect(mapUploadError('boom')).toBe('出了點小狀況，請稍後再試')
    expect(mapUploadError(undefined)).toBe('出了點小狀況，請稍後再試')
    expect(mapUploadError(null)).toBe('出了點小狀況，請稍後再試')
  })
})

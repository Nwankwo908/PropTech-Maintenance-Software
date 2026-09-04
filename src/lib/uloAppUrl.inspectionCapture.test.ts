import { describe, expect, it } from 'vitest'
import { uloAppUrl } from '@/lib/uloAppUrl'

describe('uloAppUrl.inspectionCapture', () => {
  it('builds /inspection/capture/:sessionId?token=', () => {
    const url = uloAppUrl.inspectionCapture('abc-id', 'deadbeef', false)
    expect(url).toBe('/inspection/capture/abc-id?token=deadbeef')
  })
})

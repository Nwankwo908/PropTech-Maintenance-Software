import { describe, expect, it } from 'vitest'
import { inspectionCaptureDesktopStatusLabel } from '@/lib/inspectionCaptureStatus'

describe('inspectionCaptureDesktopStatusLabel', () => {
  it('starts waiting', () => {
    expect(inspectionCaptureDesktopStatusLabel('waiting', 0).headline).toBe('Waiting for phone')
  })

  it('shows connected before photos', () => {
    expect(inspectionCaptureDesktopStatusLabel('connected', 0).headline).toBe('Phone connected')
  })

  it('counts photos while receiving', () => {
    expect(inspectionCaptureDesktopStatusLabel('waiting', 2).detail).toBe('2 photos received')
    expect(inspectionCaptureDesktopStatusLabel('active', 1).detail).toBe('1 photo received')
  })
})

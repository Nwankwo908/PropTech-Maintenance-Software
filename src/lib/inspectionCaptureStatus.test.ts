import { describe, expect, it } from 'vitest'
import {
  inspectionCaptureDesktopStatusLabel,
  prefersDirectEquipmentCameraCapture,
} from '@/lib/inspectionCaptureStatus'

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

describe('prefersDirectEquipmentCameraCapture', () => {
  it('is true for phones so the QR handoff is skipped', () => {
    expect(prefersDirectEquipmentCameraCapture('iPhone', 5, false)).toBe(true)
    expect(prefersDirectEquipmentCameraCapture('Mozilla/5.0 (Linux; Android 14)', 2, false)).toBe(
      true,
    )
  })

  it('is false for typical desktop browsers', () => {
    expect(
      prefersDirectEquipmentCameraCapture(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0.0.0',
        0,
        false,
      ),
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  clampExtractDisplayPercent,
  inspectionExtractPercent,
} from '@/lib/inspectionExtractProgress'

describe('inspectionExtractPercent', () => {
  it('starts at 0 and never reaches 100 while in flight', () => {
    expect(inspectionExtractPercent(0)).toBe(0)
    expect(inspectionExtractPercent(4000)).toBeGreaterThan(0)
    expect(inspectionExtractPercent(60_000)).toBeLessThan(100)
    expect(inspectionExtractPercent(60_000)).toBe(97)
  })

  it('snaps to 100 only when complete', () => {
    expect(clampExtractDisplayPercent(97, false)).toBe(97)
    expect(clampExtractDisplayPercent(97, true)).toBe(100)
  })
})

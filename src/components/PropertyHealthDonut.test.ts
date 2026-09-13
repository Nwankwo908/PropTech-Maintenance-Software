import { describe, expect, it } from 'vitest'
import { propertyHealthDonutPercent } from './PropertyHealthDonut'

describe('propertyHealthDonutPercent', () => {
  it('maps a 0–100 score onto the ring', () => {
    expect(propertyHealthDonutPercent(82, true)).toBe(82)
  })

  it('stays empty when the score is not ready', () => {
    expect(propertyHealthDonutPercent(82, false)).toBe(0)
    expect(propertyHealthDonutPercent(null, true)).toBe(0)
  })

  it('clamps out of range scores', () => {
    expect(propertyHealthDonutPercent(140, true)).toBe(100)
    expect(propertyHealthDonutPercent(-4, true)).toBe(0)
  })
})

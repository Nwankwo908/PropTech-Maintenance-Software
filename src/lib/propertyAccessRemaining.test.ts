import { describe, expect, it } from 'vitest'
import { propertyAccessRemainingNotice } from './propertyAccess'

describe('propertyAccessRemainingNotice', () => {
  it('says property access is complete when nothing is left', () => {
    expect(propertyAccessRemainingNotice(0)).toBe('Property access is complete for every property.')
  })

  it('uses the singular when one property still needs access', () => {
    expect(propertyAccessRemainingNotice(1)).toBe('1 property still needs access details.')
  })

  it('counts the properties that still need access', () => {
    expect(propertyAccessRemainingNotice(4)).toBe('4 properties still need access details.')
  })
})

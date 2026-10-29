import { describe, expect, it } from 'vitest'
import { isSingleFamilyPropertyType, resolveCanonicalPropertyType } from './propertyType'

describe('resolveCanonicalPropertyType', () => {
  it('reads Add Property student housing as multifamily, not single family', () => {
    expect(resolveCanonicalPropertyType('student_housing')).toBe('multifamily')
    expect(isSingleFamilyPropertyType('student_housing')).toBe(false)
  })

  it('keeps Add Property single family as single family', () => {
    expect(isSingleFamilyPropertyType('single_family')).toBe(true)
  })
})

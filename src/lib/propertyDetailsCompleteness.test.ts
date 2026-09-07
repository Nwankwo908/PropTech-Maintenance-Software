import { describe, expect, it } from 'vitest'
import {
  areAllPropertiesDetailsComplete,
  isAnyPropertyDetailsComplete,
  propertyDetailsSectionsComplete,
} from './propertyDetailsCompleteness'

describe('propertyDetailsSectionsComplete', () => {
  it('requires inspection, access, insurance, and history', () => {
    expect(
      propertyDetailsSectionsComplete({
        inspection: true,
        access: true,
        insurance: true,
        history: true,
      }),
    ).toBe(true)
    expect(
      propertyDetailsSectionsComplete({
        inspection: true,
        access: true,
        insurance: true,
        history: false,
      }),
    ).toBe(false)
    expect(
      propertyDetailsSectionsComplete({
        inspection: false,
        access: true,
        insurance: true,
        history: true,
      }),
    ).toBe(false)
  })
})

describe('portfolio property details completeness', () => {
  it('does not count an empty portfolio as complete', async () => {
    expect(await isAnyPropertyDetailsComplete([])).toBe(false)
    expect(await areAllPropertiesDetailsComplete([])).toBe(false)
  })
})

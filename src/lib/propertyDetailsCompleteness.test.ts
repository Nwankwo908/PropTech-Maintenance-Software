import { describe, expect, it } from 'vitest'
import { propertyDetailsSectionsComplete } from './propertyDetailsCompleteness'

describe('propertyDetailsSectionsComplete', () => {
  it('requires inspection, access, assets, insurance, and history', () => {
    expect(
      propertyDetailsSectionsComplete({
        inspection: true,
        access: true,
        assets: true,
        insurance: true,
        history: true,
      }),
    ).toBe(true)
    expect(
      propertyDetailsSectionsComplete({
        inspection: true,
        access: true,
        assets: true,
        insurance: true,
        history: false,
      }),
    ).toBe(false)
    expect(
      propertyDetailsSectionsComplete({
        inspection: false,
        access: true,
        assets: true,
        insurance: true,
        history: true,
      }),
    ).toBe(false)
  })
})

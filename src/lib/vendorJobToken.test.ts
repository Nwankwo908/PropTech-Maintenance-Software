import { describe, expect, it } from 'vitest'
import { normalizeVendorJobToken } from './vendorJobToken'

const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('normalizeVendorJobToken', () => {
  it('accepts a bare UUID', () => {
    expect(normalizeVendorJobToken(TOKEN)).toBe(TOKEN)
  })

  it('decodes a wrapped /w/ URL', () => {
    expect(
      normalizeVendorJobToken(`https://app.ulohome.io/w/${TOKEN}`),
    ).toBe(TOKEN)
  })

  it('decodes a wrapped /estimate/ URL', () => {
    expect(
      normalizeVendorJobToken(`https://app.ulohome.io/estimate/${TOKEN}`),
    ).toBe(TOKEN)
  })

  it('rejects a non-UUID', () => {
    expect(normalizeVendorJobToken('WO-DBF7')).toBe('')
  })
})

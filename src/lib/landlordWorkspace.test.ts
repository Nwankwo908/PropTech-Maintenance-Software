import { describe, expect, it } from 'vitest'
import {
  formatLandlordCurrency,
  formatLandlordDate,
  resolveLandlordDisplayName,
} from '@/lib/landlordWorkspace'

describe('landlordWorkspace', () => {
  it('prefers display name over legal name', () => {
    expect(
      resolveLandlordDisplayName({
        displayName: 'Kendo Homes',
        legalName: 'Kendo Properties LLC',
      }),
    ).toBe('Kendo Homes')
  })

  it('formats currency from workspace settings', () => {
    expect(formatLandlordCurrency(1250.5, { currency: 'CAD' })).toMatch(/CA\$|CAD/)
  })

  it('formats dates using workspace date format', () => {
    const value = '2026-08-22T15:00:00.000Z'
    expect(
      formatLandlordDate(value, {
        dateFormat: 'YYYY-MM-DD',
        timeZone: 'America/New_York',
      }),
    ).toBe('2026-08-22')
    expect(
      formatLandlordDate(value, {
        dateFormat: 'DD/MM/YYYY',
        timeZone: 'America/New_York',
      }),
    ).toBe('22/08/2026')
  })
})

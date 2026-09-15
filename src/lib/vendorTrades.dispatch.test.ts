import { describe, expect, it } from 'vitest'
import { vendorTradeMatchesForDispatch } from '@/lib/vendorTrades'

describe('vendorTradeMatchesForDispatch', () => {
  it('matches the same trade', () => {
    expect(vendorTradeMatchesForDispatch('plumbing', 'plumbing')).toBe(true)
    expect(vendorTradeMatchesForDispatch('appliance', 'appliance_repair')).toBe(
      true,
    )
  })

  it('does not assign a different trade', () => {
    expect(
      vendorTradeMatchesForDispatch('plumbing', 'appliance_repair'),
    ).toBe(false)
    expect(vendorTradeMatchesForDispatch('plumbing', 'hvac')).toBe(false)
  })

  it('does not last-resort a different specialist when the ticket trade is unknown', () => {
    expect(vendorTradeMatchesForDispatch('plumbing', null)).toBe(false)
    expect(vendorTradeMatchesForDispatch('plumbing', 'general')).toBe(false)
    expect(vendorTradeMatchesForDispatch('plumbing', '')).toBe(false)
  })

  it('lets general / handyman take any trade', () => {
    expect(vendorTradeMatchesForDispatch('general', 'plumbing')).toBe(true)
    expect(vendorTradeMatchesForDispatch('handyman', 'appliance_repair')).toBe(
      true,
    )
    expect(vendorTradeMatchesForDispatch(null, 'hvac')).toBe(true)
    expect(vendorTradeMatchesForDispatch('', 'pest_control')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { resolveAmbiguousMaintenance } from '@shared/maintenance/ambiguityResolution.ts'
import { inferTradeFromText } from '@shared/maintenance/deterministicRules.ts'
import { matchingTradeForVendorSearch } from '@shared/maintenance/vendorTrades.ts'
import { inferTradeFromDescription } from './maintenanceClassificationParity'

describe('resolveAmbiguousMaintenance', () => {
  it('does not force ceiling water to wait on clarification', () => {
    const r = resolveAmbiguousMaintenance('Water is leaking from my ceiling.')
    expect(r.handled).toBe(true)
    expect(r.needsClarification).toBe(false)
    expect(r.primaryTrade).toBe('plumbing')
    expect(inferTradeFromText('Water is leaking from my ceiling.')).toBe('plumbing')
  })

  it('maps rain ceiling leaks to roofing', () => {
    const r = resolveAmbiguousMaintenance(
      "There's water coming through the ceiling whenever it rains.",
    )
    expect(r.primaryTrade).toBe('roofing')
    expect(r.primaryCategory).toBe('structural')
    expect(r.needsClarification).toBe(false)
  })

  it('maps a named roof leak to roofing', () => {
    expect(resolveAmbiguousMaintenance('My roof is leaking.').primaryTrade).toBe('roofing')
  })

  it('uses best-judgment plumbing for water by the furnace', () => {
    const r = resolveAmbiguousMaintenance("There's water by the furnace.")
    expect(r.needsClarification).toBe(false)
    expect(r.primaryTrade).toBe('plumbing')
  })

  it('uses best-judgment HVAC when the heating system is unnamed', () => {
    const r = resolveAmbiguousMaintenance("My heat isn't working.")
    expect(r.needsClarification).toBe(false)
    expect(r.primaryCategory).toBe('hvac')
    expect(r.primaryTrade).toBe('hvac')
    expect(inferTradeFromText("My heat isn't working.")).toBe('hvac')
  })

  it('sends cold radiators to plumbing under HVAC', () => {
    const r = resolveAmbiguousMaintenance('The radiator is cold.')
    expect(r.primaryTrade).toBe('plumbing')
    expect(r.primaryCategory).toBe('hvac')
  })

  it('resolves structural cracks to masonry, sagging ceiling to carpentry', () => {
    expect(resolveAmbiguousMaintenance("There's a crack going up my wall.").primaryTrade).toBe(
      'masonry',
    )
    const sag = resolveAmbiguousMaintenance('My ceiling is sagging.')
    expect(sag.primaryTrade).toBe('carpentry')
    expect(sag.primaryCategory).toBe('structural')
  })

  it('keeps pest primary and records follow-up trades', () => {
    const mice = resolveAmbiguousMaintenance('I hear mice inside the wall.')
    expect(mice.primaryTrade).toBe('pest_control')
    expect(mice.secondaryTrade).toBe('carpentry')
    const bugs = resolveAmbiguousMaintenance('There are bugs underneath my dishwasher.')
    expect(bugs.primaryTrade).toBe('pest_control')
    expect(bugs.secondaryTrade).toBe('plumbing')
  })

  it('leaves obvious plumbing and HVAC cooling to existing rules', () => {
    expect(resolveAmbiguousMaintenance('Leaky faucet').handled).toBe(true)
    expect(resolveAmbiguousMaintenance('Leaky faucet').primaryTrade).toBe('plumbing')
    expect(resolveAmbiguousMaintenance('AC blowing warm air').handled).toBe(false)
    expect(inferTradeFromDescription('Leaky faucet')).toBe('plumbing')
    expect(inferTradeFromDescription('Outlet sparks')).toBe('electrical')
    expect(inferTradeFromDescription('AC blowing warm air')).toBe('hvac')
  })

  it('never searches Thumbtack for Structural', () => {
    expect(matchingTradeForVendorSearch('structural')).toBe('general')
    expect(matchingTradeForVendorSearch('roofing')).toBe('roofing')
  })

  it('maps a hole in the wall to carpentry, not plumbing', () => {
    const r = resolveAmbiguousMaintenance('There is a hole in the wall.')
    expect(r.primaryCategory).toBe('structural')
    expect(r.primaryTrade).toBe('carpentry')
    expect(inferTradeFromText('There is a hole in the wall.')).toBe('carpentry')
    expect(inferTradeFromText('There is a hole in my bedroom wall.')).toBe('carpentry')
  })

  it('does not treat a bare ceiling word as structural when water is present', () => {
    expect(resolveAmbiguousMaintenance('Water is leaking from my ceiling.').primaryCategory).toBe(
      'plumbing',
    )
  })
})

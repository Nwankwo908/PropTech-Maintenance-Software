import { describe, expect, it, vi } from 'vitest'
import { computeVendorProfileVerificationChecklist } from './vendorVerificationChecklist'
import {
  buildVendorReadinessGroups,
  buildVendorReadinessView,
} from './vendorReadiness'

describe('buildVendorReadinessGroups', () => {
  it('places items in Licensing, Payment, and Work profile groups', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      license_number: 'PL-100',
      license_expiration: '2099-01-01',
      coi_general_liability: 500_000,
      coi_expiration: '2099-06-01',
      w9_received: true,
      tax_entity_type: 'llc',
      tin_type: 'ein',
      tin_last4: '1234',
      tin_fingerprint: 'fp',
      stripe_connect_ready: true,
      service_area: { cities: ['Austin'], counties: ['TX'] },
      availability: 'active',
    })

    const groups = buildVendorReadinessGroups(checklist, {
      tradeLabels: ['Plumbing'],
      serviceAreaSummary: 'Austin, TX',
    })

    expect(groups.map((g) => g.id)).toEqual(['licensing', 'payment', 'work_profile'])
    expect(groups.find((g) => g.id === 'licensing')?.items.map((i) => i.id)).toEqual([
      'license',
      'coi_coverage',
    ])
    expect(groups.find((g) => g.id === 'payment')?.items.map((i) => i.id)).toEqual([
      'w9',
      'stripe_connect',
    ])
    expect(groups.find((g) => g.id === 'work_profile')?.items.map((i) => i.id)).toEqual([
      'trade_categories',
      'service_area',
      'availability',
    ])
  })

  it('computes per-group counts from that group only', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      license_number: 'PL-100',
      license_expiration: '2099-01-01',
      // insurance missing
      // w9 / payout missing
      service_area: { cities: ['Austin'] },
      availability: 'active',
    })

    const groups = buildVendorReadinessGroups(checklist, { tradeLabels: ['Plumbing'] })
    const licensing = groups.find((g) => g.id === 'licensing')
    const payment = groups.find((g) => g.id === 'payment')
    const work = groups.find((g) => g.id === 'work_profile')

    expect(`${licensing?.completeCount} of ${licensing?.totalCount}`).toBe('1 of 2')
    expect(`${payment?.completeCount} of ${payment?.totalCount}`).toBe('0 of 2')
    expect(`${work?.completeCount} of ${work?.totalCount}`).toBe('3 of 3')
  })

  it('sorts a group with an expired item first', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      coi_general_liability: 500_000,
      coi_expiration: '2020-01-01',
      service_area: { cities: ['Austin'] },
      availability: 'active',
    })

    const groups = buildVendorReadinessGroups(checklist)
    expect(groups[0]?.id).toBe('licensing')
    expect(groups[0]?.needsAction).toBe(true)
    expect(groups.map((g) => g.id)).toEqual(['licensing', 'payment', 'work_profile'])
  })

  it('never shows Optional on expired insurance', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      coi_general_liability: 250_000,
      coi_expiration: '2020-06-01',
    })
    const insurance = buildVendorReadinessGroups(checklist)
      .flatMap((g) => g.items)
      .find((item) => item.id === 'coi_coverage')

    expect(insurance?.statusLabel).toBe('Expired')
    expect(insurance?.showOptional).toBe(false)
  })

  it('uses unlock helper copy for missing W-9 and payout', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
    })
    const items = buildVendorReadinessGroups(checklist).flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'w9')?.detail).toBe('Needed before year-end tax forms')
    expect(items.find((i) => i.id === 'stripe_connect')?.detail).toBe(
      'Needed to pay this vendor through Ulo',
    )
    expect(items.find((i) => i.id === 'w9')?.showOptional).toBe(false)
    expect(items.find((i) => i.id === 'stripe_connect')?.showOptional).toBe(false)
  })

  it('keeps request item ids for existing request actions', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      coi_general_liability: 500_000,
      coi_expiration: '2020-01-01',
    })
    const insurance = buildVendorReadinessGroups(checklist)
      .flatMap((g) => g.items)
      .find((item) => item.id === 'coi_coverage')
    const w9 = buildVendorReadinessGroups(checklist)
      .flatMap((g) => g.items)
      .find((item) => item.id === 'w9')

    expect(insurance?.requestItemId).toBe('coi_coverage')
    expect(w9?.requestItemId).toBe('w9')
  })

  it('omits empty recommended helper noise on missing license/insurance', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
    })
    const items = buildVendorReadinessGroups(checklist).flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'license')?.detail).toBeNull()
    expect(items.find((i) => i.id === 'coi_coverage')?.detail).toBeNull()
    expect(items.find((i) => i.id === 'license')?.showOptional).toBe(true)
  })
})

describe('buildVendorReadinessView', () => {
  it('totals complete items across all shown groups', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'))
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      license_number: 'PL-100',
      license_expiration: '2099-01-01',
      service_area: { cities: ['Austin'] },
      availability: 'active',
    })
    const view = buildVendorReadinessView(checklist)
    // license + trade + service + availability = 4 complete; coi + w9 + payout missing = 3
    expect(view.completeCount).toBe(4)
    expect(view.totalCount).toBe(7)
    expect(view.pct).toBe(57)
    vi.useRealTimers()
  })
})

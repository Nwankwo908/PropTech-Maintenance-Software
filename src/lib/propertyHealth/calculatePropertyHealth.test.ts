import { describe, expect, it } from 'vitest'
import {
  CORE_VENDOR_TRADES,
  calculatePropertyHealth,
  coreTradesForVendorCategory,
  documentationPoints,
  formatPropertyHealthGap,
  occupancyPoints,
  openItemsPoints,
  propertyHealthRatingFromScore,
  vendorCoveragePoints,
  type CalculatePropertyHealthInput,
} from '@/lib/propertyHealth/calculatePropertyHealth'

const allDocs = { leaseOnFile: true, assetListComplete: true, lastJobPhotoReceipt: true }

function input(partial: Partial<CalculatePropertyHealthInput> = {}): CalculatePropertyHealthInput {
  return {
    openItemCount: 0,
    totalUnits: 4,
    occupiedUnits: 4,
    coveredTrades: CORE_VENDOR_TRADES,
    documentation: allDocs,
    ...partial,
  }
}

describe('Vitals rubric points', () => {
  it('scores open action items by backlog size', () => {
    expect([0, 1, 2, 3, 4, 9].map(openItemsPoints)).toEqual([25, 18, 10, 10, 0, 0])
  })

  it('scores occupancy by occupied share of onboarded units', () => {
    expect(occupancyPoints(4, 4)).toBe(25)
    expect(occupancyPoints(9, 10)).toBe(18)
    expect(occupancyPoints(19, 20)).toBe(18)
    expect(occupancyPoints(3, 4)).toBe(10)
    expect(occupancyPoints(89, 100)).toBe(10)
    expect(occupancyPoints(2, 4)).toBe(0)
    expect(occupancyPoints(0, 0)).toBe(0)
  })

  it('scores vendor coverage across the 8 core trades', () => {
    expect([8, 7, 6, 5, 4, 3, 0].map(vendorCoveragePoints)).toEqual([25, 18, 18, 10, 10, 0, 0])
  })

  it('scores documentation by completed items', () => {
    expect([3, 2, 1, 0].map(documentationPoints)).toEqual([25, 16, 8, 0])
  })

  it('maps score bands', () => {
    expect(propertyHealthRatingFromScore(100)).toBe('Healthy')
    expect(propertyHealthRatingFromScore(80)).toBe('Healthy')
    expect(propertyHealthRatingFromScore(79)).toBe('Fair')
    expect(propertyHealthRatingFromScore(65)).toBe('Fair')
    expect(propertyHealthRatingFromScore(64)).toBe('At Risk')
    expect(propertyHealthRatingFromScore(50)).toBe('At Risk')
    expect(propertyHealthRatingFromScore(49)).toBe('Critical')
  })
})

describe('calculatePropertyHealth', () => {
  it('matches the calculator example: everything complete scores 100 Healthy', () => {
    const result = calculatePropertyHealth(input())
    expect(result.score).toBe(100)
    expect(result.rating).toBe('Healthy')
    expect(result.gaps).toEqual([])
  })

  it('adds the four dimensions', () => {
    const result = calculatePropertyHealth(
      input({
        openItemCount: 2,
        totalUnits: 10,
        occupiedUnits: 9,
        coveredTrades: ['plumbing', 'hvac', 'electrical', 'general', 'appliance_repair', 'locksmith'],
        documentation: { leaseOnFile: true, assetListComplete: false, lastJobPhotoReceipt: true },
      }),
    )
    expect(result.dimensions.open_items.points).toBe(10)
    expect(result.dimensions.occupancy.points).toBe(18)
    expect(result.dimensions.vendor_coverage.points).toBe(18)
    expect(result.dimensions.documentation.points).toBe(16)
    expect(result.score).toBe(62)
    expect(result.rating).toBe('At Risk')
    expect(result.dimensions.vendor_coverage.detail).toBe(
      '6 of 8 trades covered · missing Pest Control and Roofing',
    )
    expect(result.dimensions.occupancy.detail).toBe('9 of 10 units occupied (90%)')
  })

  it('surfaces gaps with the real points they add', () => {
    const result = calculatePropertyHealth(
      input({
        openItemCount: 1,
        coveredTrades: ['plumbing', 'hvac', 'electrical', 'general', 'appliance_repair', 'locksmith', 'roofing'],
        documentation: { leaseOnFile: false, assetListComplete: true, lastJobPhotoReceipt: true },
      }),
    )
    expect(result.gaps.map(formatPropertyHealthGap)).toEqual([
      'Upload the lease → +9 pts',
      'Close 1 open action item → +7 pts',
      'Add Pest Control vendor → +7 pts',
    ])
  })

  it('asks for the smallest step that reaches the next band', () => {
    const result = calculatePropertyHealth(
      input({
        openItemCount: 5,
        totalUnits: 20,
        occupiedUnits: 14,
        coveredTrades: ['plumbing', 'hvac', 'electrical'],
      }),
    )
    const actions = result.gaps.map(formatPropertyHealthGap)
    expect(actions).toContain('Close 2 open action items → +10 pts')
    expect(actions).toContain('Lease 1 vacant unit → +10 pts')
    expect(actions).toContain('Add Appliance vendor → +10 pts')
  })

  it('names every trade needed when one vendor is not enough to reach the next band', () => {
    const result = calculatePropertyHealth(
      input({ coveredTrades: ['plumbing', 'hvac', 'electrical', 'general'] }),
    )
    expect(result.gaps.map(formatPropertyHealthGap)).toEqual([
      'Add vendors for Appliance and Locksmith → +8 pts',
    ])
  })

  it('gives zero occupancy points and no lease gap math errors for an empty property', () => {
    const result = calculatePropertyHealth(
      input({ totalUnits: 0, occupiedUnits: 0, documentation: { leaseOnFile: false, assetListComplete: false, lastJobPhotoReceipt: false } }),
    )
    expect(result.dimensions.occupancy.points).toBe(0)
    expect(result.dimensions.documentation.points).toBe(0)
    expect(result.gaps.filter((gap) => gap.dimension === 'occupancy')).toEqual([])
  })
})

describe('coreTradesForVendorCategory', () => {
  it('maps common categories onto core trades', () => {
    expect(coreTradesForVendorCategory('Plumbing')).toEqual(['plumbing'])
    expect(coreTradesForVendorCategory('HVAC')).toEqual(['hvac'])
    expect(coreTradesForVendorCategory('Handyman')).toEqual(['general'])
    expect(coreTradesForVendorCategory('Pest Management')).toEqual(['pest_control'])
  })

  it('reads several trades from one category', () => {
    expect(coreTradesForVendorCategory('Plumbing, HVAC & Electrical')).toEqual([
      'plumbing',
      'hvac',
      'electrical',
    ])
  })

  it('ignores non-core and empty categories', () => {
    expect(coreTradesForVendorCategory('Painting')).toEqual([])
    expect(coreTradesForVendorCategory('')).toEqual([])
    expect(coreTradesForVendorCategory(null)).toEqual([])
  })
})

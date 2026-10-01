import { describe, expect, it } from 'vitest'
import {
  HQS_FIXTURE_DOC1_TEXT,
  HQS_FIXTURE_DOC2_TEXT,
} from './hqsInspectionLetter.fixtures.ts'
import { extractHqsInspectionLetter } from './hqsInspectionLetter.ts'
import {
  canCreateHqsInspectionRecords,
  lookupHqsUnitMapping,
  planHqsWorkOrdersFromExtraction,
  shouldSendHqsAbatementAlert,
  type HqsUnitMapping,
} from './hqsInspectionIntakePlan.ts'
import { mapHqsFailCategoryToVendorTrade } from './hqsFailCategoryTrade.ts'

describe('unit mapping gate', () => {
  const maps: HqsUnitMapping[] = [
    {
      landlordId: 'll-1',
      ownerIdExternal: 'OWN-44821',
      tenantIdExternal: 'TEN-90210',
      unitId: 'unit-bartlett-1',
      propertyId: 'prop-1',
    },
  ]

  it('creates nothing when mapping is missing', () => {
    const extraction = extractHqsInspectionLetter(HQS_FIXTURE_DOC1_TEXT)
    const hit = lookupHqsUnitMapping(maps, {
      landlordId: 'll-1',
      ownerIdExternal: extraction.ownerIdExternal,
      tenantIdExternal: 'UNKNOWN',
    })
    expect(hit).toBeNull()
    expect(canCreateHqsInspectionRecords({ unitId: null, landlordConfirmed: true })).toBe(false)
    expect(planHqsWorkOrdersFromExtraction(extraction).length).toBeGreaterThan(0)
    // Planned rows exist in memory, but gate blocks persistence:
    expect(canCreateHqsInspectionRecords({ unitId: hit?.unitId, landlordConfirmed: true })).toBe(
      false,
    )
  })

  it('persisted mapping auto-resolves a second letter with the same tenant id', () => {
    const doc2 = extractHqsInspectionLetter(HQS_FIXTURE_DOC2_TEXT)
    const hit = lookupHqsUnitMapping(maps, {
      landlordId: 'll-1',
      ownerIdExternal: doc2.ownerIdExternal,
      tenantIdExternal: doc2.tenantIdExternal,
    })
    expect(hit?.unitId).toBe('unit-bartlett-1')
    expect(canCreateHqsInspectionRecords({ unitId: hit!.unitId, landlordConfirmed: true })).toBe(
      true,
    )
  })
})

describe('landlord confirm gate', () => {
  it('does not create inspection_reports or work orders without YES', () => {
    expect(
      canCreateHqsInspectionRecords({ unitId: 'unit-1', landlordConfirmed: false }),
    ).toBe(false)
    expect(
      canCreateHqsInspectionRecords({ unitId: 'unit-1', landlordConfirmed: true }),
    ).toBe(true)
  })
})

describe('Doc1 planning — abatement alert + urgency', () => {
  const extraction = extractHqsInspectionLetter(HQS_FIXTURE_DOC1_TEXT)
  const planned = planHqsWorkOrdersFromExtraction(extraction)

  it('plans 12 owner work orders; gas range is urgent', () => {
    expect(planned).toHaveLength(12)
    const gas = planned.find((p) => /Gas Range/i.test(p.failItemCategory))
    expect(gas?.urgency).toBe('urgent')
    expect(gas?.issueCategory).toBe('appliance_repair')
    expect(shouldSendHqsAbatementAlert(extraction)).toBe(true)
  })
})

describe('Doc2 planning — reinspection due date', () => {
  it('sets standard due dates to 2026-09-28', () => {
    const extraction = extractHqsInspectionLetter(HQS_FIXTURE_DOC2_TEXT)
    const planned = planHqsWorkOrdersFromExtraction(extraction)
    expect(planned).toHaveLength(13)
    expect(planned.every((p) => p.dueAtIsoDate === '2026-09-28')).toBe(true)
    expect(shouldSendHqsAbatementAlert(extraction)).toBe(false)
  })
})

describe('hqs fail category trade map', () => {
  it('maps Gas Range/Oven to appliance_repair', () => {
    expect(mapHqsFailCategoryToVendorTrade('Gas Range/Oven')).toBe('appliance_repair')
  })
})

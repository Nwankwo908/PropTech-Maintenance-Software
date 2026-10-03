import { describe, expect, it } from 'vitest'
import { workflowMatchesPropertyScope, type AdminWorkflowRow } from '@/lib/adminWorkflows'
import {
  findResidentsForUnit,
  ticketMatchesUnit,
  workflowMatchesUnit,
  type PropertyUnitResident,
  type PropertyUnitTicket,
} from '@/lib/propertyUnitRows'

/**
 * Shared fixture set for unit-row matchers vs workflowMatchesPropertyScope.
 * Drift between these paths is what put Shahita's WO on Rashae's unit row.
 */
const BAY = {
  building: '3804 W Bay Avenue',
  propertyId: 'prop-bay',
  unitId: 'unit-bay-1',
  unitLabel: '1',
}
const MAPLE = {
  building: '14 Maple Ave',
  propertyId: 'prop-maple',
  unitId: 'unit-maple-1',
  unitLabel: '1',
}

function ticket(
  partial: Partial<PropertyUnitTicket> & Pick<PropertyUnitTicket, 'id' | 'unit'>,
): PropertyUnitTicket {
  return {
    building: null,
    propertyId: null,
    unitId: null,
    issueCategory: 'plumbing',
    urgency: 'normal',
    vendorWorkStatus: 'unassigned',
    ...partial,
  }
}

function workflow(
  partial: Partial<AdminWorkflowRow> & Pick<AdminWorkflowRow, 'id'>,
): AdminWorkflowRow {
  return {
    templateId: 'maintenance_request',
    templateName: 'Maintenance',
    templateType: 'maintenance',
    status: 'active',
    currentStep: null,
    entityType: 'maintenance_request',
    entityId: partial.id,
    propertyId: null,
    unitId: null,
    residentId: null,
    residentName: null,
    unitLabel: null,
    propertyLabel: null,
    startedAt: '2026-10-01T12:00:00.000Z',
    completedAt: null,
    lastEventType: null,
    lastEventMessage: null,
    lastEventAt: null,
    escalationReason: null,
    issueCategory: 'plumbing',
    vendorWorkStatus: 'unassigned',
    assignedVendorId: null,
    ...partial,
  }
}

function resident(
  partial: Partial<PropertyUnitResident> & Pick<PropertyUnitResident, 'id' | 'fullName' | 'unit'>,
): PropertyUnitResident {
  return {
    building: null,
    status: 'active',
    balanceDue: 0,
    leaseEndDate: null,
    ...partial,
  }
}

const bayScope = {
  building: BAY.building,
  propertyId: BAY.propertyId,
  unitIds: new Set([BAY.unitId]),
}

describe('unit-row matchers agree with workflowMatchesPropertyScope', () => {
  it('FK hits agree across ticket, workflow unit, and property scope', () => {
    const bayTicket = ticket({
      id: 't-bay',
      unit: '1',
      unitId: BAY.unitId,
      propertyId: BAY.propertyId,
      building: BAY.building,
    })
    const bayRun = workflow({
      id: 'r-bay',
      unitId: BAY.unitId,
      propertyId: BAY.propertyId,
      unitLabel: '1',
      propertyLabel: BAY.building,
    })

    expect(ticketMatchesUnit(bayTicket, BAY.unitLabel, BAY.building, BAY.unitId, BAY.propertyId)).toBe(
      true,
    )
    expect(workflowMatchesUnit(bayRun, BAY.unitLabel, BAY.building, BAY.unitId, BAY.propertyId)).toBe(
      true,
    )
    expect(workflowMatchesPropertyScope(bayRun, bayScope)).toBe(true)
  })

  it('cross-property label collisions never steal attribution', () => {
    const mapleTicket = ticket({
      id: 't-maple',
      unit: '1',
      unitId: MAPLE.unitId,
      propertyId: MAPLE.propertyId,
      building: MAPLE.building,
    })
    const mapleRun = workflow({
      id: 'r-maple',
      unitId: MAPLE.unitId,
      propertyId: MAPLE.propertyId,
      unitLabel: '1',
      propertyLabel: MAPLE.building,
    })
    const mapleResident = resident({
      id: 'res-maple',
      fullName: 'Maple Tenant',
      unit: '1',
      building: MAPLE.building,
    })

    expect(
      ticketMatchesUnit(mapleTicket, BAY.unitLabel, BAY.building, BAY.unitId, BAY.propertyId),
    ).toBe(false)
    expect(
      workflowMatchesUnit(mapleRun, BAY.unitLabel, BAY.building, BAY.unitId, BAY.propertyId),
    ).toBe(false)
    expect(workflowMatchesPropertyScope(mapleRun, bayScope)).toBe(false)
    expect(findResidentsForUnit(BAY.unitLabel, BAY.building, [mapleResident])).toEqual([])
  })

  it('ambiguous bare labels fail closed when inventory has unit ids', () => {
    const orphanTicket = ticket({ id: 't-orphan', unit: '1' })
    const orphanRun = workflow({ id: 'r-orphan', unitLabel: '1' })
    const orphanResident = resident({
      id: 'res-orphan',
      fullName: 'No Building',
      unit: '1',
      building: null,
    })

    expect(
      ticketMatchesUnit(orphanTicket, BAY.unitLabel, BAY.building, BAY.unitId, BAY.propertyId),
    ).toBe(false)
    expect(
      workflowMatchesUnit(orphanRun, BAY.unitLabel, BAY.building, BAY.unitId, BAY.propertyId),
    ).toBe(false)
    expect(workflowMatchesPropertyScope(orphanRun, bayScope)).toBe(false)
    expect(findResidentsForUnit(BAY.unitLabel, BAY.building, [orphanResident])).toEqual([])
  })

  it('missing FKs still require building agreement for label matches', () => {
    const bayTicket = ticket({
      id: 't-bay-label',
      unit: '1',
      building: BAY.building,
    })
    const mapleTicket = ticket({
      id: 't-maple-label',
      unit: '1',
      building: MAPLE.building,
    })
    const bayRun = workflow({
      id: 'r-bay-label',
      unitLabel: '1',
      propertyLabel: BAY.building,
    })
    const mapleRun = workflow({
      id: 'r-maple-label',
      unitLabel: '1',
      propertyLabel: MAPLE.building,
    })
    const bayResident = resident({
      id: 'res-bay',
      fullName: 'Bay Tenant',
      unit: '1',
      building: BAY.building,
    })

    // No inventory unitId → label+building may still match for legacy rows.
    expect(ticketMatchesUnit(bayTicket, BAY.unitLabel, BAY.building, null, null)).toBe(true)
    expect(ticketMatchesUnit(mapleTicket, BAY.unitLabel, BAY.building, null, null)).toBe(false)
    expect(workflowMatchesUnit(bayRun, BAY.unitLabel, BAY.building, null, null)).toBe(true)
    expect(workflowMatchesUnit(mapleRun, BAY.unitLabel, BAY.building, null, null)).toBe(false)
    expect(
      workflowMatchesPropertyScope(bayRun, { building: BAY.building }),
    ).toBe(true)
    expect(
      workflowMatchesPropertyScope(mapleRun, { building: BAY.building }),
    ).toBe(false)
    expect(findResidentsForUnit(BAY.unitLabel, BAY.building, [bayResident]).map((r) => r.id)).toEqual([
      'res-bay',
    ])
  })

  it('ticket property_id mismatch fails closed even when labels agree', () => {
    const wrongProp = ticket({
      id: 't-wrong-prop',
      unit: '1',
      building: BAY.building,
      propertyId: MAPLE.propertyId,
    })
    expect(
      ticketMatchesUnit(wrongProp, BAY.unitLabel, BAY.building, null, BAY.propertyId),
    ).toBe(false)
  })
})

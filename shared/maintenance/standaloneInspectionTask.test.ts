import { describe, expect, it } from 'vitest'
import {
  isStandaloneInspectionTaskRowId,
  planStandaloneInspectionPmComplianceTask,
  shouldShowStandaloneInspectionActiveTask,
  standaloneInspectionActiveTaskTitle,
  standaloneInspectionNextStep,
  standaloneInspectionPmDueAtIso,
  standaloneInspectionTaskRowId,
} from './standaloneInspectionTask.ts'

describe('shouldShowStandaloneInspectionActiveTask', () => {
  it('shows tenant_notice with zero linked WOs', () => {
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: 'tenant_notice',
        linkedWorkOrderCount: 0,
        emergencyItemCount: 0,
        standardItemCount: 0,
      }),
    ).toBe(true)
  })

  it('still shows tenant_notice even if WOs were wrongly linked (never absorb)', () => {
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: 'tenant_notice',
        linkedWorkOrderCount: 2,
      }),
    ).toBe(true)
  })

  it('never adds a standalone card for HQS letter types (even with zero counts)', () => {
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: 'standard_fail',
        linkedWorkOrderCount: 0,
        emergencyItemCount: 0,
        standardItemCount: 0,
      }),
    ).toBe(false)
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: 'hap_abatement',
        linkedWorkOrderCount: 12,
        standardItemCount: 12,
      }),
    ).toBe(false)
  })

  it('shows unknown/manual zero-checklist inspections', () => {
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: null,
        linkedWorkOrderCount: 0,
        emergencyItemCount: 0,
        standardItemCount: 0,
      }),
    ).toBe(true)
  })

  it('hides unknown letter types that already have itemized fail counts', () => {
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: null,
        emergencyItemCount: 1,
        standardItemCount: 11,
        linkedWorkOrderCount: 12,
      }),
    ).toBe(false)
  })
})

describe('standaloneInspectionActiveTaskTitle', () => {
  it('formats Takeira-style tenant notice', () => {
    expect(
      standaloneInspectionActiveTaskTitle({
        letterType: 'tenant_notice',
        inspectionDate: '2026-10-08',
      }),
    ).toBe('Tenant notice inspection — Oct 8, 2026')
  })

  it('next step is prepare copy', () => {
    expect(standaloneInspectionNextStep()).toBe('Prepare for inspection')
  })
})

describe('planStandaloneInspectionPmComplianceTask', () => {
  it('dues on the inspection date (not +30) and tags tenant_notice source', () => {
    const plan = planStandaloneInspectionPmComplianceTask({
      inspectionReportId: '1a992b5a-9075-49ba-83bc-7ebb0b45d746',
      letterType: 'tenant_notice',
      inspectionDate: '2026-10-08',
      unitLabel: '1',
      building: '1838 E 29th',
    })
    expect(plan.taskKind).toBe('inspection')
    expect(plan.dueAtIso).toBe(standaloneInspectionPmDueAtIso({ inspectionDate: '2026-10-08' }))
    expect(plan.metadata.source).toBe('tenant_notice')
    expect(plan.metadata.inspection_report_id).toBe(
      '1a992b5a-9075-49ba-83bc-7ebb0b45d746',
    )
    expect(plan.title).toContain('Tenant notice')
    // PM plan never invents work-order linkage.
    expect(plan.metadata).not.toHaveProperty('maintenance_request_id')
    expect(plan.metadata.emergency_item_count).toBe(0)
    expect(plan.metadata.standard_item_count).toBe(0)
  })
})

describe('standaloneInspectionTaskRowId', () => {
  it('round-trips synthetic ids', () => {
    const id = standaloneInspectionTaskRowId('1a992b5a-9075-49ba-83bc-7ebb0b45d746')
    expect(isStandaloneInspectionTaskRowId(id)).toBe(true)
    expect(id).toBe('inspection-report:1a992b5a-9075-49ba-83bc-7ebb0b45d746')
  })
})

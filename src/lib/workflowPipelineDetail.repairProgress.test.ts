import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceRepairNextAction,
  buildMaintenanceRepairProgressSteps,
  maintenanceRepairWorkPhaseLabel,
  needsVisitNotConfirmedBanner,
} from './workflowPipelineDetail.ts'

describe('buildMaintenanceRepairProgressSteps', () => {
  it('uses four board-aligned steps and matches caption length', () => {
    const steps = buildMaintenanceRepairProgressSteps({
      kanbanStage: 'assigned',
      vendorWorkStatus: 'pending_accept',
      scheduledAt: null,
    })
    expect(steps).toHaveLength(4)
    expect(steps.map((s) => s.label)).toEqual([
      'Reported',
      'Awaiting vendor',
      'In progress',
      'Complete',
    ])
    expect(steps[0]?.state).toBe('complete')
    expect(steps[1]?.state).toBe('active')
    expect(steps[2]?.state).toBe('upcoming')
  })

  it('labels work phase Scheduled when a visit is saved', () => {
    expect(
      maintenanceRepairWorkPhaseLabel({
        scheduledAt: '2026-10-22T18:00:00.000Z',
        vendorWorkStatus: 'accepted',
      }),
    ).toBe('Scheduled')

    const steps = buildMaintenanceRepairProgressSteps({
      kanbanStage: 'in_progress',
      vendorWorkStatus: 'accepted',
      scheduledAt: '2026-10-22T18:00:00.000Z',
    })
    expect(steps[2]?.label).toBe('Scheduled')
    expect(steps[2]?.state).toBe('active')
  })

  it('labels Completion photos only when close-out photos exist', () => {
    expect(
      maintenanceRepairWorkPhaseLabel({
        scheduledAt: null,
        vendorWorkStatus: 'in_progress',
        hasCompletionPhotos: true,
      }),
    ).toBe('Completion photos')
    expect(
      maintenanceRepairWorkPhaseLabel({
        scheduledAt: null,
        vendorWorkStatus: 'in_progress',
        hasCompletionPhotos: false,
      }),
    ).toBe('In progress')
  })

  it('marks Complete active on completed board stage', () => {
    const steps = buildMaintenanceRepairProgressSteps({
      kanbanStage: 'completed',
      vendorWorkStatus: 'completed',
      scheduledAt: null,
    })
    expect(steps[3]?.state).toBe('active')
    expect(steps.filter((s) => s.state === 'complete')).toHaveLength(3)
  })
})

describe('buildMaintenanceRepairNextAction', () => {
  it('says waiting for vendor accept with no landlord action', () => {
    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'pending_accept',
        vendorName: 'Ecosafe',
        scheduledAt: null,
        scheduleConfirmedAt: null,
      }),
    ).toBe('Waiting for Ecosafe to accept. No action needed.')
  })

  it('hides next-action copy when unassigned', () => {
    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'unassigned',
        vendorName: null,
        scheduledAt: null,
        scheduleConfirmedAt: null,
      }),
    ).toBeNull()
  })

  it('uses saved schedule time for confirmed visits', () => {
    const text = buildMaintenanceRepairNextAction({
      vendorWorkStatus: 'accepted',
      vendorName: 'Ecosafe',
      scheduledAt: '2099-10-22T18:00:00.000Z',
      scheduleConfirmedAt: '2026-10-21T12:00:00.000Z',
    })
    expect(text.startsWith('Ecosafe is scheduled for ')).toBe(true)
    expect(text).not.toMatch(/tomorrow/i)
  })

  it('does not invent a vendor name when missing', () => {
    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'pending_accept',
        vendorName: null,
        scheduledAt: null,
        scheduleConfirmedAt: null,
      }),
    ).toBe('Waiting for a vendor to accept. No action needed.')
  })

  it('uses schedule state copy instead of a generic confirmation wait', () => {
    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Ecosafe',
        scheduledAt: '2099-11-09T15:00:00.000Z',
        scheduleConfirmedAt: null,
        scheduleStatus: 'vendor_rescheduled_pending_resident',
        residentConfirmationStatus: 'pending',
        residentName: 'Alex Rivera',
      }),
    ).toMatch(/^Ecosafe moved the visit to .+ Waiting on Alex to confirm\.$/)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'pending_accept',
        vendorName: 'Ecosafe',
        scheduledAt: '2099-11-09T15:00:00.000Z',
        scheduleConfirmedAt: null,
        residentName: 'Alex',
      }),
    ).toMatch(/^Time saved for .+ Waiting on Ecosafe to accept the job\.$/)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Ecosafe',
        scheduledAt: '2020-01-01T15:00:00.000Z',
        scheduleConfirmedAt: null,
        scheduleStatus: 'vendor_rescheduled_pending_resident',
        residentConfirmationStatus: 'pending',
      }),
    ).toMatch(/passed without confirmation/i)
  })
})

describe('needsVisitNotConfirmedBanner', () => {
  it('shows after accept when visit is not confirmed', () => {
    expect(
      needsVisitNotConfirmedBanner({
        isMaintenanceWorkflow: true,
        vendorWorkStatus: 'accepted',
        scheduleConfirmedAt: null,
      }),
    ).toBe(true)
  })

  it('hides once the visit is confirmed or before accept', () => {
    expect(
      needsVisitNotConfirmedBanner({
        isMaintenanceWorkflow: true,
        vendorWorkStatus: 'accepted',
        scheduleConfirmedAt: '2026-11-08T15:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      needsVisitNotConfirmedBanner({
        isMaintenanceWorkflow: true,
        vendorWorkStatus: 'pending_accept',
        scheduleConfirmedAt: null,
      }),
    ).toBe(false)
  })
})

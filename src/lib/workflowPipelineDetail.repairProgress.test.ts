import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceRepairNextAction,
  buildMaintenanceRepairProgressSteps,
  maintenanceRepairWorkPhaseLabel,
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

  it('asks landlord to choose a vendor when unassigned', () => {
    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'unassigned',
        vendorName: null,
        scheduledAt: null,
        scheduleConfirmedAt: null,
      }),
    ).toBe('Choose a vendor to move this repair forward.')
  })

  it('uses saved schedule time for confirmed visits', () => {
    const text = buildMaintenanceRepairNextAction({
      vendorWorkStatus: 'accepted',
      vendorName: 'Ecosafe',
      scheduledAt: '2026-10-22T18:00:00.000Z',
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
})

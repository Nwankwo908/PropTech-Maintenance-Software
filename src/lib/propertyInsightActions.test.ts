import { describe, expect, it, vi } from 'vitest'
import {
  runPropertyInsightAction,
  workOrderLinksForInsight,
  type PropertyInsightActionDeps,
} from './propertyInsightActions'

function depsWithMocks(): PropertyInsightActionDeps & {
  startInspectorScheduling: ReturnType<typeof vi.fn>
  nudgeVendorSchedule: ReturnType<typeof vi.fn>
  resolveAssignedVendorId: ReturnType<typeof vi.fn>
} {
  return {
    startInspectorScheduling: vi.fn(async () => ({
      ok: true as const,
      result: {
        status: 'probing' as const,
        requestId: 'req-1',
        ticketId: 'ticket-1',
        targetDay: '2026-09-24',
        holdId: 'hold-1',
        vendorId: 'insp-1',
        message: 'Reaching out to an available inspector',
      },
    })),
    nudgeVendorSchedule: vi.fn(async () => ({ ok: true })),
    resolveWorkOrderPath: (ticketId: string) => `/admin/workflows?ticket=${ticketId}`,
    resolveAssignedVendorId: vi.fn(async () => 'vendor-perf-1'),
  }
}

describe('runPropertyInsightAction', () => {
  it('schedule_inspection starts inspector scheduling (not lifecycle-only)', async () => {
    const deps = depsWithMocks()
    const result = await runPropertyInsightAction(
      {
        id: 'card-1',
        actionType: 'schedule_inspection',
        unitId: 'unit-1',
        unitLabel: 'Unit 4B',
        categoryLabel: 'Plumbing',
        building: 'Oak Tower',
        ticketIds: ['t1'],
        text: 'Schedule a preventive inspection.',
      },
      deps,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('schedule_inspection')
    expect(result.scheduling?.status).toBe('probing')
    expect(result.scheduling?.ticketId).toBe('ticket-1')
    expect(deps.startInspectorScheduling).toHaveBeenCalled()
    expect(deps.nudgeVendorSchedule).not.toHaveBeenCalled()
  })

  it('request_diagnostic starts inspector scheduling', async () => {
    const deps = depsWithMocks()
    const result = await runPropertyInsightAction(
      {
        id: 'card-2',
        actionType: 'request_diagnostic',
        unitId: 'unit-1',
        unitLabel: 'Unit 4B',
        categoryLabel: 'Plumbing',
        building: 'Oak Tower',
        ticketIds: ['t1', 't2'],
        text: 'Request a plumbing diagnostic.',
      },
      deps,
    )
    expect(result.ok).toBe(true)
    expect(deps.startInspectorScheduling).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'request_diagnostic',
        insightCardId: 'card-2',
      }),
    )
    expect(deps.nudgeVendorSchedule).not.toHaveBeenCalled()
  })

  it('schedule_building_inspection and schedule_unit_walkthrough enter scheduling', async () => {
    const deps = depsWithMocks()
    for (const actionType of [
      'schedule_building_inspection',
      'schedule_unit_walkthrough',
    ] as const) {
      deps.startInspectorScheduling.mockClear()
      const result = await runPropertyInsightAction(
        {
          id: `card-${actionType}`,
          actionType,
          unitId: 'unit-1',
          unitLabel: 'Unit 1',
          categoryLabel: null,
          building: 'Oak',
          ticketIds: [],
          text: 'Walkthrough needed.',
        },
        deps,
      )
      expect(result.ok).toBe(true)
      expect(deps.startInspectorScheduling).toHaveBeenCalled()
    }
  })

  it('nudge_vendor dispatches schedule TTL nudge and never starts inspector scheduling', async () => {
    const deps = depsWithMocks()
    const result = await runPropertyInsightAction(
      {
        id: 'card-nudge',
        actionType: 'nudge_vendor',
        unitId: null,
        unitLabel: null,
        categoryLabel: null,
        building: null,
        ticketIds: ['wo-1', 'wo-2'],
        text: 'Vendors are slow to respond.',
      },
      deps,
    )
    expect(result).toEqual({ ok: true, kind: 'nudge_vendor' })
    expect(deps.nudgeVendorSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ ticketIds: ['wo-1', 'wo-2'] }),
    )
    expect(deps.startInspectorScheduling).not.toHaveBeenCalled()
  })

  it('flag_for_review navigates to vendor performance UI and never starts scheduling', async () => {
    const deps = depsWithMocks()
    const result = await runPropertyInsightAction(
      {
        id: 'card-flag',
        actionType: 'flag_for_review',
        unitId: null,
        unitLabel: null,
        categoryLabel: null,
        building: null,
        ticketIds: ['t1'],
        text: 'Vendor underperformed.',
      },
      deps,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('flag_for_review')
    expect(result.navigateTo).toBe('/admin/vendors/vendor-perf-1')
    expect(deps.startInspectorScheduling).not.toHaveBeenCalled()
    expect(deps.nudgeVendorSchedule).not.toHaveBeenCalled()
    expect(deps.resolveAssignedVendorId).toHaveBeenCalledWith(['t1'])
  })

  it('links each card to the underlying work orders', () => {
    const links = workOrderLinksForInsight({ ticketIds: ['a', 'b'] })
    expect(links).toEqual([
      { ticketId: 'a', href: '/admin/workflows?ticket=a' },
      { ticketId: 'b', href: '/admin/workflows?ticket=b' },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  dedupeMaintenanceWorkflowRunsForKanban,
  deriveInspectionGroupKanbanStage,
  deriveWorkflowKanbanStage,
  inspectionGroupProgress,
} from './adminWorkflowKanban'
import type { AdminWorkflowDashboardData, AdminWorkflowRow } from './adminWorkflows'
import { emptyAdminWorkflowDashboardData } from './adminWorkflows'
import {
  buildInspectionScopedAttentionCopy,
  formatInspectionAttentionMeta,
  shouldOmitEscalatedRunFromNeedsAttention,
} from './needsAttentionWorkOrder'
import { shouldShowStandaloneInspectionActiveTask } from '@shared/maintenance/standaloneInspectionTask'

function run(
  partial: Partial<AdminWorkflowRow> & Pick<AdminWorkflowRow, 'id' | 'templateId'>,
): AdminWorkflowRow {
  return {
    templateName: partial.templateId,
    templateType: 'other',
    status: 'active',
    currentStep: null,
    entityType: 'maintenance_request',
    entityId: partial.entityId ?? partial.id,
    residentId: null,
    residentName: null,
    unitLabel: '1',
    propertyLabel: '563 Springdale',
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    lastEventType: null,
    lastEventMessage: null,
    lastEventAt: null,
    escalationReason: null,
    issueCategory: 'general',
    issueDescription: 'HQS fail: Kitchen - Stove',
    vendorWorkStatus: 'pending_accept',
    assignedVendorId: null,
    inspectionReportId: null,
    inspectionGroupItems: null,
    ...partial,
  }
}

const REPORT = '8ac8ee35-9f78-44ec-85a8-97b90442e54c'

function twelveTicketGroup(
  statuses: Array<string | null>,
): AdminWorkflowRow[] {
  return statuses.map((status, i) => {
    const ticketId = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
    const items = statuses.map((s, j) => {
      const id = `00000000-0000-4000-8000-${String(j + 1).padStart(12, '0')}`
      return {
        ticketId: id,
        workOrderRef: `WO-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`,
        label: `Item ${j + 1}`,
        vendorWorkStatus: s,
        runId: `run-${j + 1}`,
      }
    })
    return run({
      id: `run-${i + 1}`,
      templateId: 'maintenance_request',
      entityId: ticketId,
      vendorWorkStatus: status,
      inspectionReportId: REPORT,
      inspectionGroupItems: items,
      issueDescription: `HQS fail: Item ${i + 1}`,
    })
  })
}

describe('inspection report Active Tasks grouping', () => {
  it('does not wrap a single linked ticket as an Inspection visit card', () => {
    const ticketId = 'c1e9b580-fc6a-46b9-965a-11c0b4a15673'
    const items = [
      {
        ticketId,
        workOrderRef: 'WO-C1E9',
        label: 'Wall and ceiling paint, door, and 2 patches',
        vendorWorkStatus: 'pending_accept',
        runId: 'run-c1e9',
      },
    ]
    const card = buildWorkflowKanbanCard(
      run({
        id: 'run-c1e9',
        templateId: 'maintenance_request',
        entityId: ticketId,
        inspectionReportId: '1a992b5a-9075-49ba-83bc-7ebb0b45d746',
        inspectionGroupItems: items,
        issueDescription: 'Wall and ceiling paint, door, and 2 patches',
        issueCategory: 'painting',
      }),
    )
    // Multi-item HQS groups still use Inspection visit; single tickets stay WO cards.
    expect(card.title).not.toMatch(/^Inspection visit/i)
    expect(card.inspectionChecklist).toBeNull()
  })

  it('collapses a 12-ticket inspection group into one kanban card with N-of-M progress', () => {
    const statuses = Array.from({ length: 12 }, () => 'pending_accept')
    const rows = twelveTicketGroup(statuses)
    const deduped = dedupeMaintenanceWorkflowRunsForKanban(rows)
    expect(deduped).toHaveLength(1)
    const card = buildWorkflowKanbanCard(deduped[0]!)
    expect(card.title).toMatch(/^Inspection visit · IR-/i)
    expect(card.workOrderSummary).toBe('0 of 12 complete')
    expect(card.inspectionChecklist).toHaveLength(12)
    expect(card.stage).toBe('assigned')
    // Display-only: visit rollup badge is Inspection (not Maintenance).
    expect(card.category).toBe('inspection')
    expect(card.issueCategoryLabel).toBeNull()
  })

  it('keeps individual linked WO cards on their real trade categories', () => {
    const trades = [
      { id: 'paint', category: 'painting', label: 'Painting' },
      { id: 'plumb', category: 'plumbing', label: 'Plumbing' },
      { id: 'elec', category: 'electrical', label: 'Electrical' },
    ] as const
    for (const trade of trades) {
      const card = buildWorkflowKanbanCard(
        run({
          id: `run-${trade.id}`,
          templateId: 'maintenance_request',
          entityId: `ticket-${trade.id}`,
          issueCategory: trade.category,
          issueDescription: `${trade.label} fail item`,
          vendorWorkStatus: 'pending_accept',
          // Linked to an HQS report, but rendered as its own WO card (no
          // multi-item group on this row) — e.g. Work Orders / single view.
          inspectionReportId: REPORT,
          inspectionGroupItems: null,
        }),
      )
      expect(card.category).toBe('maintenance')
      expect(card.issueCategoryLabel).toBe(trade.label)
      expect(card.title).not.toMatch(/^Inspection visit/i)
    }
  })

  it('keeps the card out of Completed when 11 of 12 are done', () => {
    const statuses = [
      ...Array.from({ length: 11 }, () => 'completed'),
      'pending_accept',
    ]
    const rows = twelveTicketGroup(statuses)
    const deduped = dedupeMaintenanceWorkflowRunsForKanban(rows)
    const card = buildWorkflowKanbanCard(deduped[0]!)
    expect(inspectionGroupProgress(deduped[0]!.inspectionGroupItems!).complete).toBe(11)
    expect(card.workOrderSummary).toBe('11 of 12 complete')
    expect(card.stage).not.toBe('completed')
    expect(deriveInspectionGroupKanbanStage(deduped[0]!.inspectionGroupItems!)).toBe(
      'assigned',
    )
  })

  it('moves to Completed only when every sibling is terminal', () => {
    const statuses = [
      ...Array.from({ length: 10 }, () => 'completed'),
      'cancelled',
      'completed',
    ]
    const rows = twelveTicketGroup(statuses)
    const deduped = dedupeMaintenanceWorkflowRunsForKanban(rows)
    const card = buildWorkflowKanbanCard(deduped[0]!)
    expect(card.workOrderSummary).toBe('12 of 12 complete')
    expect(card.stage).toBe('completed')
  })

  it('leaves ordinary tickets as one card per ticket', () => {
    const a = run({
      id: 'a',
      templateId: 'maintenance_request',
      entityId: 'ticket-a',
      vendorWorkStatus: 'pending_accept',
      issueDescription: 'Kitchen sink leak',
    })
    const b = run({
      id: 'b',
      templateId: 'maintenance_request',
      entityId: 'ticket-b',
      vendorWorkStatus: 'in_progress',
      issueDescription: 'AC not cooling',
    })
    const deduped = dedupeMaintenanceWorkflowRunsForKanban([a, b])
    expect(deduped).toHaveLength(2)
    const cards = deduped.map((row) => buildWorkflowKanbanCard(row))
    expect(cards.every((c) => !c.inspectionChecklist)).toBe(true)
    expect(cards.map((c) => c.stage).sort()).toEqual(['assigned', 'in_progress'])
  })

  it('collectAdminWorkflowRuns still returns one card for the inspection group', () => {
    const rows = twelveTicketGroup(Array.from({ length: 12 }, () => 'pending_accept'))
    const data: AdminWorkflowDashboardData = {
      ...emptyAdminWorkflowDashboardData(),
      active: rows,
    }
    expect(collectAdminWorkflowRuns(data)).toHaveLength(1)
  })

  it('rollup prefers In Progress when any sibling is accepted/in_progress', () => {
    const items = [
      {
        ticketId: 't1',
        workOrderRef: 'WO-T1',
        label: 'A',
        vendorWorkStatus: 'completed',
        runId: 'r1',
      },
      {
        ticketId: 't2',
        workOrderRef: 'WO-T2',
        label: 'B',
        vendorWorkStatus: 'in_progress',
        runId: 'r2',
      },
      {
        ticketId: 't3',
        workOrderRef: 'WO-T3',
        label: 'C',
        vendorWorkStatus: 'pending_accept',
        runId: 'r3',
      },
    ]
    expect(deriveInspectionGroupKanbanStage(items)).toBe('in_progress')
  })
})

describe('Needs Attention stays per-item for inspection groups', () => {
  it('formats identifiable per-item attention copy', () => {
    expect(
      formatInspectionAttentionMeta({
        workOrderRef: 'WO-D154',
        itemIndex: 1,
        itemTotal: 12,
        itemLabel: 'Kitchen — Stove',
        locationLabel: '563 Springdale · Unit 1',
      }),
    ).toBe(
      'WO-D154 (1 of 12, Kitchen — Stove — HQS inspection at 563 Springdale · Unit 1) needs attention',
    )
  })

  it('scopes attention meta with visit context when group items exist', () => {
    const rows = twelveTicketGroup(Array.from({ length: 12 }, () => 'pending_accept'))
    const primary = rows[0]!
    const ticketId = primary.entityId!
    const copy = buildInspectionScopedAttentionCopy({
      ticketId,
      run: primary,
      propertyLabel: '563 Springdale',
      unitLabel: '1',
      fallbackMeta: 'Past response time',
    })
    expect(copy.meta).toContain('of 12')
    expect(copy.meta).toContain('needs attention')
    expect(copy.meta).toContain('HQS inspection')
  })

  it('does not omit an escalated sibling just because the group rollup is in progress', () => {
    const items = [
      {
        ticketId: 'ticket-1',
        workOrderRef: 'WO-T1',
        label: 'Kitchen',
        vendorWorkStatus: 'pending_accept',
        runId: 'run-1',
      },
      {
        ticketId: 'ticket-2',
        workOrderRef: 'WO-T2',
        label: 'Ceiling',
        vendorWorkStatus: 'in_progress',
        runId: 'run-2',
      },
    ]
    const escalated = run({
      id: 'run-1',
      templateId: 'maintenance_request',
      entityId: 'ticket-1',
      status: 'escalated',
      vendorWorkStatus: 'pending_accept',
      escalationReason: 'no_vendor_available',
      inspectionReportId: REPORT,
      inspectionGroupItems: items,
    })
    // Group rollup would be in_progress — attention must still keep this row.
    expect(deriveWorkflowKanbanStage(escalated)).toBe('in_progress')
    expect(
      shouldOmitEscalatedRunFromNeedsAttention({
        run: escalated,
        completedTicketIds: new Set(),
      }),
    ).toBe(false)
  })
})

describe('standalone tenant-notice Active Tasks (zero checklist)', () => {
  const TAKEIRA_REPORT = '1a992b5a-9075-49ba-83bc-7ebb0b45d746'

  function standaloneNoticeRow(): AdminWorkflowRow {
    return run({
      id: `inspection-report:${TAKEIRA_REPORT}`,
      templateId: 'inspection_notice_task',
      templateName: 'Tenant notice inspection — Oct 8, 2026',
      templateType: 'inspection',
      entityType: 'inspection_report',
      entityId: TAKEIRA_REPORT,
      issueCategory: 'inspection',
      issueDescription:
        'Prepare for inspection\nSource notice: HABC annual inspection\nInspection date: 2026-10-08',
      vendorWorkStatus: null,
      inspectionReportId: TAKEIRA_REPORT,
      inspectionGroupItems: null,
    })
  }

  it('shows a Prepare-for-inspection card for a zero-WO tenant notice', () => {
    const card = buildWorkflowKanbanCard(standaloneNoticeRow())
    expect(card.title).toBe('Tenant notice inspection — Oct 8, 2026')
    expect(card.workOrderSummary).toBe('Prepare for inspection')
    expect(card.category).toBe('inspection')
    expect(card.issueCategoryLabel).toBeNull()
    expect(card.inspectionChecklist).toBeNull()
    expect(card.stage).toBe('new_intake')
  })

  it('keeps independent WOs as separate cards alongside the notice (no absorb)', () => {
    const notice = standaloneNoticeRow()
    const paint = run({
      id: 'run-c1e9',
      templateId: 'maintenance_request',
      entityId: 'c1e9b580-fc6a-46b9-965a-11c0b4a15673',
      issueCategory: 'painting',
      issueDescription: 'Wall and ceiling paint, door, and 2 patches',
      vendorWorkStatus: 'pending_accept',
      inspectionReportId: null,
      inspectionGroupItems: null,
    })
    const pest = run({
      id: 'run-5fa6',
      templateId: 'maintenance_request',
      entityId: '5fa6aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      issueCategory: 'pest',
      issueDescription: 'Roaches in kitchen',
      vendorWorkStatus: 'pending_accept',
      inspectionReportId: null,
      inspectionGroupItems: null,
    })
    const data: AdminWorkflowDashboardData = {
      ...emptyAdminWorkflowDashboardData(),
      active: [paint, pest],
      standaloneInspectionTasks: [notice],
    }
    const collected = collectAdminWorkflowRuns(data)
    expect(collected).toHaveLength(3)
    const cards = collected.map((row) => buildWorkflowKanbanCard(row))
    expect(cards.some((c) => c.id === notice.id)).toBe(true)
    expect(cards.filter((c) => c.category === 'maintenance')).toHaveLength(2)
    expect(cards.every((c) => !c.title.match(/^Inspection visit/i))).toBe(true)
  })

  it('HQS 12-WO visit shows checklist card without a duplicate standalone task', () => {
    const rows = twelveTicketGroup(Array.from({ length: 12 }, () => 'pending_accept'))
    // Even if a mistaken standalone row were loaded for an HQS report, letter-type
    // gating prevents it — simulate correct dashboard (no standalone for HQS).
    const data: AdminWorkflowDashboardData = {
      ...emptyAdminWorkflowDashboardData(),
      active: rows,
      standaloneInspectionTasks: [],
    }
    const collected = collectAdminWorkflowRuns(data)
    expect(collected).toHaveLength(1)
    const card = buildWorkflowKanbanCard(collected[0]!)
    expect(card.title).toMatch(/^Inspection visit · IR-/i)
    expect(card.inspectionChecklist).toHaveLength(12)
    expect(
      shouldShowStandaloneInspectionActiveTask({
        letterType: 'standard_fail',
        linkedWorkOrderCount: 12,
        emergencyItemCount: 0,
        standardItemCount: 12,
      }),
    ).toBe(false)
  })
})

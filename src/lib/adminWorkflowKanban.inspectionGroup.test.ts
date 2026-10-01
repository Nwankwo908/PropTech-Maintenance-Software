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

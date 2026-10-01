import { describe, expect, it } from 'vitest'
import { PENDING_ACCEPT_STALE_MS } from './vendorReassignGuards.ts'
import {
  NO_VENDOR_RESPONSE_FOLLOW_UP_MS,
  STALL_FOLLOW_UP_NEEDS_ADMIN_SIGNATURE,
  buildStallEpisodeKey,
  buildVendorStallFollowUpSms,
  classifyMaintenanceStallFollowUp,
  decideStallFollowUpDelivery,
  detectMaintenanceStallKind,
  groupStallFollowUps,
  isRentOrPaymentWorkflowTemplate,
  isResidentOvernightQuietHour,
  rematchOwnsPendingAccept,
  shouldYieldToRecentStallFollowUp,
  stallIssueLabel,
  STALL_FOLLOW_UP_REMATCH_YIELD_MS,
  type StallTicketSnapshot,
} from './maintenanceStallFollowUp.ts'

const NOW = Date.parse('2026-09-30T16:00:00.000Z')
const HOUR = 60 * 60 * 1000

function baseTicket(over: Partial<StallTicketSnapshot> = {}): StallTicketSnapshot {
  return {
    id: 't-1',
    landlordId: 'll-1',
    vendorWorkStatus: 'pending_accept',
    assignedVendorId: 'v-1',
    assignedAt: new Date(NOW - NO_VENDOR_RESPONSE_FOLLOW_UP_MS - HOUR).toISOString(),
    scheduledAt: null,
    scheduleConfirmedAt: null,
    updatedAt: new Date(NOW - HOUR).toISOString(),
    createdAt: new Date(NOW - 3 * HOUR).toISOString(),
    inspectionReportId: null,
    description: 'HQS fail: Kitchen - Stove\nrepair gas range',
    issueHeadline: 'Kitchen stove not working',
    autoReassignLastOutcome: null,
    awaitingLandlordChoiceAt: null,
    awaitingVendorAvailabilityAt: null,
    vendorNotifyError: null,
    stallFollowUpSentAt: null,
    stallFollowUpKind: null,
    stallFollowUpEpisodeKey: null,
    linkedWorkflowTemplateIds: ['maintenance_request'],
    ...over,
  }
}

describe('maintenance stall follow-up policy', () => {
  it('aligns no_vendor_response follow-up with half of pending_accept_stale', () => {
    expect(NO_VENDOR_RESPONSE_FOLLOW_UP_MS).toBe(Math.floor(PENDING_ACCEPT_STALE_MS / 2))
  })

  it('sends exactly one follow-up per stall episode (not every cron cycle)', () => {
    const ticket = baseTicket()
    const first = classifyMaintenanceStallFollowUp(ticket, NOW)
    expect(first.action).toBe('follow_up')
    if (first.action !== 'follow_up') return

    const afterSend = baseTicket({
      stallFollowUpSentAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
      stallFollowUpKind: first.kind,
      stallFollowUpEpisodeKey: first.episodeKey,
    })
    const second = classifyMaintenanceStallFollowUp(afterSend, NOW)
    expect(second).toEqual({ action: 'skip', reason: 'already_followed_up_episode' })
  })

  it('skips needs_admin_vendor sticky tickets entirely', () => {
    const ticket = baseTicket({
      autoReassignLastOutcome: 'needs_admin_vendor|pending_accept_stale',
    })
    expect(classifyMaintenanceStallFollowUp(ticket, NOW)).toEqual({
      action: 'skip',
      reason: 'needs_admin_vendor_sticky',
    })
  })

  it('skips when rematch owns full-stale pending_accept', () => {
    const ticket = baseTicket({
      assignedAt: new Date(NOW - PENDING_ACCEPT_STALE_MS - HOUR).toISOString(),
    })
    expect(rematchOwnsPendingAccept(ticket, NOW)).toBe(true)
    expect(classifyMaintenanceStallFollowUp(ticket, NOW)).toEqual({
      action: 'skip',
      reason: 'rematch_owns_pending_accept',
    })
  })

  it('groups stalled inspection siblings into one follow-up', () => {
    const report = '8ac8ee35-9f78-44ec-85a8-97b90442e54c'
    const items = [1, 2, 3, 4, 5].map((n) => {
      const ticket = baseTicket({
        id: `t-${n}`,
        inspectionReportId: report,
        issueHeadline: `Item ${n}`,
      })
      const c = classifyMaintenanceStallFollowUp(ticket, NOW)
      expect(c.action).toBe('follow_up')
      if (c.action !== 'follow_up') throw new Error('expected follow_up')
      return {
        ticket,
        kind: c.kind,
        audience: c.audience,
        episodeKey: c.episodeKey,
      }
    })
    const groups = groupStallFollowUps(items)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.ticketIds).toHaveLength(5)
    expect(groups[0]!.inspectionReportId).toBe(report)

    const sms = buildVendorStallFollowUpSms({
      vendorName: 'Michael',
      kind: 'no_vendor_response',
      locationLabel: '646 Bartlett · Unit 1',
      items: items.map((i, idx) => ({
        workOrderRef: `WO-000${idx}`,
        issueLabel: i.ticket.issueHeadline!,
      })),
    })
    expect(sms).toContain('inspection visit at 646 Bartlett')
    expect(sms).toContain('5 open items')
    expect(sms).toContain('Item 1')
    expect(sms).toContain('Item 5')
  })

  it('never classifies rent_collection-linked tickets for follow-up', () => {
    const rentLinked = baseTicket({
      linkedWorkflowTemplateIds: ['rent_collection'],
      vendorWorkStatus: 'pending_accept',
    })
    const maintenance = baseTicket({
      id: 'maint-1',
      linkedWorkflowTemplateIds: ['maintenance_request'],
    })
    expect(isRentOrPaymentWorkflowTemplate('rent_collection')).toBe(true)
    expect(classifyMaintenanceStallFollowUp(rentLinked, NOW)).toEqual({
      action: 'skip',
      reason: 'rent_collection_linked',
    })
    const maint = classifyMaintenanceStallFollowUp(maintenance, NOW)
    expect(maint.action).toBe('follow_up')
  })

  it('escalates after second threshold past first follow-up', () => {
    const ticket = baseTicket()
    const first = classifyMaintenanceStallFollowUp(ticket, NOW)
    expect(first.action).toBe('follow_up')
    if (first.action !== 'follow_up') return
    const after = baseTicket({
      stallFollowUpSentAt: new Date(NOW - 25 * HOUR).toISOString(),
      stallFollowUpKind: first.kind,
      stallFollowUpEpisodeKey: first.episodeKey,
    })
    const next = classifyMaintenanceStallFollowUp(after, NOW)
    expect(next.action).toBe('escalate')
    if (next.action === 'escalate') {
      expect(next.episodeKey).toBe(first.episodeKey)
    }
  })

  it('detects visit_overdue and stalled_in_progress', () => {
    const overdue = detectMaintenanceStallKind(
      baseTicket({
        vendorWorkStatus: 'accepted',
        scheduledAt: new Date(NOW - 10 * HOUR).toISOString(),
        updatedAt: new Date(NOW - 10 * HOUR).toISOString(),
      }),
      NOW,
    )
    expect(overdue?.kind).toBe('visit_overdue_no_update')

    const inProg = detectMaintenanceStallKind(
      baseTicket({
        vendorWorkStatus: 'in_progress',
        updatedAt: new Date(NOW - 4 * 24 * HOUR).toISOString(),
      }),
      NOW,
    )
    expect(inProg?.kind).toBe('stalled_in_progress')
  })

  it('episode key is stable across cron ticks in the same day', () => {
    const a = buildStallEpisodeKey({
      kind: 'no_vendor_response',
      ticketId: 't-1',
      inspectionReportId: 'rep-1',
      stalledSinceMs: NOW - HOUR,
    })
    const b = buildStallEpisodeKey({
      kind: 'no_vendor_response',
      ticketId: 't-1',
      inspectionReportId: 'rep-1',
      stalledSinceMs: NOW - HOUR,
    })
    expect(a).toBe(b)
    expect(a).toContain('no_vendor_response|rep-1|')
  })

  it('defers resident follow-up during quiet hours; vendors are not overnight-gated', () => {
    expect(isResidentOvernightQuietHour(23)).toBe(true)
    expect(isResidentOvernightQuietHour(3)).toBe(true)
    expect(isResidentOvernightQuietHour(8)).toBe(false)
    expect(isResidentOvernightQuietHour(10)).toBe(false)

    expect(
      decideStallFollowUpDelivery({
        audience: 'resident',
        residentLocalHour: 2,
      }),
    ).toEqual({ action: 'defer_quiet_hours' })

    expect(
      decideStallFollowUpDelivery({
        audience: 'resident',
        residentLocalHour: 9,
      }),
    ).toEqual({ action: 'send' })

    // Vendor during "overnight" still sends (commercial; no quiet-hours defer).
    expect(
      decideStallFollowUpDelivery({
        audience: 'vendor',
        residentLocalHour: 2,
        automatedGateAction: 'hold_quiet_hours',
      }),
    ).toEqual({ action: 'send' })
  })

  it('skips when schedule FSM owns the ticket', () => {
    const ticket = baseTicket({
      vendorWorkStatus: 'accepted',
      assignedAt: new Date(NOW - 50 * HOUR).toISOString(),
      scheduleFsmActive: true,
    })
    expect(classifyMaintenanceStallFollowUp(ticket, NOW)).toEqual({
      action: 'skip',
      reason: 'schedule_fsm_owns_ticket',
    })
  })

  it('uses generateIssueSummary for follow-up labels (not raw description dump)', () => {
    const label = stallIssueLabel(
      baseTicket({
        issueHeadline: null,
        description:
          'Hi there, I was wondering if you could please look at the kitchen sink which has been dripping for a few days now under the cabinet',
      }),
    )
    expect(label.toLowerCase()).toMatch(/sink|drip|kitchen/)
    expect(label.length).toBeLessThanOrEqual(80)
  })

  it('escalate signature matches needs_admin digest sticky pattern', () => {
    expect(STALL_FOLLOW_UP_NEEDS_ADMIN_SIGNATURE.startsWith('needs_admin_vendor|')).toBe(
      true,
    )
  })

  it('rematch/FSM yield while soft stall nudge is recent (any stall kind)', () => {
    expect(
      shouldYieldToRecentStallFollowUp({
        stallFollowUpSentAt: new Date(NOW - HOUR).toISOString(),
        nowMs: NOW,
      }),
    ).toBe(true)
    expect(
      shouldYieldToRecentStallFollowUp({
        stallFollowUpSentAt: new Date(
          NOW - STALL_FOLLOW_UP_REMATCH_YIELD_MS - HOUR,
        ).toISOString(),
        nowMs: NOW,
      }),
    ).toBe(false)
    expect(
      shouldYieldToRecentStallFollowUp({
        stallFollowUpSentAt: null,
        nowMs: NOW,
      }),
    ).toBe(false)
  })
})

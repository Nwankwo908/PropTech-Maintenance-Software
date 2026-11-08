import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceOverviewStatusContext,
  buildMaintenanceRepairNextAction,
  formatVisitLabel,
} from './workflowPipelineDetail.ts'

const FUTURE = '2099-11-09T15:00:00.000Z'
const NOW = Date.parse('2026-11-08T16:00:00.000Z')

describe('schedule banner copy', () => {
  it('covers every deriveMaintenanceScheduleState outcome in next-action copy', () => {
    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Metro Plumbing',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        residentName: 'Sam Lee',
        pendingResidentAsk: {
          windowText: 'Thu 2–4pm',
          scheduledAt: FUTURE,
          askedAt: '2026-11-08T14:00:00.000Z',
          kind: 'initial',
        },
        nowMs: NOW,
      }),
    ).toMatch(/^Waiting on Sam to confirm Metro Plumbing for .+ \(asked 2h ago\)\.$/)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Metro Plumbing',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: 'vendor_rescheduled_pending_resident',
        residentConfirmationStatus: 'pending',
        residentName: 'Sam Lee',
      }),
    ).toMatch(/^Metro Plumbing moved the visit to .+ Waiting on Sam to confirm\.$/)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Metro Plumbing',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: 'resident_declined_reschedule',
        residentConfirmationStatus: 'declined',
        residentName: 'Sam Lee',
      }),
    ).toBe(
      "Sam said that time doesn't work. Waiting on Metro Plumbing for a new time.",
    )

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'pending_accept',
        vendorName: 'Metro Plumbing',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
      }),
    ).toMatch(/^Time saved for .+ Waiting on Metro Plumbing to accept the job\.$/)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Metro Plumbing',
        scheduledAt: '2020-01-01T12:00:00.000Z',
        scheduleConfirmedAt: null,
        scheduleStatus: 'vendor_rescheduled_pending_resident',
        residentConfirmationStatus: 'pending',
      }),
    ).toMatch(/^The proposed time \(.+\) passed without confirmation\.$/)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Metro Plumbing',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: '2026-11-08T12:00:00.000Z',
      }),
    ).toMatch(/^Metro Plumbing is scheduled for /)

    expect(
      buildMaintenanceRepairNextAction({
        vendorWorkStatus: 'accepted',
        vendorName: 'Metro Plumbing',
        scheduledAt: '2020-01-01T12:00:00.000Z',
        scheduleConfirmedAt: '2020-01-01T10:00:00.000Z',
        nowMs: NOW,
      }),
    ).toMatch(/^The visit was .+ and there's no update from Metro Plumbing\.$/)
  })

  it('labels Visit as proposed, confirmed, or passed', () => {
    expect(
      formatVisitLabel(null, null, {
        pendingResidentAsk: {
          windowText: 'Thu 2–4pm',
          scheduledAt: FUTURE,
          askedAt: null,
          kind: 'initial',
        },
        scheduleState: 'awaiting_resident_first_confirm',
      }),
    ).toMatch(/· proposed$/)

    expect(
      formatVisitLabel(FUTURE, '2026-11-08T12:00:00.000Z', {
        scheduleState: 'confirmed_upcoming',
      }),
    ).toMatch(/· confirmed$/)

    expect(
      formatVisitLabel('2020-01-01T12:00:00.000Z', null, {
        scheduleState: 'proposed_window_passed',
      }),
    ).toMatch(/· passed$/)

    expect(
      formatVisitLabel(FUTURE, null, {
        scheduleState: 'awaiting_resident_reschedule_confirm',
      }),
    ).not.toMatch(/pending confirm/i)
  })

  it('keeps status-context schedule copy aligned with next action', () => {
    const shared = {
      vendorWorkStatus: 'accepted' as const,
      vendorName: 'Metro Plumbing',
      scheduledAt: FUTURE,
      scheduleConfirmedAt: null as string | null,
      scheduleStatus: 'vendor_rescheduled_pending_resident',
      residentConfirmationStatus: 'pending',
      residentName: 'Sam Lee',
    }
    expect(buildMaintenanceOverviewStatusContext({
      ...shared,
      stageLabel: 'Assigned',
      lastEventMessage: null,
      escalationReason: null,
      runStatus: 'active',
    })).toBe(buildMaintenanceRepairNextAction(shared))
  })
})

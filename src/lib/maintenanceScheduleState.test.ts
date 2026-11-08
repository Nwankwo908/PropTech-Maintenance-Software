import { describe, expect, it } from 'vitest'
import {
  VISIT_OVERDUE_GRACE_MS,
  deriveMaintenanceScheduleState,
  formatAskedAgo,
  parsePendingResidentScheduleAsk,
  resolveScheduleWhenLabel,
  visitLabelKindForScheduleState,
  type PendingResidentScheduleAsk,
} from './maintenanceScheduleState.ts'

const NOW = Date.parse('2026-11-08T16:00:00.000Z')
const FUTURE = '2026-11-09T15:00:00.000Z'
const PAST = '2026-11-08T10:00:00.000Z'
const OVERDUE =
  new Date(NOW - VISIT_OVERDUE_GRACE_MS - 60_000).toISOString()

const firstAsk: PendingResidentScheduleAsk = {
  windowText: 'Mon 2–4pm',
  scheduledAt: FUTURE,
  askedAt: '2026-11-08T14:00:00.000Z',
  kind: 'initial',
}

const rescheduleAsk: PendingResidentScheduleAsk = {
  windowText: 'Tue 9–11am',
  scheduledAt: FUTURE,
  askedAt: '2026-11-08T13:00:00.000Z',
  kind: 'reschedule',
}

describe('deriveMaintenanceScheduleState', () => {
  it('returns none for completed or cancelled', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'completed',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: FUTURE,
        scheduleStatus: 'scheduled_confirmed',
        residentConfirmationStatus: 'confirmed',
        nowMs: NOW,
      }),
    ).toBe('none')
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'cancelled',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        scheduleStatus: null,
        residentConfirmationStatus: null,
        nowMs: NOW,
      }),
    ).toBe('none')
  })

  it('awaiting_resident_first_confirm from pending initial ask', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        scheduleStatus: null,
        residentConfirmationStatus: null,
        pendingResidentAsk: firstAsk,
        nowMs: NOW,
      }),
    ).toBe('awaiting_resident_first_confirm')
  })

  it('awaiting_resident_reschedule_confirm from ticket status or reschedule ask', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: 'vendor_rescheduled_pending_resident',
        residentConfirmationStatus: 'pending',
        nowMs: NOW,
      }),
    ).toBe('awaiting_resident_reschedule_confirm')

    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: null,
        residentConfirmationStatus: null,
        pendingResidentAsk: rescheduleAsk,
        nowMs: NOW,
      }),
    ).toBe('awaiting_resident_reschedule_confirm')
  })

  it('resident_declined_waiting_vendor when resident declined or counter-proposed', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: 'resident_declined_reschedule',
        residentConfirmationStatus: 'declined',
        nowMs: NOW,
      }),
    ).toBe('resident_declined_waiting_vendor')

    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: 'resident_declined_reschedule',
        residentConfirmationStatus: 'counter_proposed',
        nowMs: NOW,
      }),
    ).toBe('resident_declined_waiting_vendor')
  })

  it('window_saved_awaiting_vendor_accept when time is saved and vendor has not accepted', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'pending_accept',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: null,
        scheduleStatus: null,
        residentConfirmationStatus: null,
        vendorNotifiedAt: '2026-11-08T12:00:00.000Z',
        nowMs: NOW,
      }),
    ).toBe('window_saved_awaiting_vendor_accept')
  })

  it('proposed_window_passed when waiting on resident and the proposed time is past', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        scheduleStatus: null,
        residentConfirmationStatus: null,
        pendingResidentAsk: { ...firstAsk, scheduledAt: PAST },
        nowMs: NOW,
      }),
    ).toBe('proposed_window_passed')

    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: PAST,
        scheduleConfirmedAt: null,
        scheduleStatus: 'vendor_rescheduled_pending_resident',
        residentConfirmationStatus: 'pending',
        nowMs: NOW,
      }),
    ).toBe('proposed_window_passed')
  })

  it('confirmed_upcoming when visit is confirmed and not overdue', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: FUTURE,
        scheduleConfirmedAt: '2026-11-08T12:00:00.000Z',
        scheduleStatus: 'scheduled_confirmed',
        residentConfirmationStatus: 'confirmed',
        nowMs: NOW,
      }),
    ).toBe('confirmed_upcoming')
  })

  it('confirmed_visit_passed_no_update after grace when still accepted or pending_accept', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: OVERDUE,
        scheduleConfirmedAt: '2026-11-07T12:00:00.000Z',
        scheduleStatus: 'scheduled_confirmed',
        residentConfirmationStatus: 'confirmed',
        nowMs: NOW,
      }),
    ).toBe('confirmed_visit_passed_no_update')

    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'pending_accept',
        scheduledAt: OVERDUE,
        scheduleConfirmedAt: '2026-11-07T12:00:00.000Z',
        scheduleStatus: 'scheduled_confirmed',
        residentConfirmationStatus: 'confirmed',
        nowMs: NOW,
      }),
    ).toBe('confirmed_visit_passed_no_update')

    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'in_progress',
        scheduledAt: OVERDUE,
        scheduleConfirmedAt: '2026-11-07T12:00:00.000Z',
        scheduleStatus: 'scheduled_confirmed',
        residentConfirmationStatus: 'confirmed',
        nowMs: NOW,
      }),
    ).toBe('confirmed_upcoming')
  })

  it('returns none when there is no schedule signal', () => {
    expect(
      deriveMaintenanceScheduleState({
        vendorWorkStatus: 'accepted',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        scheduleStatus: null,
        residentConfirmationStatus: null,
        nowMs: NOW,
      }),
    ).toBe('none')
  })
})

describe('visitLabelKindForScheduleState', () => {
  it('maps proposed / confirmed / passed', () => {
    expect(visitLabelKindForScheduleState('awaiting_resident_first_confirm')).toBe(
      'proposed',
    )
    expect(visitLabelKindForScheduleState('confirmed_upcoming')).toBe('confirmed')
    expect(visitLabelKindForScheduleState('proposed_window_passed')).toBe('passed')
    expect(visitLabelKindForScheduleState('confirmed_visit_passed_no_update')).toBe(
      'passed',
    )
    expect(visitLabelKindForScheduleState('resident_declined_waiting_vendor')).toBe(
      null,
    )
  })
})

describe('formatAskedAgo', () => {
  it('formats hours from a real asked-at', () => {
    expect(formatAskedAgo('2026-11-08T14:00:00.000Z', NOW)).toBe('2h ago')
  })

  it('returns null when asked-at is missing', () => {
    expect(formatAskedAgo(null, NOW)).toBeNull()
  })
})

describe('parsePendingResidentScheduleAsk', () => {
  it('reads initial ask and derives askedAt from expires_at', () => {
    const ask = parsePendingResidentScheduleAsk({
      ticketId: 'ticket-1',
      conversationUpdatedAt: '2026-11-08T12:30:00.000Z',
      nowMs: NOW,
      intakeState: {
        awaiting_schedule_confirmation: {
          ticket_id: 'ticket-1',
          vendor_id: 'vendor-1',
          window_text: 'Wed 10am–12pm',
          scheduled_at: FUTURE,
          kind: 'initial',
          expires_at: '2026-11-09T14:00:00.000Z',
        },
      },
    })
    expect(ask).toEqual({
      windowText: 'Wed 10am–12pm',
      scheduledAt: FUTURE,
      askedAt: '2026-11-08T14:00:00.000Z',
      kind: 'initial',
    })
  })

  it('ignores asks for other tickets or expired asks', () => {
    expect(
      parsePendingResidentScheduleAsk({
        ticketId: 'ticket-1',
        nowMs: NOW,
        intakeState: {
          awaiting_schedule_confirmation: {
            ticket_id: 'other',
            window_text: 'Wed 10am',
            kind: 'initial',
          },
        },
      }),
    ).toBeNull()

    expect(
      parsePendingResidentScheduleAsk({
        ticketId: 'ticket-1',
        nowMs: NOW,
        intakeState: {
          awaiting_schedule_confirmation: {
            ticket_id: 'ticket-1',
            window_text: 'Wed 10am',
            kind: 'initial',
            expires_at: '2026-11-08T12:00:00.000Z',
          },
        },
      }),
    ).toBeNull()
  })
})

describe('resolveScheduleWhenLabel', () => {
  it('prefers ISO over window text and never invents', () => {
    expect(
      resolveScheduleWhenLabel({
        scheduledAt: FUTURE,
        pendingResidentAsk: firstAsk,
        formatIso: () => 'Mon, Nov 9, 10:00 AM',
      }),
    ).toBe('Mon, Nov 9, 10:00 AM')

    expect(
      resolveScheduleWhenLabel({
        scheduledAt: null,
        pendingResidentAsk: { ...firstAsk, scheduledAt: null },
        formatIso: () => null,
      }),
    ).toBe('Mon 2–4pm')

    expect(
      resolveScheduleWhenLabel({
        scheduledAt: null,
        pendingResidentAsk: null,
        formatIso: () => 'should-not-appear',
      }),
    ).toBeNull()
  })
})

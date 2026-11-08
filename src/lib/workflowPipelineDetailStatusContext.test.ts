import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceOverviewStatusContext,
  buildMaintenanceOverviewStatusLabel,
  composeIssueDetailsNarrative,
  formatIssueLocationWithServes,
} from './workflowPipelineDetail.ts'

describe('buildMaintenanceOverviewStatusContext', () => {
  it('explains waiting for vendor accept', () => {
    expect(
      buildMaintenanceOverviewStatusContext({
        vendorWorkStatus: 'pending_accept',
        vendorName: 'Flex Plumbing',
        stageLabel: 'Assigned',
        lastEventMessage: null,
        escalationReason: null,
        runStatus: 'active',
        scheduledAt: null,
        scheduleConfirmedAt: null,
      }),
    ).toBe('Waiting for Flex Plumbing to accept this work order.')
  })

  it('prefers confirmed visit wording', () => {
    expect(
      buildMaintenanceOverviewStatusContext({
        vendorWorkStatus: 'accepted',
        vendorName: 'Flex Plumbing',
        stageLabel: 'In Progress',
        lastEventMessage: null,
        escalationReason: null,
        runStatus: 'active',
        scheduledAt: '2099-10-08T14:00:00.000Z',
        scheduleConfirmedAt: '2026-10-07T12:00:00.000Z',
      }),
    ).toMatch(/^Flex Plumbing is scheduled for /)
  })

  it('names who we are waiting on for a first resident confirm', () => {
    const text = buildMaintenanceOverviewStatusContext({
      vendorWorkStatus: 'accepted',
      vendorName: 'Flex Plumbing',
      stageLabel: 'Assigned',
      lastEventMessage: null,
      escalationReason: null,
      runStatus: 'active',
      scheduledAt: null,
      scheduleConfirmedAt: null,
      residentName: 'Alex Rivera',
      pendingResidentAsk: {
        windowText: 'Mon 2–4pm',
        scheduledAt: '2099-11-09T15:00:00.000Z',
        askedAt: '2026-11-08T14:00:00.000Z',
        kind: 'initial',
      },
      nowMs: Date.parse('2026-11-08T16:00:00.000Z'),
    })
    expect(text).toMatch(
      /^Waiting on Alex to confirm Flex Plumbing for .+ \(asked 2h ago\)\.$/,
    )
  })

  it('shows rating wait when work is done and feedback is still open', () => {
    expect(
      buildMaintenanceOverviewStatusContext({
        vendorWorkStatus: 'completed',
        vendorName: 'Flex Plumbing',
        stageLabel: 'Completed',
        lastEventMessage: null,
        escalationReason: null,
        runStatus: 'completed',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        residentName: 'Alex Rivera',
        awaitingResidentRating: true,
      }),
    ).toBe("Work done. Waiting on Alex's 1–5 rating to close the job.")
  })

  it('shows reopen copy when the resident reopened the job', () => {
    expect(
      buildMaintenanceOverviewStatusContext({
        vendorWorkStatus: 'accepted',
        vendorName: 'Flex Plumbing',
        stageLabel: 'Assigned',
        lastEventMessage: null,
        escalationReason: null,
        runStatus: 'active',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        reopenedByResident: true,
      }),
    ).toBe('Reopened by the resident')
  })

  it('surfaces escalation reason when escalated', () => {
    expect(
      buildMaintenanceOverviewStatusContext({
        vendorWorkStatus: 'pending_accept',
        vendorName: 'Flex Plumbing',
        stageLabel: 'Escalated',
        lastEventMessage: null,
        escalationReason: 'Vendor did not respond in time.',
        runStatus: 'escalated',
        scheduledAt: null,
        scheduleConfirmedAt: null,
      }),
    ).toBe('Vendor did not respond in time.')
  })

  it('never shows sla_expired_no_vendor raw to landlords', () => {
    const text = buildMaintenanceOverviewStatusContext({
      vendorWorkStatus: 'unassigned',
      vendorName: null,
      stageLabel: 'Escalated',
      lastEventMessage: null,
      escalationReason: 'sla_expired_no_vendor',
      runStatus: 'escalated',
      scheduledAt: null,
      scheduleConfirmedAt: null,
      issueCategory: 'appliance',
    })
    expect(text).not.toMatch(/sla_expired/i)
    expect(text).toMatch(/response time/i)
    expect(text).toMatch(/replacement vendor/i)
  })

  it('does not say waiting to accept when landlord choice is pending after decline', () => {
    const text = buildMaintenanceOverviewStatusContext({
      vendorWorkStatus: 'pending_accept',
      vendorName: 'Ivanhomesolutions',
      stageLabel: 'Assigned',
      lastEventMessage: null,
      escalationReason: null,
      runStatus: 'active',
      scheduledAt: null,
      scheduleConfirmedAt: null,
      awaitingLandlordChoice: true,
    })
    expect(text).toBe(
      'Ivanhomesolutions declined. Waiting for you to choose a replacement vendor.',
    )
    expect(text).not.toMatch(/Waiting for Ivanhomesolutions to accept/i)
    expect(
      buildMaintenanceOverviewStatusLabel({
        vendorWorkStatus: 'pending_accept',
        awaitingLandlordChoice: true,
      }),
    ).toBe('Needs your vendor choice')
  })

  it('surfaces sticky needs_admin stale pending_accept as unresponsive, not ordinary waiting', () => {
    const text = buildMaintenanceOverviewStatusContext({
      vendorWorkStatus: 'pending_accept',
      vendorName: 'Handyman Services By Michael',
      stageLabel: 'Assigned',
      lastEventMessage: null,
      escalationReason: 'sla_expired_no_vendor',
      runStatus: 'escalated',
      scheduledAt: null,
      scheduleConfirmedAt: null,
      stalePendingAcceptNeedsAdmin: true,
    })
    expect(text).toMatch(/never accepted/i)
    expect(text).toMatch(/unresponsive/i)
    expect(text).not.toMatch(/Waiting for Handyman Services By Michael to accept/i)
    expect(
      buildMaintenanceOverviewStatusLabel({
        vendorWorkStatus: 'pending_accept',
        stalePendingAcceptNeedsAdmin: true,
      }),
    ).toMatch(/unresponsive/i)
  })

  it('does not say an observation or unapproved Home Check follow-up is matching a vendor', () => {
    expect(buildMaintenanceOverviewStatusContext({
      vendorWorkStatus: 'unassigned',
      vendorName: null,
      stageLabel: 'New Intake',
      lastEventMessage: null,
      escalationReason: null,
      runStatus: 'completed',
      scheduledAt: null,
      scheduleConfirmedAt: null,
      holdVendorDispatch: true,
    })).toBe('Observation only. No vendor is being contacted.')
    expect(buildMaintenanceOverviewStatusContext({
      vendorWorkStatus: 'unassigned',
      vendorName: null,
      stageLabel: 'New Intake',
      lastEventMessage: null,
      escalationReason: null,
      runStatus: 'active',
      scheduledAt: null,
      scheduleConfirmedAt: null,
      issueCategory: 'home_check_warning',
      holdVendorDispatch: true,
    })).toBe('Review this follow-up before any paid work. No vendor is being contacted.')
  })
})

describe('composeIssueDetailsNarrative', () => {
  it('keeps one prose body and drops Serves scrap lines', () => {
    const text = composeIssueDetailsNarrative({
      reportedDetail:
        'The tenant reports a leak from the basement baseboard heater serving the first floor. The valve is heavily rusted and may need replacement.',
      displayDescription: 'Baseboard heater leak\nLocation: Basement\nServes: First floor',
      triageFlags: [],
      availability: null,
      needsClarification: null,
      rawFallback: 'raw',
    })
    expect(text).toMatch(/tenant reports a leak/i)
    expect(text).not.toMatch(/^Serves:/m)
    expect(text).not.toMatch(/^Location:/m)
  })
})

describe('formatIssueLocationWithServes', () => {
  it('adds serves when it is new information', () => {
    expect(formatIssueLocationWithServes('Basement', 'First floor')).toBe(
      'Basement · serves First floor',
    )
  })

  it('does not repeat serves already in the location', () => {
    expect(formatIssueLocationWithServes('Basement serving first floor', 'First floor')).toBe(
      'Basement serving first floor',
    )
  })
})

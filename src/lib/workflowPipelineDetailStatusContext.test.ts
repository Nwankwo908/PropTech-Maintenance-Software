import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceOverviewStatusContext,
  buildMaintenanceOverviewStatusLabel,
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
        scheduledAt: '2026-10-08T14:00:00.000Z',
        scheduleConfirmedAt: '2026-10-07T12:00:00.000Z',
      }),
    ).toMatch(/^Visit confirmed with Flex Plumbing:/)
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
})

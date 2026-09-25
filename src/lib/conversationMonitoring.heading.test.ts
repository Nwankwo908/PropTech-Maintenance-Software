import { describe, expect, it } from 'vitest'
import {
  applyMonitoringHeadingName,
  buildAdminMonitoringSummary,
  looksLikeResidentConfirmedResolved,
  resolveMonitoringRailHeading,
  type ConversationMonitoringDetail,
} from '@/lib/conversationMonitoring'

function baseDetail(
  overrides: Partial<ConversationMonitoringDetail> = {},
): ConversationMonitoringDetail {
  return {
    conversationId: 'c1',
    title: 'Plumbing issue · Unit 2',
    subtitle: 'Admin monitoring view · SMS · auto-routed to Ulo AI',
    riskLevel: 'medium',
    riskLabel: 'Medium',
    summary: 'Summary',
    tenantName: 'Participant',
    tenantInitials: '?',
    residentId: null,
    transcript: [],
    readOnlyNote: 'Read-only',
    canTakeOver: false,
    ...overrides,
  }
}

describe('resolveMonitoringRailHeading', () => {
  it('uses the tenant name as the rail title and keeps the issue as subtitle', () => {
    expect(
      resolveMonitoringRailHeading({
        residentName: 'Jordan Lee',
        vendorName: '',
        conversationType: 'resident_intake',
        issueOrStatusTitle: 'Plumbing issue · Unit 2',
        fallbackSubtitle: 'Admin monitoring view · SMS',
      }),
    ).toEqual({
      title: 'Jordan Lee',
      subtitle: 'Plumbing issue · Unit 2',
    })
  })

  it('keeps Tenant onboarding as the subtitle under the tenant name', () => {
    expect(
      resolveMonitoringRailHeading({
        residentName: 'Jordan Lee',
        vendorName: '',
        conversationType: 'resident_intake',
        issueOrStatusTitle: 'Tenant onboarding',
        fallbackSubtitle: 'Admin monitoring view · SMS · tenant onboarding',
      }),
    ).toEqual({
      title: 'Jordan Lee',
      subtitle: 'Tenant onboarding',
    })
  })

  it('falls back to the issue title when no participant name is known', () => {
    expect(
      resolveMonitoringRailHeading({
        residentName: '',
        vendorName: '',
        conversationType: 'resident_intake',
        issueOrStatusTitle: 'Plumbing issue · Unit 2',
        fallbackSubtitle: 'Admin monitoring view · SMS',
      }),
    ).toEqual({
      title: 'Plumbing issue · Unit 2',
      subtitle: 'Admin monitoring view · SMS',
    })
  })
})

describe('applyMonitoringHeadingName', () => {
  it('overrides an issue title with the Messages list participant name', () => {
    const next = applyMonitoringHeadingName(baseDetail(), 'Jordan Lee')
    expect(next.title).toBe('Jordan Lee')
    expect(next.subtitle).toBe('Plumbing issue · Unit 2')
    expect(next.tenantName).toBe('Jordan Lee')
  })

  it('does not replace an onboarding risk label path when name already matches', () => {
    const detail = baseDetail({
      title: 'Jordan Lee',
      subtitle: 'Tenant onboarding',
      tenantName: 'Jordan Lee',
      tenantInitials: 'JL',
    })
    expect(applyMonitoringHeadingName(detail, 'Jordan Lee')).toEqual(detail)
  })
})

describe('buildAdminMonitoringSummary', () => {
  it('Takeira: summarizes the exterminator ask instead of a generic monitor line', () => {
    const body =
      'Hi and thank you I was trying to see if an exterminator can come out to spray the property'
    const summary = buildAdminMonitoringSummary({
      residentName: 'Takeira Chestor',
      building: '14 Maple Ave',
      unitLabel: '1',
      ticketDescription: body,
      ticketCategory: 'pest_control',
      maintenanceRequestId: 'mr-takeira',
      messages: [{ direction: 'inbound', body }],
    })
    expect(summary).toContain('Takeira Chestor')
    expect(summary.toLowerCase()).toContain('pest control')
    expect(summary).not.toMatch(/Hi and thank you/i)
    expect(summary).not.toMatch(/monitoring this thread/i)
    expect(summary).not.toMatch(/confirmed the issue is resolved/i)
  })

  it('Takeira: maintenance ask wins over a welcome SMS still in the same thread', () => {
    const welcome =
      'Reply YES to activate maintenance requests and important home updates. Once activated, just text this number anytime you need a repair.'
    const body =
      'Hi and thank you I was trying to see if an exterminator can come out to spray the property'
    const summary = buildAdminMonitoringSummary({
      residentName: 'Takeira Chestor',
      building: '14 Maple Ave',
      unitLabel: '1',
      maintenanceRequestId: 'mr-takeira',
      ticketDescription: body,
      ticketCategory: 'pest_control',
      messages: [
        { direction: 'outbound', body: welcome },
        { direction: 'inbound', body: 'YES' },
        { direction: 'inbound', body },
      ],
    })
    expect(summary.toLowerCase()).toContain('pest control')
    expect(summary).not.toMatch(/welcome text/i)
    expect(summary).not.toMatch(/Hi and thank you/i)
  })

  it('does not treat a polite thank-you on a new ask as resolved', () => {
    expect(
      looksLikeResidentConfirmedResolved(
        'Hi and thank you I was trying to see if an exterminator can come out to spray the property',
      ),
    ).toBe(false)
  })
})

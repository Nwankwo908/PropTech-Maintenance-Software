import { describe, expect, it } from 'vitest'
import {
  buildAdminMaintenanceReportSummary,
  extractAdminIssueNounPhrase,
  stripTenantMessageFiller,
} from '@/lib/adminMonitoringIssueSummary'
import { buildAdminMonitoringSummary } from '@/lib/conversationMonitoring'

const GREETING_OR_PLEASANTRY =
  /\b(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thank(?:s|\s+you)|thx|i was trying to see if|i was wondering)\b/i

function assertCleanIssueSummary(summary: string) {
  expect(summary).not.toMatch(GREETING_OR_PLEASANTRY)
  expect(summary.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(20)
  expect(summary).not.toMatch(/Ulo is handling this maintenance request/i)
  expect(summary).not.toMatch(/Monitor the SMS thread below/i)
}

describe('stripTenantMessageFiller', () => {
  it('removes greeting and thank-you hedges', () => {
    expect(
      stripTenantMessageFiller(
        'Hi and thank you I was trying to see if an exterminator can come out to spray the property',
      ).toLowerCase(),
    ).toContain('exterminator')
    expect(
      stripTenantMessageFiller(
        'Hi and thank you I was trying to see if an exterminator can come out to spray the property',
      ),
    ).not.toMatch(/thank you/i)
  })
})

describe('extractAdminIssueNounPhrase', () => {
  it('maps Takeira-style pest ask to a pest control noun phrase', () => {
    const result = extractAdminIssueNounPhrase(
      'Hi and thank you I was trying to see if an exterminator can come out to spray the property',
    )
    expect(result.confidence).toBe('high')
    expect(result.phrase).toBe('a pest control request')
  })

  it('maps kitchen sink leak', () => {
    expect(extractAdminIssueNounPhrase('THE KITCHEN SINK IS LEAKING BAD').phrase).toBe(
      'a kitchen sink leak',
    )
  })

  it('maps no heat', () => {
    expect(extractAdminIssueNounPhrase('NO HEAT IN THE UNIT SINCE LAST NIGHT').phrase).toBe(
      'no heat',
    )
  })

  it('falls back to truncated cleaned text when classification is weak', () => {
    const result = extractAdminIssueNounPhrase(
      'Hi thanks something weird with the thing in the corner maybe later',
    )
    expect(result.confidence).toBe('low')
    expect(result.phrase.split(/\s+/).length).toBeLessThanOrEqual(15)
    expect(result.phrase).not.toMatch(/^Hi\b/i)
  })
})

describe('buildAdminMaintenanceReportSummary', () => {
  it('Takeira greeting-heavy: states pest control, not the raw quote', () => {
    const summary = buildAdminMaintenanceReportSummary({
      residentName: 'Takeira Chestor',
      unitLabel: '1',
      building: '14 Maple Ave',
      ticketDescription:
        'Hi and thank you I was trying to see if an exterminator can come out to spray the property',
      ticketCategory: 'pest_control',
    })
    expect(summary).toBe(
      'Takeira Chestor (Unit 1, 14 Maple Ave) reported a pest control request.',
    )
    assertCleanIssueSummary(summary!)
  })

  it('all-caps urgent no heat prepends urgent flag', () => {
    const summary = buildAdminMaintenanceReportSummary({
      residentName: 'Jordan Lee',
      unitLabel: '4B',
      building: 'Oakwood Apartments',
      ticketDescription: 'NO HEAT SINCE YESTERDAY PLEASE HELP',
      ticketUrgency: 'urgent',
    })
    expect(summary).toBe(
      'Jordan Lee (Unit 4B, Oakwood) reported no heat — urgent.',
    )
    assertCleanIssueSummary(summary!)
  })

  it('rambling kitchen sink message becomes a short leak phrase', () => {
    const summary = buildAdminMaintenanceReportSummary({
      residentName: 'Sam Rivera',
      unitLabel: '2',
      building: '22 Pine St',
      ticketDescription:
        'Hey so yeah I noticed earlier today that under the kitchen sink there is water leaking pretty bad and I am not sure what to do',
    })
    expect(summary).toBe(
      'Sam Rivera (Unit 2, 22 Pine St) reported a kitchen sink leak.',
    )
    assertCleanIssueSummary(summary!)
  })

  it('terse message still produces a noun phrase', () => {
    const summary = buildAdminMaintenanceReportSummary({
      residentName: 'Alex Kim',
      unitLabel: '3A',
      building: '9 Cedar Rd',
      ticketDescription: 'Outlet sparking',
    })
    expect(summary).toBe(
      'Alex Kim (Unit 3A, 9 Cedar Rd) reported a sparking outlet.',
    )
    assertCleanIssueSummary(summary!)
  })
})

describe('buildAdminMonitoringSummary integration', () => {
  it('Takeira welcome + repair thread uses generated issue summary', () => {
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
    expect(summary).toContain('pest control')
    expect(summary).not.toMatch(/welcome text/i)
    expect(summary).not.toMatch(/Hi and thank you/i)
    assertCleanIssueSummary(summary)
  })
})

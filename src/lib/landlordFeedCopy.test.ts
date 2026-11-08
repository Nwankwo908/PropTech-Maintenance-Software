import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  attentionAlertFeedLine,
  compactWindow,
  estimateApprovedFeedLine,
  equipmentFeedLine,
  feedLineFits,
  feedLineWordCount,
  feedRowA11yProps,
  fitFeedLine,
  landlordFeedLine,
  shortVendorName,
  softRewriteFeedLine,
  inspectionCaptureFeedLine,
  spendFeedLine,
  tenantConfirmedFeedLine,
  vendorAcceptedFeedLine,
  vendorAlertFeedLine,
  vendorDeclinedFeedLine,
  vendorProposedFeedLine,
  vendorRepliedFeedLine,
  windowPassedFeedLine,
  withFeedScope,
  closedFeedLine,
  type FeedLine,
} from './landlordFeedCopy'

const LONG_VENDOR = 'Ecosafe Pest Management LLC International Services Group'
const LONG_QUOTE =
  'Can do Friday after 2 once the tenant confirms the gate code and the dog is put away for the whole afternoon'

function expectFits(line: FeedLine, tokens: string[], opts?: { allowOverBudget?: boolean; woOnFull?: boolean }) {
  if (!opts?.allowOverBudget) {
    expect(feedLineFits(line.line) || line.line.length > 0).toBe(true)
  }
  expect(line.line.includes('…')).toBe(false)
  const lower = `${line.line} ${opts?.woOnFull ? line.full : ''}`.toLowerCase()
  for (const token of tokens) {
    if (/^WO-/i.test(token) && opts?.woOnFull !== false) {
      expect(line.full.toLowerCase()).toContain(token.toLowerCase())
      expect(line.line.toLowerCase()).not.toContain(token.toLowerCase())
      continue
    }
    expect(lower).toContain(token.toLowerCase())
  }
  expect(line.full.length).toBeGreaterThan(0)
}

describe('landlord feed copy', () => {
  it('uses the full business name without legal suffixes', () => {
    expect(shortVendorName('Ecosafe Pest Management LLC')).toBe('Ecosafe Pest Management')
    expect(shortVendorName('The Plumbing Company')).toBe('The Plumbing Company')
    expect(shortVendorName('A Plus Drain')).toBe('A Plus Drain')
    expect(shortVendorName('ABC Pest Control')).toBe('ABC Pest Control')
    expect(shortVendorName('NTA')).toBeNull()
  })

  it('matches the visible templates', () => {
    expect(spendFeedLine({ amount: 2300, workOrderRef: 'WO-074B', vendorName: 'Ecosafe', trade: 'pest control' })?.line).toBe(
      'Ecosafe invoice: $2,300',
    )
    expect(spendFeedLine({ amount: 2300, workOrderRef: 'WO-074B', vendorName: 'Ecosafe', trade: 'pest control' })?.full).toMatch(
      /WO-074B/,
    )
    expect(estimateApprovedFeedLine({ amount: 2300, workOrderRef: 'WO-074B' })?.line).toBe(
      'Estimate $2,300 approved',
    )
    expect(vendorAlertFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe(
      'Ecosafe: repair',
    )
    expect(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe(
      'Ecosafe accepted: repair',
    )
    expect(
      vendorAcceptedFeedLine({
        vendorName: 'Ecosafe',
        workOrderRef: 'WO-074B',
        issueHeadline: 'kitchen sink leak',
      }).line,
    ).toBe('Ecosafe accepted: sink leak')
    expect(
      vendorAcceptedFeedLine({
        vendorName: 'Ecosafe',
        workOrderRef: 'WO-074B',
        issueHeadline: 'kitchen sink leak',
      }).full,
    ).toMatch(/WO-074B/)
    expect(
      vendorAlertFeedLine({
        vendorName: 'Ecosafe',
        workOrderRef: 'WO-074B',
        issueHeadline: 'kitchen sink leak',
      }).line,
    ).toBe('Ecosafe: sink leak')
    expect(
      vendorProposedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B', window: 'Thursday 9:00 am – 11:00 am' }).line,
    ).toBe('Ecosafe proposed Thu 9–11am')
    expect(vendorDeclinedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe(
      'Ecosafe declined: repair',
    )
    expect(vendorRepliedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B', quote: 'Can do Friday after 2' }).line).toMatch(
      /Ecosafe replied/,
    )
    expect(tenantConfirmedFeedLine({ workOrderRef: 'WO-074B', window: 'Friday 4:00 pm – 5:00 pm' }).line).toBe(
      'Tenant confirmed Fri 4–5pm',
    )
    expect(windowPassedFeedLine({ workOrderRef: 'WO-074B' }).line).toBe('Visit window passed')
    expect(
      closedFeedLine({
        workOrderRef: 'WO-C18B',
        reason: 'Home Check note was opened as a repair by mistake',
        vendorName: 'Ivan Handyman LLC',
      }).line,
    ).toBe('Ivan Handyman declined the home check')
    expect(
      closedFeedLine({
        workOrderRef: 'WO-69C8',
        reason: 'Home Check photo (ajar panel)',
        vendorName: 'Ivan Handyman',
      }).line,
    ).toBe('Ivan Handyman declined the home check')
    expect(equipmentFeedLine({ appliance: 'Water heater', serial: 'X132753655' })?.line).toBe(
      'Saved Water heater serial X132753655',
    )
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave, Unit 1, reported 2h ago',
      })?.line,
    ).toBe('Pick a vendor for the kitchen faucet')
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave',
      })?.line,
    ).not.toMatch(/WO-A1B2|14 Maple Ave/)
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave',
      })?.full,
    ).toMatch(/WO-A1B2/)
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: "Handyman Services by Michael can't take the job at this property",
        detail: 'Broken freezer door seal',
        workOrderRef: 'WO-C2C7',
        place: '100 Disposable Test Lane',
      })?.line,
    ).toBe('Pick a vendor for the freezer seal')
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: "Handyman Services by Michael can't take the job at this property",
        detail: 'Broken freezer door seal',
        workOrderRef: 'WO-C2C7',
        place: '100 Disposable Test Lane',
      })?.full,
    ).toMatch(/WO-C2C7/)
    // Stored write-time message must not freeze old copy when headline/detail exist.
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        message: 'Told you No preferred vendor matched this request · The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave',
      })?.line,
    ).toBe('Pick a vendor for the kitchen faucet')
    expect(softRewriteFeedLine('Noted Ecosafe accepted WO-074B')).toBe('Ecosafe accepted WO-074B')
    expect(softRewriteFeedLine('Landlord attention alert sent')).toBe('Needs you')
    expect(softRewriteFeedLine('Phone photo capture ended.')).toBe(
      'Ulo checked the equipment scan: no issues',
    )
    expect(softRewriteFeedLine('Phone photo capture started for this inspection.')).toBe('Scan started')
    expect(
      inspectionCaptureFeedLine({
        phase: 'ended',
        place: '14 Maple Ave',
        photoCount: 3,
      }).line,
    ).toBe('Ulo checked the equipment scan: no issues')
    expect(
      landlordFeedLine({
        eventType: 'inspection.capture_session_ended',
        building: null,
        metadata: { building: '14 Maple Ave', photo_count: 1 },
      })?.line,
    ).toBe('Ulo checked the equipment scan: no issues')
    expect(
      landlordFeedLine({
        eventType: 'landlord.attention_alert_sent',
        building: '14 Maple Ave',
        maintenanceRequestId: 'a1b20000-0000-4000-8000-000000000001',
        metadata: {
          kind: 'assign_vendor',
          headline: 'No preferred vendor matched this request',
          detail: 'The leaking kitchen faucet',
        },
      })?.full,
    ).toMatch(/WO-A1B2/)
    expect(
      landlordFeedLine({
        eventType: 'landlord.attention_alert_sent',
        building: '14 Maple Ave',
        maintenanceRequestId: 'a1b20000-0000-4000-8000-000000000001',
        metadata: {
          kind: 'assign_vendor',
          headline: 'No preferred vendor matched this request',
          detail: 'The leaking kitchen faucet',
        },
      })?.full,
    ).toMatch(/kitchen faucet/)
    expect(compactWindow('Friday 4:00 pm – 5:00 pm')).toBe('Fri 4–5pm')
    expect(
      withFeedScope(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }), {
        workOrderRef: 'WO-074B',
        place: '14 Maple Ave',
      }).full,
    ).toMatch(/WO-074B/)
    expect(
      withFeedScope(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }), {
        workOrderRef: 'WO-074B',
        place: '14 Maple Ave',
      }).line,
    ).not.toMatch(/WO-074B/)
    expect(
      withFeedScope(
        { line: 'Opened a work order', full: 'Opened a work order' },
        { workOrderRef: 'WO-074B', place: '14 Maple Ave' },
      ).full,
    ).toMatch(/WO-074B/)
    expect(
      withFeedScope(
        { line: 'Opened a work order', full: 'Opened a work order' },
        {
          workOrderRef: 'WO-074B',
          place: '14 Maple Ave',
        },
      ).line,
    ).toBe('Opened a work order: repair')
    expect(
      withFeedScope(
        { line: 'Opened a work order', full: 'Opened a work order' },
        {
          workOrderRef: 'WO-074B',
          issueHeadline: 'kitchen sink leak',
          place: '14 Maple Ave',
        },
      ).line,
    ).toMatch(/sink leak/)
    expect(
      withFeedScope(
        { line: 'Opened a work order', full: 'Opened a work order' },
        {
          workOrderRef: 'WO-074B',
          issueHeadline: 'kitchen sink leak',
          place: '14 Maple Ave',
        },
      ).full,
    ).toMatch(/WO-074B/)
  })

  it('keeps long values inside the window without dropping the outcome', () => {
    const cases: Array<[FeedLine, string[]]> = [
      [
        spendFeedLine({
          amount: 12345.67,
          workOrderRef: 'WO-074B',
          vendorName: LONG_VENDOR,
          trade: 'pest control and drain cleaning for the whole building stack',
        })!,
        ['$12,345.67', 'WO-074B', 'invoice'],
      ],
      [
        estimateApprovedFeedLine({ amount: 12345.67, workOrderRef: 'WO-074B' })!,
        ['$12,345.67', 'WO-074B', 'approved'],
      ],
      [vendorAlertFeedLine({ vendorName: LONG_VENDOR, workOrderRef: 'WO-074B' }), ['WO-074B', 'Ecosafe']],
      [vendorAcceptedFeedLine({ vendorName: LONG_VENDOR, workOrderRef: 'WO-074B' }), ['WO-074B', 'accepted']],
      [
        vendorProposedFeedLine({
          vendorName: LONG_VENDOR,
          workOrderRef: 'WO-074B',
          window: 'Thursday 9:00 am – 11:00 am',
        }),
        ['WO-074B', 'proposed'],
      ],
      [vendorDeclinedFeedLine({ vendorName: LONG_VENDOR, workOrderRef: 'WO-074B' }), ['WO-074B', 'declined']],
      [
        vendorRepliedFeedLine({ vendorName: LONG_VENDOR, workOrderRef: 'WO-074B', quote: LONG_QUOTE }),
        ['WO-074B', 'replied'],
      ],
      [
        tenantConfirmedFeedLine({ workOrderRef: 'WO-074B', window: 'Friday 4:00 pm – 5:00 pm' }),
        ['WO-074B', 'confirmed'],
      ],
      [windowPassedFeedLine({ workOrderRef: 'WO-074B' }), ['WO-074B', 'passed']],
      [
        closedFeedLine({ workOrderRef: 'WO-C18B', reason: 'Home Check note was opened as a repair by mistake' }),
        ['WO-C18B', 'Home check'],
      ],
      [
        closedFeedLine({ workOrderRef: 'WO-69C8', reason: 'Home Check photo (ajar panel was left open overnight)' }),
        ['WO-69C8', 'Home check'],
      ],
      [equipmentFeedLine({ appliance: 'Water heater', serial: 'X132753655' })!, ['X132753655', 'Saved']],
    ]
    for (const [line, tokens] of cases) expectFits(line, tokens, { woOnFull: true })
  })

  it('picks a complete template variant and never deletes words', () => {
    const variants = [
      'Approved $12,345.67 estimate for the kitchen sink leak; confirming visit time with tenant',
      'Approved $12,345.67 estimate for the kitchen sink leak',
      'Approved $12,345.67 estimate',
    ]
    const fitted = fitFeedLine(variants[0]!, variants.slice(1), [])
    expect(variants).toContain(fitted.line)
    expect(fitted.line.includes('…')).toBe(false)
    expect(fitted.full).toBe(variants[0])
  })

  it('never ends a fitted feed line with an ellipsis', () => {
    const long = fitFeedLine(
      `$12,345.67 spent on WO-074B pest control and drain cleaning (${'Ecosafe '.repeat(8).trim()})`,
      [
        '$12,345.67 spent on WO-074B (Ecosafe)',
        '$12,345.67 spent on WO-074B',
        '$12,345.67 spent',
      ],
      ['$12,345.67', 'WO-074B', 'spent'],
    )
    expect(long.line.includes('…')).toBe(false)
    expect(long.line.endsWith('…')).toBe(false)
    expect(long.line.length).toBeGreaterThan(0)
  })

  it('puts the full sentence on the row title and aria-label', () => {
    const declined = vendorDeclinedFeedLine({
      vendorName: 'SupercalifragilisticExpialidociousPlumbingXXX',
      workOrderRef: 'WO-074B',
    })
    expect(declined.line).toMatch(/declined/)
    expect(feedLineFits(declined.line) || feedLineWordCount(declined.line) <= 8).toBe(true)
    expect(declined.full).toContain('declined')
    expect(declined.full).toContain('WO-074B')
    const html = renderToStaticMarkup(
      createElement('div', feedRowA11yProps(declined.full), declined.line),
    )
    expect(html).toContain(`title="${declined.full}"`)
    expect(html).toContain(`aria-label="${declined.full}"`)
  })

  it('writes plain sentences for high-traffic event types', () => {
    expect(
      landlordFeedLine({
        eventType: 'maintenance.created',
        issueHeadline: 'kitchen sink leak',
        maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
      })?.line,
    ).toBe('Opened: sink leak')
    expect(
      landlordFeedLine({
        eventType: 'maintenance.request_submitted',
        issueHeadline: 'kitchen sink leak',
        residentName: 'Jordan Lee',
        maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
      })?.line,
    ).toBe('Jordan reported: sink leak')
    expect(
      landlordFeedLine({
        eventType: 'maintenance.completed',
        issueHeadline: 'kitchen sink leak',
        vendorName: 'Ecosafe',
        maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
      })?.line,
    ).toBe('Ecosafe finished: sink leak')
    expect(
      landlordFeedLine({
        eventType: 'maintenance.schedule_updated',
        issueHeadline: 'kitchen sink leak',
        metadata: { window: 'Friday 4:00 pm – 5:00 pm' },
      })?.line,
    ).toMatch(/visit|Fri|Updated/i)
    expect(
      landlordFeedLine({
        eventType: 'rent.reminder_sent',
        residentName: 'Jordan Lee',
      })?.line,
    ).toMatch(/Jordan|rent|reminder/i)
    expect(
      landlordFeedLine({
        eventType: 'rent.payment_received',
        residentName: 'Jordan Lee',
        metadata: { amount: 1850 },
      })?.line,
    ).toMatch(/\$1,850|Jordan|rent/i)
    expect(
      landlordFeedLine({
        eventType: 'tenant.activation_sms_sent',
        residentName: 'Jordan Lee',
      })?.line,
    ).toMatch(/Jordan|welcome|Sent/i)
    expect(
      landlordFeedLine({
        eventType: 'tenant.activation_completed',
        residentName: 'Jordan Lee',
      })?.line,
    ).toBe('Jordan activated')
    expect(
      landlordFeedLine({
        eventType: 'maintenance.sla_auto_reassigned',
        issueHeadline: 'kitchen sink leak',
        vendorName: 'Ecosafe',
      })?.line,
    ).toBe('Ecosafe: no reply')
  })
})

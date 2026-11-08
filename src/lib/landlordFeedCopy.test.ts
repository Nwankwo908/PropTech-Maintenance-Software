import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  attentionAlertFeedLine,
  compactWindow,
  emergencyCutFeedLine,
  estimateApprovedFeedLine,
  equipmentFeedLine,
  FEED_LINE_MAX_CHARS,
  FEED_LINE_MAX_WORDS,
  feedLineFits,
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

function expectFits(line: FeedLine, tokens: string[]) {
  expect(line.line.length).toBeLessThanOrEqual(FEED_LINE_MAX_CHARS)
  expect(line.line.trim().split(/\s+/).length).toBeLessThanOrEqual(FEED_LINE_MAX_WORDS)
  expect(feedLineFits(line.line)).toBe(true)
  const lower = line.line.toLowerCase()
  for (const token of tokens) expect(lower).toContain(token.toLowerCase())
  expect(line.full.length).toBeGreaterThan(0)
}

describe('landlord feed copy', () => {
  it('uses the short company name', () => {
    expect(shortVendorName('Ecosafe Pest Management LLC')).toBe('Ecosafe')
    expect(shortVendorName('The Plumbing Company')).toBe('The Plumbing')
    expect(shortVendorName('A Plus Drain')).toBe('A Plus')
    expect(shortVendorName('ABC Pest Control')).toBe('ABC Pest')
  })

  it('matches the visible templates', () => {
    expect(spendFeedLine({ amount: 2300, workOrderRef: 'WO-074B', vendorName: 'Ecosafe', trade: 'pest control' })?.line).toBe(
      '$2,300 spent on WO-074B pest control (Ecosafe)',
    )
    expect(estimateApprovedFeedLine({ amount: 2300, workOrderRef: 'WO-074B' })?.line).toBe(
      'Approved $2,300 estimate for WO-074B; confirming visit time with tenant',
    )
    expect(vendorAlertFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe('Sent WO-074B to Ecosafe')
    expect(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe(
      'Ecosafe accepted WO-074B',
    )
    expect(
      vendorAcceptedFeedLine({
        vendorName: 'Ecosafe',
        workOrderRef: 'WO-074B',
        issueHeadline: 'kitchen sink leak',
      }).line,
    ).toBe('Ecosafe accepted the kitchen sink leak')
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
    ).toBe('Sent Ecosafe the kitchen sink leak')
    expect(
      vendorProposedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B', window: 'Thursday 9:00 am – 11:00 am' }).line,
    ).toBe('Ecosafe proposed Thu 9–11am for WO-074B')
    expect(vendorDeclinedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe(
      'Ecosafe declined WO-074B; finding another vendor',
    )
    expect(vendorRepliedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B', quote: 'Can do Friday after 2' }).line).toBe(
      'Ecosafe replied on WO-074B: "Can do Friday after 2"',
    )
    expect(tenantConfirmedFeedLine({ workOrderRef: 'WO-074B', window: 'Friday 4:00 pm – 5:00 pm' }).line).toBe(
      'Confirmed Fri 4–5pm visit with the tenant for WO-074B',
    )
    expect(windowPassedFeedLine({ workOrderRef: 'WO-074B' }).line).toBe(
      'Stopped texts on WO-074B after the visit window passed; no tenant confirmation',
    )
    expect(closedFeedLine({ workOrderRef: 'WO-C18B', reason: 'Home Check note was opened as a repair by mistake' }).line).toBe(
      'Closed WO-C18B: Home Check note, not a repair',
    )
    expect(closedFeedLine({ workOrderRef: 'WO-69C8', reason: 'Home Check photo (ajar panel)' }).line).toBe(
      'Closed WO-69C8: Home Check photo (ajar panel), not a repair',
    )
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
      })?.full,
    ).toBe(
      'Asked you to pick a vendor for the leaking kitchen faucet at 14 Maple Ave (WO-A1B2) — no preferred match',
    )
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave',
      })?.line,
    ).toMatch(/WO-A1B2/)
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave',
      })?.line,
    ).toMatch(/14 Maple Ave/)
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: "Handyman Services by Michael can't take the job at this property",
        workOrderRef: 'WO-C2C7',
        place: '100 Disposable Test Lane',
      })?.full,
    ).toBe(
      "Asked you to pick another vendor — Handyman Services by Michael can't take the job at 100 Disposable Test Lane (WO-C2C7)",
    )
    // Stored write-time message must not freeze old copy when headline/detail exist.
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched this request',
        detail: 'The leaking kitchen faucet',
        message: 'Told you No preferred vendor matched this request · The leaking kitchen faucet',
        workOrderRef: 'WO-A1B2',
        place: '14 Maple Ave',
      })?.full,
    ).toBe(
      'Asked you to pick a vendor for the leaking kitchen faucet at 14 Maple Ave (WO-A1B2) — no preferred match',
    )
    expect(softRewriteFeedLine('Noted Ecosafe accepted WO-074B')).toBe('Ecosafe accepted WO-074B')
    expect(softRewriteFeedLine('Landlord attention alert sent')).toBe('Texted you for a decision')
    expect(softRewriteFeedLine('Phone photo capture ended.')).toBe(
      'Finished phone photo capture for an equipment scan',
    )
    expect(softRewriteFeedLine('Phone photo capture started for this inspection.')).toBe(
      'Started phone photo capture for an equipment scan',
    )
    expect(
      inspectionCaptureFeedLine({
        phase: 'ended',
        place: '14 Maple Ave',
        photoCount: 3,
      }).full,
    ).toBe('Finished phone photo capture for equipment scan at 14 Maple Ave (3 photos)')
    expect(
      landlordFeedLine({
        eventType: 'inspection.capture_session_ended',
        building: null,
        metadata: { building: '14 Maple Ave', photo_count: 1 },
      })?.full,
    ).toBe('Finished phone photo capture for equipment scan at 14 Maple Ave (1 photo)')
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
      })?.line,
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
      })?.line,
    ).toMatch(/14 Maple Ave/)
    expect(compactWindow('Friday 4:00 pm – 5:00 pm')).toBe('Fri 4–5pm')
    expect(
      withFeedScope(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }), {
        workOrderRef: 'WO-074B',
        place: '14 Maple Ave',
      }).line,
    ).toMatch(/WO-074B/)
    expect(
      withFeedScope(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }), {
        workOrderRef: 'WO-074B',
        place: '14 Maple Ave',
      }).line,
    ).toMatch(/14 Maple Ave/)
    expect(
      withFeedScope(
        { line: 'Opened a work order', full: 'Opened a work order' },
        { workOrderRef: 'WO-074B', place: '14 Maple Ave' },
      ).full,
    ).toBe('Opened a work order for WO-074B at 14 Maple Ave')
    expect(
      withFeedScope(
        { line: 'Opened a work order', full: 'Opened a work order' },
        {
          workOrderRef: 'WO-074B',
          issueHeadline: 'kitchen sink leak',
          place: '14 Maple Ave',
        },
      ).line,
    ).toMatch(/kitchen sink leak/)
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
        ['$12,345.67', 'WO-074B', 'spent'],
      ],
      [
        estimateApprovedFeedLine({ amount: 12345.67, workOrderRef: 'WO-074B' })!,
        ['$12,345.67', 'WO-074B', 'Approved'],
      ],
      [vendorAlertFeedLine({ vendorName: LONG_VENDOR, workOrderRef: 'WO-074B' }), ['WO-074B', 'Sent']],
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
        ['WO-C18B', 'closed'],
      ],
      [
        closedFeedLine({ workOrderRef: 'WO-69C8', reason: 'Home Check photo (ajar panel was left open overnight)' }),
        ['WO-69C8', 'closed'],
      ],
      [equipmentFeedLine({ appliance: 'Water heater', serial: 'X132753655' })!, ['X132753655', 'Saved']],
    ]
    for (const [line, tokens] of cases) expectFits(line, tokens)
  })

  it('shortens without ellipsis and keeps the amount, work order, and outcome', () => {
    const source = `$12,345.67 approved for WO-074B ${Array.from({ length: 30 }, (_, index) => `extra${index}`).join(' ')}`
    const line = emergencyCutFeedLine(source, ['$12,345.67', 'WO-074B', 'approved'])
    expect(line.length).toBeLessThanOrEqual(FEED_LINE_MAX_CHARS)
    expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(FEED_LINE_MAX_WORDS)
    expect(line.endsWith('…')).toBe(false)
    expect(line.includes('…')).toBe(false)
    expect(line).toContain('$12,345.67')
    expect(line).toContain('WO-074B')
    expect(line).toContain('approved')
    const sourceWords = new Set(source.split(/\s+/))
    for (const word of line.trim().split(/\s+/)) {
      expect(sourceWords.has(word)).toBe(true)
    }
    expect(line).not.toMatch(/\$12,34(?!5\.67)/)
    expect(line).not.toMatch(/WO-07(?!4B)/)
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
    expect(declined.line).not.toContain('finding another vendor')
    expect(declined.full).toContain('finding another vendor')
    expect(declined.full).toContain('declined')
    expect(declined.full).toContain('WO-074B')
    const html = renderToStaticMarkup(
      createElement('div', feedRowA11yProps(declined.full), declined.line),
    )
    expect(html).toContain(`title="${declined.full}"`)
    expect(html).toContain(`aria-label="${declined.full}"`)
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  compactWindow,
  emergencyCutFeedLine,
  estimateApprovedFeedLine,
  equipmentFeedLine,
  FEED_LINE_MAX_CHARS,
  FEED_LINE_MAX_WORDS,
  feedLineFits,
  feedRowA11yProps,
  shortVendorName,
  spendFeedLine,
  tenantConfirmedFeedLine,
  vendorAcceptedFeedLine,
  vendorAlertFeedLine,
  vendorDeclinedFeedLine,
  vendorProposedFeedLine,
  vendorRepliedFeedLine,
  windowPassedFeedLine,
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
  for (const token of tokens) expect(line.line).toContain(token)
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
      '$2,300 estimate approved for WO-074B; confirming visit time with tenant',
    )
    expect(vendorAlertFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe('Sent WO-074B to Ecosafe')
    expect(vendorAcceptedFeedLine({ vendorName: 'Ecosafe', workOrderRef: 'WO-074B' }).line).toBe('Ecosafe accepted WO-074B')
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
      'Tenant confirmed Fri 4–5pm visit for WO-074B',
    )
    expect(windowPassedFeedLine({ workOrderRef: 'WO-074B' }).line).toBe(
      'WO-074B visit window passed without tenant confirmation; no texts sent',
    )
    expect(closedFeedLine({ workOrderRef: 'WO-C18B', reason: 'Home Check note was opened as a repair by mistake' }).line).toBe(
      'WO-C18B closed: Home Check note, not a repair',
    )
    expect(closedFeedLine({ workOrderRef: 'WO-69C8', reason: 'Home Check photo (ajar panel)' }).line).toBe(
      'WO-69C8 closed: Home Check photo (ajar panel), not a repair',
    )
    expect(equipmentFeedLine({ appliance: 'Water heater', serial: 'X132753655' })?.line).toBe(
      'Water heater serial X132753655 recorded',
    )
    expect(compactWindow('Friday 4:00 pm – 5:00 pm')).toBe('Fri 4–5pm')
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
        ['$12,345.67', 'WO-074B', 'approved'],
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
      [equipmentFeedLine({ appliance: 'Water heater', serial: 'X132753655' })!, ['X132753655', 'recorded']],
    ]
    for (const [line, tokens] of cases) expectFits(line, tokens)
  })

  it('cuts on a word boundary and keeps the amount, work order, and outcome', () => {
    const source = `$12,345.67 approved for WO-074B ${Array.from({ length: 30 }, (_, index) => `extra${index}`).join(' ')}`
    const line = emergencyCutFeedLine(source, ['$12,345.67', 'WO-074B', 'approved'])
    expect(line.length).toBeLessThanOrEqual(FEED_LINE_MAX_CHARS)
    expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(FEED_LINE_MAX_WORDS)
    expect(line.endsWith('…')).toBe(true)
    expect(line).toContain('$12,345.67')
    expect(line).toContain('WO-074B')
    expect(line).toContain('approved')
    const sourceWords = new Set(source.split(/\s+/))
    for (const word of line.slice(0, -1).trim().split(/\s+/)) {
      expect(sourceWords.has(word)).toBe(true)
    }
    expect(line).not.toMatch(/\$12,34(?!5\.67)/)
    expect(line).not.toMatch(/WO-07(?!4B)/)
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

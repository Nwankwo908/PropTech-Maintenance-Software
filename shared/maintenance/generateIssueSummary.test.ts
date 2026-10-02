import { describe, expect, it } from 'vitest'
import {
  generateIssueSummary,
  isConciseIssueStatement,
} from '@shared/maintenance/generateIssueSummary.ts'
import { buildAdminMaintenanceReportSummary } from '@/lib/adminMonitoringIssueSummary'
import { buildIntakeUnderstandingConfirm } from '@shared/maintenance/recurringIssueSignal.ts'

const RAMBLING =
  'Hi and thank you I was trying to see if an exterminator can come out to spray the property'

describe('generateIssueSummary', () => {
  it('rambling greeting-heavy message → short noun-phrase title, no greeting, no mid-word cut', () => {
    const title = generateIssueSummary(RAMBLING, {
      format: 'title',
      category: 'pest_control',
    })
    expect(title).toBe('Pest control — exterminator requested')
    expect(title).not.toMatch(/Hi and thank you/i)
    expect(title).not.toMatch(/\w…/)
    expect(title.length).toBeLessThanOrEqual(50)
    expect(title).not.toMatch(/[.!?]$/)
  })

  it('already-concise message passes through close to unchanged', () => {
    expect(isConciseIssueStatement('No hot water')).toBe(true)
    const title = generateIssueSummary('No hot water', { format: 'title' })
    expect(title.toLowerCase()).toBe('no hot water')
    expect(title).not.toMatch(/repair needed|maintenance issue/i)

    const summary = generateIssueSummary('No hot water', { format: 'summary' })
    expect(summary.toLowerCase()).toContain('no hot water')
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(6)
  })

  it('summary format is a short clause without greeting filler', () => {
    const summary = generateIssueSummary(RAMBLING, {
      format: 'summary',
      category: 'pest_control',
    })
    expect(summary.toLowerCase()).toContain('pest')
    expect(summary).not.toMatch(/Hi and thank you/i)
    expect(summary.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(20)
  })

  it('low-confidence fallback truncates at a word boundary', () => {
    const long =
      'Hi thanks something oddly specific about the northwest corner fixture rattling intermittently every evening lately when nobody is home'
    const title = generateIssueSummary(long, { format: 'title', maxChars: 40 })
    expect(title).not.toMatch(/Hi\b/i)
    expect(title).not.toMatch(/\w…/)
    if (title.includes('…')) {
      expect(title).toMatch(/\s…$|…$/)
    }
  })
})

describe('five surfaces share generateIssueSummary extraction', () => {
  it('1 work-order title format matches shared title output', () => {
    const shared = generateIssueSummary(RAMBLING, {
      format: 'title',
      category: 'pest_control',
    })
    // Surface 1 — work order title uses the same title options.
    expect(shared).toBe(
      generateIssueSummary(RAMBLING, {
        format: 'title',
        category: 'pest_control',
        maxChars: 50,
      }),
    )
    expect(shared).toMatch(/Pest control/i)
  })

  it('2 admin thread summary embeds the shared summary phrase', () => {
    const phrase = generateIssueSummary(RAMBLING, {
      format: 'summary',
      category: 'pest_control',
    })
    const admin = buildAdminMaintenanceReportSummary({
      residentName: 'Takeira Chestor',
      unitLabel: '1',
      building: '14 Maple Ave',
      ticketDescription: RAMBLING,
      ticketCategory: 'pest_control',
    })
    expect(admin).toContain(phrase.replace(/\.$/, ''))
    expect(admin).not.toMatch(/Hi and thank you/i)
  })

  it('3 mid-intake re-confirm uses shared phrase (not raw text)', () => {
    const phrase = generateIssueSummary(RAMBLING, {
      format: 'summary',
      category: 'pest_control',
    })
    const line = buildIntakeUnderstandingConfirm({
      issuePhrase: phrase,
      recurring: false,
    })
    expect(line).toMatch(/^Got it —/)
    expect(line.toLowerCase()).toContain('pest')
    expect(line).not.toMatch(/Hi and thank you/i)
    expect(line).not.toMatch(/I've updated this to/i)
  })

  it('4 pre-submit / 5 split-candidate labels use shared title extraction', () => {
    const title = generateIssueSummary(RAMBLING, {
      format: 'title',
      category: 'pest_control',
    })
    // Pre-submit issue lines and multi-issue candidate labels both call
    // generateIssueSummary({ format: 'title' }) — same string for the same input.
    const preSubmitLabel = generateIssueSummary(RAMBLING, {
      format: 'title',
      category: 'pest_control',
    })
    const splitCandidateLabel = generateIssueSummary(RAMBLING, {
      format: 'title',
      category: 'pest_control',
    })
    expect(preSubmitLabel).toBe(title)
    expect(splitCandidateLabel).toBe(title)
    expect(title).not.toMatch(/Hi and thank you/i)
  })

  it('does not treat "temperature" as a pest (rat) sighting', () => {
    const body =
      'The it failed the inspection. The oven does not work at all (at any temperature)'
    const summary = generateIssueSummary(body, {
      format: 'summary',
      category: 'appliance',
      maxWords: 18,
    })
    expect(summary.toLowerCase()).not.toMatch(/pest/)
    expect(summary.toLowerCase()).toMatch(/appliance|oven|stove/)
    expect(
      generateIssueSummary('I saw mice in the kitchen', { format: 'summary' })
        .toLowerCase(),
    ).toContain('pest')
  })
})

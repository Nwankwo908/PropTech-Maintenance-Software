import { describe, expect, it } from 'vitest'
import {
  appendClarificationToDescription,
  buildSummaryClarificationSms,
  buildWhichRepairQuestion,
  clarificationFieldFromNeeds,
  parseClarificationAnswer,
  readAwaitingSummaryClarification,
} from './summaryClarification.ts'

describe('summaryClarification', () => {
  it('maps needsClarification to fields', () => {
    expect(clarificationFieldFromNeeds('Where is the baseboard heater located?')).toBe(
      'physical_location',
    )
    expect(clarificationFieldFromNeeds('Which room should we send the technician to?')).toBe(
      'physical_location',
    )
    expect(clarificationFieldFromNeeds('Which repair are you updating?')).toBe('which_repair')
  })

  it('parses location answers', () => {
    expect(parseClarificationAnswer('physical_location', 'In the basement')).toBe('Basement')
    expect(parseClarificationAnswer('physical_location', 'kitchen')).toBe('Kitchen')
    expect(parseClarificationAnswer('physical_location', '???')).toBeNull()
  })

  it('parses which-repair number replies', () => {
    const pending = {
      ticketId: 'a',
      field: 'which_repair' as const,
      question: 'Which?',
      askedAt: new Date().toISOString(),
      candidates: [
        { ticketId: 't1', label: 'Baseboard heater leak' },
        { ticketId: 't2', label: 'Kitchen sink leak' },
      ],
    }
    expect(parseClarificationAnswer('which_repair', '2', pending)).toBe('t2')
    expect(parseClarificationAnswer('which_repair', '9', pending)).toBeNull()
  })

  it('appends Affected area without dropping prior description', () => {
    const next = appendClarificationToDescription(
      'The tenant reports a leak from the baseboard heater.\nEquipment: Baseboard heater',
      'physical_location',
      'Basement',
    )
    expect(next).toMatch(/Affected area: Basement/)
    expect(next).toMatch(/Equipment: Baseboard heater/)
    expect(next).toMatch(/Tenant update: In the basement/)
  })

  it('builds a short SMS question', () => {
    expect(buildSummaryClarificationSms('Where is the baseboard heater located')).toMatch(/\?$/)
    expect(buildWhichRepairQuestion([
      { ticketId: '1', label: 'Leak' },
      { ticketId: '2', label: 'Outlet' },
    ])).toMatch(/Reply with the number/)
  })

  it('reads pending clarification from intake_state', () => {
    const pending = readAwaitingSummaryClarification({
      awaiting_summary_clarification: {
        ticketId: 'abc',
        field: 'physical_location',
        question: 'Where is it?',
        askedAt: '2026-11-05T00:00:00Z',
      },
    })
    expect(pending?.ticketId).toBe('abc')
    expect(pending?.field).toBe('physical_location')
  })
})

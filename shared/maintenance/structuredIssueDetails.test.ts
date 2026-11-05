import { describe, expect, it } from 'vitest'
import { generateIssueSummary } from '@shared/maintenance/generateIssueSummary.ts'
import {
  extractStructuredIssueDetails,
  parseIntakeDescriptionParts,
} from '@shared/maintenance/structuredIssueDetails.ts'
import { humanizeVendorJobDescription } from '@/lib/vendorJobNextStep'

/**
 * Exact failure-mode transcript: opening greeting + spray ask, recurring update,
 * tunneling detail buried in a second Tenant update, and Resident availability
 * wrongly populated with a verbatim copy of the opening message.
 *
 * DATA-MODEL GAP: `sms_messages` stores each inbound as its own row, but intake
 * still concatenates answers into `maintenance_requests.description`. That
 * merge is why summarization must re-split "Tenant update:" fragments here.
 */
export const CONCATENATED_PEST_TUNNEL_TRANSCRIPT = [
  'Hi and thank you I was trying to see if an exterminator can come out to spray the property',
  "Tenant update: Repeatedly this isn't the first time someone came out before.",
  'Tenant update: There is tunneling near the foundation by the back porch',
  'Resident availability: Hi and thank you I was trying to see if an exterminator can come out to spray the property',
].join('\n')

describe('structuredIssueDetails — concatenated Tenant update transcript', () => {
  it('splits opening, updates, and labeled fields', () => {
    const parts = parseIntakeDescriptionParts(CONCATENATED_PEST_TUNNEL_TRANSCRIPT)
    expect(parts.openingMessage).toMatch(/exterminator/i)
    expect(parts.openingMessage).not.toMatch(/Tenant update/i)
    expect(parts.tenantUpdates.length).toBe(2)
    expect(parts.tenantUpdates[0]).toMatch(/Repeatedly/i)
    expect(parts.tenantUpdates[1]).toMatch(/tunneling/i)
    expect(parts.labeledFields['Resident availability']).toMatch(/Hi and thank you/i)
  })

  it('surfaces pest title, recurring, tunneling flag; omits fake availability', () => {
    const details = extractStructuredIssueDetails(CONCATENATED_PEST_TUNNEL_TRANSCRIPT, {
      category: 'pest_control',
      format: 'title',
    })

    expect(details.issue.toLowerCase()).toMatch(/pest control/)
    expect(details.recurring).toBe(true)
    expect(details.locationDetail?.toLowerCase()).toMatch(/foundation|back porch/)
    expect(details.triageFlags.length).toBeGreaterThanOrEqual(1)
    expect(details.triageFlags.some((f) => /tunnel/i.test(f))).toBe(true)
    expect(details.triageFlags.some((f) => /termite|burrowing|spray-only/i.test(f))).toBe(
      true,
    )
    // Distinct flagged item — not only folded into the issue noun-phrase.
    expect(details.issue.toLowerCase()).not.toMatch(/tunnel/)
    expect(details.displayDescription).toMatch(/^Flag: /m)
    expect(details.displayDescription).toMatch(/tunnel/i)
    expect(details.availability).toBeNull()
    expect(details.displayDescription).not.toMatch(
      /Resident availability:\s*Hi and thank you/i,
    )
    expect(details.displayDescription).not.toMatch(/Tenant update:/i)
  })

  it('generateIssueSummary title ignores updates and fake availability', () => {
    const title = generateIssueSummary(CONCATENATED_PEST_TUNNEL_TRANSCRIPT, {
      format: 'title',
      category: 'pest_control',
    })
    expect(title).toBe('Pest control — exterminator requested')
    expect(title).not.toMatch(/tunnel|Hi and thank you|availability/i)
  })

  it('vendor job humanize uses structured fields (no fake availability)', () => {
    const humanized = humanizeVendorJobDescription({
      description: CONCATENATED_PEST_TUNNEL_TRANSCRIPT,
      issueHeadline: '',
    })
    expect(humanized.title.toLowerCase()).toMatch(/pest control/)
    expect(humanized.recurring).toBe(true)
    expect(humanized.triageFlags?.some((f) => /tunnel/i.test(f))).toBe(true)
    expect(humanized.availability).toBeNull()
    expect(humanized.residentReport).not.toMatch(
      /Resident availability:\s*Hi and thank you/i,
    )
  })
})

const GANAIA_BASEBOARD_TRANSCRIPT = [
  'Good morning. There is a leak in the baseboard heater for the first floor. The entire valve is rusted out and may need to be replaced.',
  '',
  'The leak is in the baseboard heater for the first floor. In the basement',
].join('\n')

describe('structuredIssueDetails — baseboard heater leak (no trade-label collapse)', () => {
  it('titles the specific issue; location is basement only; serves floor stays separate', () => {
    const details = extractStructuredIssueDetails(GANAIA_BASEBOARD_TRANSCRIPT, {
      category: 'hvac',
      format: 'title',
    })
    expect(details.issue).toBe('Baseboard heater leak')
    expect(details.issue.toLowerCase()).not.toMatch(/^plumbing (leak|issue)$/)
    expect(details.locationDetail).toBe('Basement')
    expect(details.servesFloor?.toLowerCase()).toMatch(/first floor/)
    expect(details.equipment?.toLowerCase()).toMatch(/baseboard/)
    expect(details.reportedDetail).toMatch(/tenant reports/i)
    expect(details.reportedDetail).toMatch(/rusted/i)
    expect(details.reportedDetail).toMatch(/valve/i)
    expect(details.reportedDetail).not.toMatch(/Good morning/i)
    expect(details.displayDescription).toMatch(/^Baseboard heater leak/m)
    expect(details.displayDescription).toMatch(/^Location: Basement$/m)
    expect(details.displayDescription).toMatch(/Serves: First floor/i)
  })

  it('does not pull in an unrelated bathroom sink message', () => {
    const details = extractStructuredIssueDetails(GANAIA_BASEBOARD_TRANSCRIPT, {
      category: 'plumbing',
    })
    expect(details.displayDescription).not.toMatch(/bathroom sink/i)
    expect(details.reportedDetail).not.toMatch(/bathroom sink/i)
  })
})

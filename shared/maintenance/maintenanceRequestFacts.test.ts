import { describe, expect, it } from 'vitest'
import {
  extractMaintenanceRequestFacts,
  formatPersistedDescription,
  formatSummaryForSurface,
  summarizeMaintenanceRequestDeterministic,
  validateSummaryAgainstFacts,
} from './maintenanceRequestFacts.ts'

const GANAIA_RAW = [
  'Good morning. There is a leak in the baseboard heater for the first floor. The entire valve is rusted out and may need to be replaced.',
  '',
  'The leak is in the baseboard heater for the first floor. In the basement',
].join('\n')

const GANAIA_WITH_ULO = [
  GANAIA_RAW,
  '',
  'Could you text us the leak details again (where it is and what you’re seeing)?',
  'Please add a photo of the baseboard heater leak in the basement and reply here',
].join('\n')

describe('maintenanceRequestFacts — Ganaia baseboard', () => {
  it('separates basement location from first floor served', () => {
    const facts = extractMaintenanceRequestFacts(GANAIA_RAW)
    expect(facts.equipment?.toLowerCase()).toMatch(/baseboard/)
    expect(facts.physicalLocation).toBe('Basement')
    expect(facts.servesFloor?.toLowerCase()).toMatch(/first floor/)
    expect(facts.symptoms).toContain('leak')
    expect(facts.reportedCondition).toMatch(/valve/i)
    expect(facts.authoredText).not.toMatch(/Good morning/i)
  })

  it('builds the required display wording via deterministic summary', () => {
    const summary = summarizeMaintenanceRequestDeterministic(GANAIA_RAW, {
      category: 'plumbing',
    })
    expect(summary.title).toBe('Baseboard heater leak')
    expect(summary.location).toBe('Basement')
    expect(summary.description).toBe(
      'The tenant reports a leak from the basement baseboard heater serving the first floor. The valve is heavily rusted and may need replacement.',
    )
  })

  it('ignores Ulo prompts and examples as resident facts', () => {
    const facts = extractMaintenanceRequestFacts(GANAIA_WITH_ULO)
    expect(facts.authoredText).not.toMatch(/Could you text/i)
    expect(facts.authoredText).not.toMatch(/Please add a photo/i)
    expect(facts.physicalLocation).toBe('Basement')
  })

  it('persists separable labeled fields', () => {
    const summary = summarizeMaintenanceRequestDeterministic(GANAIA_RAW)
    const persisted = formatPersistedDescription(summary)
    expect(persisted).toMatch(/^The tenant reports/m)
    expect(persisted).toMatch(/^Affected area: Basement$/m)
    expect(persisted).toMatch(/^Equipment: Baseboard heater$/im)
    expect(persisted).toMatch(/^Serves floor: First floor$/im)
  })
})

describe('maintenanceRequestFacts — edge cases', () => {
  it('dedupes repeated descriptions and greetings', () => {
    const raw = [
      'Good morning. Kitchen sink is leaking under the cabinet.',
      'Tenant update: Kitchen sink is leaking under the cabinet.',
      'Good morning',
    ].join('\n')
    const summary = summarizeMaintenanceRequestDeterministic(raw, {
      category: 'plumbing',
    })
    expect(summary.title.toLowerCase()).toMatch(/kitchen sink|sink/)
    expect(summary.description.toLowerCase()).toMatch(/leak/)
    expect(summary.description).not.toMatch(/Good morning/i)
    const leakCount = (summary.description.match(/leak/gi) ?? []).length
    expect(leakCount).toBeLessThanOrEqual(2)
  })

  it('applies follow-up location corrections without losing equipment', () => {
    const raw = [
      'There is a leak in the baseboard heater for the first floor.',
      'The leak is in the baseboard heater for the first floor. In the basement',
    ].join('\n')
    const facts = extractMaintenanceRequestFacts(raw)
    expect(facts.physicalLocation).toBe('Basement')
    expect(facts.servesFloor?.toLowerCase()).toMatch(/first floor/)
    expect(facts.equipment?.toLowerCase()).toMatch(/baseboard/)
  })

  it('asks clarification when rooms conflict', () => {
    const facts = extractMaintenanceRequestFacts(
      'The kitchen sink is leaking.\nTenant update: Actually it is the bathroom sink leaking.',
    )
    expect(facts.needsClarification).toMatch(/which room/i)
  })

  it('asks for location when equipment is known but place is missing', () => {
    const facts = extractMaintenanceRequestFacts(
      'My baseboard heater is leaking and the valve looks bad.',
    )
    expect(facts.equipment?.toLowerCase()).toMatch(/baseboard/)
    expect(facts.physicalLocation).toBeNull()
    expect(facts.needsClarification).toMatch(/where is the baseboard/i)
  })

  it('never accepts a generic trade-label title from AI', () => {
    const facts = extractMaintenanceRequestFacts(GANAIA_RAW)
    const rejected = validateSummaryAgainstFacts(
      {
        title: 'Plumbing issue',
        location: 'Basement',
        description: 'Plumbing issue in the unit.',
      },
      facts,
    )
    expect(rejected.ok).toBe(false)
  })

  it('rejects AI that mixes serves-floor into location', () => {
    const facts = extractMaintenanceRequestFacts(GANAIA_RAW)
    const rejected = validateSummaryAgainstFacts(
      {
        title: 'Baseboard heater leak',
        location: 'Basement — first floor',
        description:
          'The tenant reports a leak from the basement baseboard heater serving the first floor. The valve is heavily rusted and may need replacement.',
      },
      facts,
    )
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.reason).toMatch(/location_mixed|location_mismatch/)
  })

  it('accepts valid AI wording matching facts', () => {
    const facts = extractMaintenanceRequestFacts(GANAIA_RAW)
    const ok = validateSummaryAgainstFacts(
      {
        title: 'Baseboard heater leak',
        location: 'Basement',
        description:
          'The tenant reports a leak from the basement baseboard heater serving the first floor. The valve is heavily rusted and may need replacement.',
      },
      facts,
    )
    expect(ok.ok).toBe(true)
  })

  it('rejects unattributed diagnosis language', () => {
    const facts = extractMaintenanceRequestFacts(GANAIA_RAW)
    const rejected = validateSummaryAgainstFacts(
      {
        title: 'Baseboard heater leak',
        location: 'Basement',
        description:
          'There is a leak from the basement baseboard heater. The valve requires replacement.',
      },
      facts,
    )
    expect(rejected.ok).toBe(false)
  })

  it('adapts length per surface without changing meaning', () => {
    const summary = summarizeMaintenanceRequestDeterministic(GANAIA_RAW)
    const card = formatSummaryForSurface(summary, 'active_tasks')
    const detail = formatSummaryForSurface(summary, 'work_order')
    expect(card.title).toBe(detail.title)
    expect(card.location).toBe('Basement')
    expect(card.description.length).toBeLessThanOrEqual(detail.description.length)
    expect(detail.description).toMatch(/valve/i)
  })
})

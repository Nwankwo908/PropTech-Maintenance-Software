import { describe, expect, it } from 'vitest'
import { summarizeWorkOrderCardBlurb } from './workOrderCardSummary'

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

describe('summarizeWorkOrderCardBlurb', () => {
  it('uses a short friendly phrase for common repairs', () => {
    expect(summarizeWorkOrderCardBlurb('Kitchen sink is leaking under the cabinet', 'plumbing')).toBe(
      'Kitchen sink leaking',
    )
    expect(summarizeWorkOrderCardBlurb('Bedroom outlet sparking when I plug in', 'electrical')).toBe(
      'Outlet is sparking',
    )
    expect(summarizeWorkOrderCardBlurb('AC not cooling at all today', 'hvac')).toBe('AC not cooling')
  })

  it('stays between 3 and 5 words', () => {
    const long = summarizeWorkOrderCardBlurb(
      'Hi please can you send someone to come fix the dripping faucet in the hall bathroom as soon as you can thanks',
      'plumbing',
    )
    expect(wordCount(long)).toBeGreaterThanOrEqual(3)
    expect(wordCount(long)).toBeLessThanOrEqual(5)
  })

  it('falls back to the trade when the ticket is a status question', () => {
    expect(summarizeWorkOrderCardBlurb('Who is coming to fix my electrical issue?', 'electrical')).toBe(
      'Electrical Repair Needed',
    )
  })

  it('does not turn a Home Check observation into a plumbing repair title', () => {
    expect(summarizeWorkOrderCardBlurb(
      'Home Check: four photos of the water heater and furnace or boiler. Observation only; no repairs or paid work authorized.',
      'general',
    )).toBe('Home Check')
    expect(summarizeWorkOrderCardBlurb(
      'Home Check follow-up. A photo showed a gas smell.',
      'home_check_warning',
    )).toBe('Home Check follow-up')
  })

  it('falls back when there is no description', () => {
    expect(summarizeWorkOrderCardBlurb(null, 'plumbing')).toBe('Plumbing Repair Needed')
    expect(summarizeWorkOrderCardBlurb('', null)).toBe('Maintenance Repair Needed')
  })
})

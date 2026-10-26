import { describe, expect, it } from 'vitest'
import {
  SELF_FIX_TIPS,
  classifySelfFixReply,
  findSelfFixTip,
  landlordFixedTenantSms,
  selfFixApprovalLine,
  selfFixCopyWithinLimit,
  shouldOfferSelfFix,
  summarizeSelfFixSavings,
  tenantSelfFixActivityMessage,
  type SelfFixTicket,
} from './selfFixTips'

function offer(text: string, extra: Partial<SelfFixTicket> = {}) {
  return shouldOfferSelfFix({ text, ...extra })?.id ?? null
}

describe('self-fix tip library', () => {
  it('matches each tip to its intended issue', () => {
    expect(offer('The kitchen outlets are dead')).toBe('gfci_reset')
    expect(offer('Power is out in the bedroom only')).toBe('breaker_reset')
    expect(offer('The disposal is humming and will not run')).toBe('disposal_reset')
    expect(offer('The toilet is clogged but not overflowing')).toBe('toilet_clog')
    expect(offer('The toilet keeps running')).toBe('toilet_running')
    expect(offer('No heat and the thermostat looks off', { outdoorTempF: 70 })).toBe('thermostat_check')
    expect(offer('Weak airflow from the vent')).toBe('hvac_filter')
    expect(offer('The smoke detector is chirping')).toBe('smoke_chirp')
    expect(offer('The dishwasher is not draining')).toBe('dishwasher_drain')
    expect(offer('The sink has a slow drain')).toBe('sink_slow_drain')
    expect(offer('The fridge is warm and not cooling')).toBe('fridge_not_cooling')
    expect(offer("The washer won't start")).toBe('washer_wont_start')
  })

  it('offers no tip for blocked emergencies and unsafe work', () => {
    expect(offer('I smell gas in the kitchen')).toBeNull()
    expect(offer('The outlet is shooting sparks')).toBeNull()
    expect(offer('Water is flooding the hallway')).toBeNull()
    expect(offer('No heat in the apartment', { outdoorTempF: 20 })).toBeNull()
    expect(offer('The water heater is leaking underneath')).toBeNull()
    expect(offer('Sewage is coming up in the tub')).toBeNull()
    expect(offer('I need a ladder to reach the roof leak')).toBeNull()
    expect(offer('There is a wiring problem in the panel')).toBeNull()
    expect(offer('I already poured a chemical drain cleaner in the sink')).toBeNull()
  })

  it('does not offer a tip twice, when they cannot try, or when tips are off', () => {
    expect(offer('The kitchen outlets are dead', {
      diagnosticFacts: { self_fix_tried: 'gfci_reset' },
    })).toBeNull()
    expect(offer("I'm elderly and this is unsafe. The kitchen outlets are dead")).toBeNull()
    expect(offer('The kitchen outlets are dead', { tipsEnabled: false })).toBeNull()
    expect(offer('The kitchen outlets are dead', { origin: 'home_check' })).toBeNull()
    expect(offer('The kitchen outlets are dead', { origin: 'inspection' })).toBeNull()
    expect(offer('The kitchen outlets are dead', { observationOnly: true })).toBeNull()
  })

  it('classifies tenant replies', () => {
    expect(classifySelfFixReply('it works')).toBe('fixed')
    expect(classifySelfFixReply('fixed')).toBe('fixed')
    expect(classifySelfFixReply('power came back')).toBe('fixed')
    expect(classifySelfFixReply("didn't work")).toBe('not_fixed')
    expect(classifySelfFixReply('still out')).toBe('not_fixed')
    expect(classifySelfFixReply('no')).toBe('not_fixed')
    expect(classifySelfFixReply('not fixed')).toBe('not_fixed')
    expect(classifySelfFixReply("I can't")).toBe('skipped')
    expect(classifySelfFixReply("don't know")).toBe('skipped')
    expect(classifySelfFixReply('')).toBe('skipped')
  })

  it('builds landlord lines and keeps copy inside the limit', () => {
    expect(selfFixCopyWithinLimit()).toBe(true)
    const tried = selfFixApprovalLine({
      text: 'The kitchen outlets are dead',
      hasTenant: true,
      diagnosticFacts: { self_fix_tip: 'gfci_reset', self_fix_result: 'not_fixed' },
    })
    expect(tried).toBe('Tenant already tried the GFCI reset — still out.')
    const vacant = selfFixApprovalLine({
      text: 'The kitchen outlets are dead',
      hasTenant: false,
    })
    expect(vacant).toMatch(/^Quick check/)
    expect(vacant).toMatch(/Reply FIXED/)
    expect(selfFixApprovalLine({
      text: 'The kitchen outlets are dead',
      diagnosticFacts: { self_fix_result: 'fixed', self_fix_tip: 'gfci_reset' },
    })).toBeNull()
    expect(tenantSelfFixActivityMessage(SELF_FIX_TIPS[0]!)).toBe(
      'Tenant fixed it with a GFCI reset — no vendor needed.',
    )
    expect(landlordFixedTenantSms('kitchen outlets')).toBe(
      "Your landlord says the kitchen outlets is fixed. Text me if it's still a problem.",
    )
  })

  it('does not mention gas, wiring, ladders, or chemicals', () => {
    const banned = /\b(gas|wiring|ladders?|chemicals?)\b/i
    for (const tip of SELF_FIX_TIPS) {
      const blob = [tip.tenantAsk, tip.landlordLine, tip.label, ...tip.steps].join(' ')
      expect(blob).not.toMatch(banned)
      expect(tip.landlordLine.length).toBeLessThanOrEqual(90)
    }
  })

  it('counts self-fix savings from the job estimate', () => {
    expect(summarizeSelfFixSavings([
      { resolution: 'tenant_self_fix', estimate: 80 },
      { resolution: 'landlord_self_fix', estimate: 40 },
      { resolution: 'vendor', estimate: 200 },
    ])).toEqual({ count: 2, costAvoided: 120 })
  })

  it('still names the tip after a failed try', () => {
    expect(findSelfFixTip({
      text: 'The kitchen outlets are dead',
      diagnosticFacts: { self_fix_tried: 'gfci_reset', self_fix_result: 'not_fixed' },
    })?.id).toBe('gfci_reset')
  })
})

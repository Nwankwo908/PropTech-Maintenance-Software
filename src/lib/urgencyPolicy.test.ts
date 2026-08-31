import { describe, expect, it } from 'vitest'
import {
  descriptionNeedsOutdoorTemp,
  parseDurationHours,
  resolveUrgencyPolicy,
  URGENCY_SLA_MINUTES,
} from '@shared/maintenance/urgencyPolicy.ts'
import { getEstimatedMinutes } from '@shared/maintenance/slaRules.ts'

describe('resolveUrgencyPolicy', () => {
  it('treats gas as emergency and asks the resident to leave', () => {
    const r = resolveUrgencyPolicy({ text: 'I smell gas in the kitchen' })
    expect(r.band).toBe('emergency')
    expect(r.leaveImmediately).toBe(true)
    expect(r.slaMinutes).toBe(URGENCY_SLA_MINUTES.emergencyLifeSafety)
    expect(r.smsUrgency).toBe('emergency')
  })

  it('treats rotten-egg sulfur smell as gas emergency, not fridge or stove smell', () => {
    expect(resolveUrgencyPolicy({ text: 'It smells like rotten eggs.' }).band).toBe(
      'emergency',
    )
    expect(resolveUrgencyPolicy({ text: 'I think there is a gas leak.' }).leaveImmediately).toBe(
      true,
    )
    expect(resolveUrgencyPolicy({ text: 'My refrigerator smells bad.' }).band).not.toBe(
      'emergency',
    )
    expect(resolveUrgencyPolicy({ text: "My gas stove won't ignite." }).leaveImmediately).toBe(
      false,
    )
  })

  it('treats sparking outlets as emergency', () => {
    const r = resolveUrgencyPolicy({ text: 'Outlet sparks' })
    expect(r.band).toBe('emergency')
    expect(r.severity).toBe('critical')
  })

  it('uses outdoor temperature for no heat and no cooling', () => {
    expect(resolveUrgencyPolicy({ text: 'No heat', outdoorTempF: 40 }).band).toBe(
      'emergency',
    )
    expect(resolveUrgencyPolicy({ text: 'No heat', outdoorTempF: 70 }).band).toBe(
      'medium',
    )
    expect(resolveUrgencyPolicy({ text: 'No heat' }).band).toBe('emergency')
    expect(
      resolveUrgencyPolicy({ text: 'AC not working', outdoorTempF: 90 }).band,
    ).toBe('emergency')
    expect(
      resolveUrgencyPolicy({ text: 'AC not working', outdoorTempF: 72 }).band,
    ).toBe('medium')
  })

  it('escalates no hot water after 24 hours', () => {
    expect(
      resolveUrgencyPolicy({ text: 'No hot water since this morning' }).band,
    ).toBe('medium')
    expect(
      resolveUrgencyPolicy({
        text: 'No hot water',
        durationHours: 30,
      }).band,
    ).toBe('emergency')
    expect(parseDurationHours('no hot water for 2 days')).toBe(48)
  })

  it('keeps dripping faucets at 48 hours and slow drains at 7 days', () => {
    const faucet = resolveUrgencyPolicy({ text: 'Leaky faucet' })
    expect(faucet.band).toBe('medium')
    expect(faucet.slaMinutes).toBe(URGENCY_SLA_MINUTES.medium)
    const drain = resolveUrgencyPolicy({ text: 'Slow drain in the bathroom' })
    expect(drain.band).toBe('low')
    expect(drain.slaMinutes).toBe(URGENCY_SLA_MINUTES.low)
  })

  it('schedules a single pest sighting in 7 days', () => {
    expect(resolveUrgencyPolicy({ text: 'I saw a mouse in the kitchen' }).band).toBe(
      'low',
    )
    expect(
      resolveUrgencyPolicy({ text: 'Roach infestation everywhere' }).band,
    ).toBe('medium')
  })

  it('treats broken exterior locks and whole-unit power loss as emergency', () => {
    expect(
      resolveUrgencyPolicy({ text: 'The front door lock is broken' }).band,
    ).toBe('emergency')
    expect(
      resolveUrgencyPolicy({ text: 'No power to the entire unit' }).band,
    ).toBe('emergency')
  })

  it('only looks up outdoor temperature for heat and cooling', () => {
    expect(descriptionNeedsOutdoorTemp('No heat')).toBe(true)
    expect(descriptionNeedsOutdoorTemp('AC not working')).toBe(true)
    expect(descriptionNeedsOutdoorTemp('Leaky faucet')).toBe(false)
  })
})

describe('getEstimatedMinutes', () => {
  it('uses the urgency policy when a description is provided', () => {
    expect(
      getEstimatedMinutes('plumbing', 'normal', null, { description: 'Leaky faucet' }),
    ).toBe(URGENCY_SLA_MINUTES.medium)
    expect(
      getEstimatedMinutes('electrical', 'normal', null, {
        description: 'Outlet sparks',
      }),
    ).toBe(URGENCY_SLA_MINUTES.emergencyLifeSafety)
    expect(
      getEstimatedMinutes('pest_control', 'normal', null, {
        description: 'I saw one ant',
      }),
    ).toBe(URGENCY_SLA_MINUTES.low)
    expect(
      getEstimatedMinutes('hvac', 'urgent', null, {
        description: 'No heat',
        outdoorTempF: 70,
      }),
    ).toBe(URGENCY_SLA_MINUTES.medium)
    expect(
      getEstimatedMinutes('hvac', 'urgent', null, {
        description: 'No heat',
        outdoorTempF: 40,
      }),
    ).toBe(URGENCY_SLA_MINUTES.emergencySameDay)
  })
})

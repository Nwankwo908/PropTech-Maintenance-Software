import { describe, expect, it } from 'vitest'
import {
  buildPmTaskCardCopy,
  failureSignalsFromCondition,
  formatPmDueHeadline,
  knownAssetAgeYears,
  naturalPmTaskTitle,
  persistableAssetAgeYears,
} from './taskCard'

const panelTask = {
  title: 'Inspect / service Main Panel',
  kind: 'appliance',
  location: '563 Springdale Circle',
  dueAt: '2027-09-16T12:00:00.000Z',
  status: 'scheduled',
  estimatedAgeYears: 0,
  ageBasis: 'ai_estimated',
  usefulLifeYears: 25,
  failureRiskPct: 15,
  failurePredictionWindow: '2–5 years',
  replacementRecommended: false,
  conditionRating: 'good',
  applianceType: 'Main Panel',
  registryAssetType: 'electrical_panel',
}

describe('PM task card copy', () => {
  it('never treats age 0 as this year', () => {
    expect(knownAssetAgeYears(0)).toBeNull()
    expect(knownAssetAgeYears(null)).toBeNull()
    expect(persistableAssetAgeYears(null)).toBeNull()
    expect(persistableAssetAgeYears(0)).toBeNull()
  })

  it('uses a natural title and hides false-precision risk when age is unknown', () => {
    const copy = buildPmTaskCardCopy(panelTask, new Date('2026-09-16T12:00:00.000Z'))
    expect(copy.title).toBe('Electrical Panel Inspection')
    expect(copy.ageLabel).toBe('Unknown')
    expect(copy.failureRiskLabel).toBe('Not enough information')
    expect(copy.askInstallYear).toBe(true)
    expect(copy.statusLabel).toBe('Routine maintenance')
    expect(copy.instruction).toMatch(/main electrical panel/i)
    expect(copy.summary).toMatch(/age is unknown/i)
    expect(copy.summary).not.toMatch(/0 yr/)
    expect(copy.why).toMatch(/installation age couldn't be confirmed/i)
  })

  it('formats due as a calendar date plus relative context', () => {
    const due = formatPmDueHeadline(
      '2027-09-16T12:00:00.000Z',
      'scheduled',
      new Date('2026-09-16T12:00:00.000Z'),
    )
    expect(due.headline).toMatch(/^Due Sep 16, 2027 · in 12 months$/)
  })

  it('graduates to a qualitative risk band when age is known', () => {
    const copy = buildPmTaskCardCopy(
      { ...panelTask, estimatedAgeYears: 15, failureRiskPct: 15, failurePredictionWindow: '2–5 years' },
      new Date('2026-09-16T12:00:00.000Z'),
    )
    expect(copy.ageLabel).toBe('15 years')
    expect(copy.failureRiskLabel).toBe('Low failure risk · next 2–5 years')
    expect(copy.askInstallYear).toBe(false)
  })

  it('computes panel failure risk from age 15 vs ~30 year life without a confidence floor', () => {
    expect(persistableAssetAgeYears(15)).toBe(15)
    expect(
      failureSignalsFromCondition({
        rating: 'good',
        ageYears: 15,
        lifeYears: 30,
      }),
    ).toEqual({
      risk: 15,
      window: '2–5 years',
      replace: false,
      urgency: 'monitor',
    })
  })

  it('rewrites inspect/service titles', () => {
    expect(
      naturalPmTaskTitle({
        title: 'Inspect / service Main Panel',
        registryAssetType: 'electrical_panel',
        applianceType: 'Main Panel',
      }),
    ).toBe('Electrical Panel Inspection')
  })
})

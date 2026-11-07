import { describe, expect, it } from 'vitest'
import {
  homeCheckManufactureCorrectionHelp,
  isHomeCheckResultsAwaitingOk,
  parseHomeCheckManufactureCorrection,
} from './manufactureCorrectionParse.ts'

describe('parseHomeCheckManufactureCorrection', () => {
  const now = new Date('2026-11-07T12:00:00Z')

  it('parses Age of heating system 2014', () => {
    expect(parseHomeCheckManufactureCorrection('Age of heating system 2014', now)).toEqual({
      system: 'heating',
      year: 2014,
      month: null,
    })
  })

  it('parses water heater with month and year', () => {
    expect(parseHomeCheckManufactureCorrection('Water heater July 2010', now)).toEqual({
      system: 'water_heater',
      year: 2010,
      month: 7,
    })
  })

  it('parses furnace made in 2012', () => {
    expect(parseHomeCheckManufactureCorrection('furnace made in 2012', now)).toEqual({
      system: 'heating',
      year: 2012,
      month: null,
    })
  })

  it('rejects future years and unrelated free text', () => {
    expect(parseHomeCheckManufactureCorrection('heating system 2030', now)).toBeNull()
    expect(parseHomeCheckManufactureCorrection('approve the estimate', now)).toBeNull()
    expect(parseHomeCheckManufactureCorrection('OK', now)).toBeNull()
  })
})

describe('isHomeCheckResultsAwaitingOk', () => {
  const latest = {
    id: 'summary',
    body: 'Results: 78 Maple Ave\nHeating system: Slant/Fin.\nAge unknown.\nReply OK to confirm these records.',
    raw_payload: { source: 'home_check' },
    provider_status: 'delivered',
    from_number: '+15550001111',
    to_number: '+15551112222',
  }

  it('detects a Results summary waiting for OK', () => {
    expect(isHomeCheckResultsAwaitingOk(latest, '+15551112222', '+15550001111')).toBe(true)
  })

  it('ignores estimate asks and failed deliveries', () => {
    expect(isHomeCheckResultsAwaitingOk({
      ...latest,
      body: 'I didn\'t quite catch that — did you mean to approve the $2.00 estimate for WO-2483? Reply APPROVE or DECLINE.',
      raw_payload: { source: 'estimate' },
    }, '+15551112222', '+15550001111')).toBe(false)
    expect(isHomeCheckResultsAwaitingOk({
      ...latest,
      provider_status: 'failed',
    }, '+15551112222', '+15550001111')).toBe(false)
  })
})

it('help copy steers the landlord to OK or a year correction', () => {
  const help = homeCheckManufactureCorrectionHelp()
  expect(help).toContain('Reply OK')
  expect(help).toMatch(/Heating system 2014/i)
  expect(help).not.toMatch(/APPROVE|estimate|WO-/i)
})

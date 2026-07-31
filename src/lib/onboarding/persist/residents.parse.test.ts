import { describe, expect, it } from 'vitest'
import {
  parseLeaseDateInput,
  parseMonthlyRentInput,
  parseRentDueDayInput,
} from './residents'

describe('parseMonthlyRentInput', () => {
  it('strips currency formatting', () => {
    expect(parseMonthlyRentInput('$2,850')).toBe(2850)
    expect(parseMonthlyRentInput('2850')).toBe(2850)
    expect(parseMonthlyRentInput('1,200.50')).toBe(1200.5)
  })

  it('rejects empty or non-numeric amounts', () => {
    expect(parseMonthlyRentInput('')).toBeNull()
    expect(parseMonthlyRentInput('abc')).toBeNull()
    expect(parseMonthlyRentInput('$$')).toBeNull()
  })
})

describe('parseRentDueDayInput', () => {
  it('accepts days 1–31', () => {
    expect(parseRentDueDayInput('1')).toBe(1)
    expect(parseRentDueDayInput('31')).toBe(31)
    expect(parseRentDueDayInput(' 15 ')).toBe(15)
  })

  it('rejects out-of-range or blank values', () => {
    expect(parseRentDueDayInput('')).toBeNull()
    expect(parseRentDueDayInput('0')).toBeNull()
    expect(parseRentDueDayInput('32')).toBeNull()
    expect(parseRentDueDayInput('first')).toBeNull()
  })
})

describe('parseLeaseDateInput', () => {
  it('keeps valid YYYY-MM-DD dates', () => {
    expect(parseLeaseDateInput('2024-03-01')).toBe('2024-03-01')
  })

  it('rejects non-ISO or invalid calendar dates', () => {
    expect(parseLeaseDateInput('')).toBeNull()
    expect(parseLeaseDateInput('03/01/2024')).toBeNull()
    expect(parseLeaseDateInput('2024-13-01')).toBeNull()
    expect(parseLeaseDateInput('not-a-date')).toBeNull()
  })
})

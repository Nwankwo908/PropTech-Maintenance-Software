import { describe, expect, it } from 'vitest'
import {
  formatPhoneNational,
  normalizePhoneForDb,
  optionalPhoneForDbOrError,
  phoneForDbOrError,
} from '@/lib/phoneFormat'

describe('normalizePhoneForDb', () => {
  it.each([
    ['(555) 123-4567', '+15551234567'],
    ['555-123-4567', '+15551234567'],
    ['555.123.4567', '+15551234567'],
    ['555 123 4567', '+15551234567'],
    ['5551234567', '+15551234567'],
    ['+1 555 123 4567', '+15551234567'],
    ['+1 (555) 123-4567', '+15551234567'],
    ['1-555-123-4567', '+15551234567'],
    ['1 (555) 123-4567', '+15551234567'],
    ['+15551234567', '+15551234567'],
    ['555-123-4567 ext 99', '+15551234567'],
    ['555-123-4567 x99', '+15551234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhoneForDb(input)).toBe(expected)
  })

  it('returns null for empty or invalid input', () => {
    expect(normalizePhoneForDb('')).toBeNull()
    expect(normalizePhoneForDb('   ')).toBeNull()
    expect(normalizePhoneForDb('12345')).toBeNull()
  })
})

describe('phoneForDbOrError', () => {
  it('allows empty optional phone', () => {
    expect(optionalPhoneForDbOrError('')).toEqual({ phone: null })
    expect(optionalPhoneForDbOrError('   ')).toEqual({ phone: null })
  })

  it('returns an error for invalid non-empty input', () => {
    expect(phoneForDbOrError('not-a-phone').error).toBeTruthy()
  })
})

describe('formatPhoneNational', () => {
  it('formats stored E.164 for display', () => {
    expect(formatPhoneNational('+15551234567')).toBe('(555) 123-4567')
  })
})

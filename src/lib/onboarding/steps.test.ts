import { describe, expect, it } from 'vitest'
import {
  getOnboardingStepOrder,
  getPreviousOnboardingStep,
  normalizeOnboardingStep,
  resolveOnboardingStepForPath,
} from './steps'

describe('getOnboardingStepOrder', () => {
  it('returns guided order for scratch / null path', () => {
    expect(getOnboardingStepOrder(null)).toEqual([
      'entry',
      'account_setup',
      'property',
      'vendors',
      'residents',
      'approval',
      'payouts',
      'review',
    ])
    expect(getOnboardingStepOrder('guided')).toEqual(getOnboardingStepOrder(null))
  })

  it('returns fast-track order', () => {
    expect(getOnboardingStepOrder('fast_track')).toEqual([
      'entry',
      'document_upload',
      'ai_review',
      'approval',
      'payouts',
      'review',
    ])
  })
})

describe('normalizeOnboardingStep / legacy conversion', () => {
  it('maps legacy step ids onto the simplified flow', () => {
    expect(normalizeOnboardingStep('property_setup')).toBe('account_setup')
    expect(normalizeOnboardingStep('extraction_review')).toBe('ai_review')
    expect(normalizeOnboardingStep('phone_activation')).toBe('ai_review')
    expect(normalizeOnboardingStep('resident_announcement')).toBe('residents')
    expect(normalizeOnboardingStep('maintenance_rules')).toBe('approval')
    expect(normalizeOnboardingStep('completion')).toBe('review')
    expect(normalizeOnboardingStep('document_upload')).toBe('document_upload')
  })

  it('keeps current step ids and falls back unknown values to entry', () => {
    expect(normalizeOnboardingStep('vendors')).toBe('vendors')
    expect(normalizeOnboardingStep('not_a_step')).toBe('entry')
    expect(normalizeOnboardingStep(null)).toBe('entry')
    expect(normalizeOnboardingStep(42)).toBe('entry')
  })
})

describe('resolveOnboardingStepForPath', () => {
  it('rewrites guided-only steps when the path is fast track', () => {
    expect(resolveOnboardingStepForPath('property', 'fast_track')).toBe('document_upload')
    expect(resolveOnboardingStepForPath('vendors', 'fast_track')).toBe('ai_review')
    expect(resolveOnboardingStepForPath('residents', 'fast_track')).toBe('ai_review')
    expect(resolveOnboardingStepForPath('approval', 'fast_track')).toBe('approval')
  })

  it('leaves steps alone on the guided path', () => {
    expect(resolveOnboardingStepForPath('property', 'guided')).toBe('property')
    expect(resolveOnboardingStepForPath('vendors', null)).toBe('vendors')
  })
})

describe('getPreviousOnboardingStep', () => {
  it('returns null at the start of each path', () => {
    expect(getPreviousOnboardingStep('entry', 'guided')).toBeNull()
    expect(getPreviousOnboardingStep('entry', 'fast_track')).toBeNull()
  })

  it('walks guided and fast-track orders independently', () => {
    expect(getPreviousOnboardingStep('vendors', 'guided')).toBe('property')
    expect(getPreviousOnboardingStep('approval', 'guided')).toBe('residents')
    expect(getPreviousOnboardingStep('approval', 'fast_track')).toBe('ai_review')
    expect(getPreviousOnboardingStep('payouts', 'fast_track')).toBe('approval')
  })

  it('normalizes legacy ids before finding the previous step', () => {
    expect(getPreviousOnboardingStep('completion', 'guided')).toBe('payouts')
    expect(getPreviousOnboardingStep('property_setup', 'guided')).toBe('entry')
  })

  it('skips payouts when payments are not on the account', () => {
    expect(getOnboardingStepOrder('fast_track', { includePayouts: false })).toEqual([
      'entry',
      'document_upload',
      'ai_review',
      'approval',
      'review',
    ])
    expect(getPreviousOnboardingStep('review', 'guided', { includePayouts: false })).toBe('approval')
  })
})

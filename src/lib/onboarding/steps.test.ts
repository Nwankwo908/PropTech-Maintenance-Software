import { describe, expect, it } from 'vitest'
import {
  getOnboardingStepOrder,
  getOnboardingStepsForPath,
  getPreviousOnboardingStep,
  normalizeOnboardingStep,
  resolveOnboardingStepForPath,
  resolveReviewEditStep,
} from './steps'

describe('getOnboardingStepOrder', () => {
  it('returns guided order for scratch / null path', () => {
    expect(getOnboardingStepOrder(null, { includePayouts: true })).toEqual([
      'entry',
      'account_setup',
      'property',
      'vendors',
      'residents',
      'approval',
      'payouts',
      'review',
    ])
    expect(getOnboardingStepOrder('guided', { includePayouts: true })).toEqual(
      getOnboardingStepOrder(null, { includePayouts: true }),
    )
  })

  it('returns fast-track order without a separate final Review step', () => {
    expect(getOnboardingStepOrder('fast_track', { includePayouts: true })).toEqual([
      'entry',
      'document_upload',
      'ai_review',
      'approval',
      'payouts',
    ])
  })
})

describe('fast-track stepper labels', () => {
  it('shows three stages when payouts are off (upload, review, approval)', () => {
    const labels = getOnboardingStepsForPath('fast_track', { includePayouts: false })
      .filter((step) => step.id !== 'entry')
      .map((step) => step.label)
    expect(labels).toEqual(['Upload documents', 'Review', 'Approval rules'])
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
    expect(resolveOnboardingStepForPath('review', 'fast_track')).toBe('approval')
  })

  it('leaves steps alone on the guided path', () => {
    expect(resolveOnboardingStepForPath('property', 'guided')).toBe('property')
    expect(resolveOnboardingStepForPath('vendors', null)).toBe('vendors')
  })
})

describe('resolveReviewEditStep', () => {
  it('opens fast-track upload for property and account edits from last review', () => {
    expect(resolveReviewEditStep('property', 'fast_track')).toBe('document_upload')
    expect(resolveReviewEditStep('account_setup', 'fast_track')).toBe('document_upload')
    expect(resolveReviewEditStep('document_upload', 'fast_track')).toBe('document_upload')
  })

  it('opens merged Review for extracted roster and issue edits', () => {
    expect(resolveReviewEditStep('vendors', 'fast_track')).toBe('ai_review')
    expect(resolveReviewEditStep('residents', 'fast_track')).toBe('ai_review')
    expect(resolveReviewEditStep('ai_review', 'fast_track')).toBe('ai_review')
    expect(resolveReviewEditStep('review', 'fast_track')).toBe('ai_review')
  })

  it('leaves approval and payouts on their own steps', () => {
    expect(resolveReviewEditStep('approval', 'fast_track')).toBe('approval')
    expect(resolveReviewEditStep('payouts', 'fast_track')).toBe('payouts')
  })

  it('does not remap guided review edits', () => {
    expect(resolveReviewEditStep('property', 'guided')).toBe('property')
    expect(resolveReviewEditStep('account_setup', 'guided')).toBe('account_setup')
  })
})

describe('getPreviousOnboardingStep', () => {
  it('returns null at the start of each path', () => {
    expect(getPreviousOnboardingStep('entry', 'guided')).toBeNull()
    expect(getPreviousOnboardingStep('entry', 'fast_track')).toBeNull()
  })

  it('walks guided and fast-track orders independently', () => {
    expect(getPreviousOnboardingStep('vendors', 'guided', { includePayouts: true })).toBe('property')
    expect(getPreviousOnboardingStep('approval', 'guided', { includePayouts: true })).toBe(
      'residents',
    )
    expect(getPreviousOnboardingStep('approval', 'fast_track', { includePayouts: true })).toBe(
      'ai_review',
    )
    expect(getPreviousOnboardingStep('payouts', 'fast_track', { includePayouts: true })).toBe(
      'approval',
    )
  })

  it('normalizes legacy ids before finding the previous step', () => {
    expect(getPreviousOnboardingStep('completion', 'guided', { includePayouts: true })).toBe(
      'payouts',
    )
    expect(getPreviousOnboardingStep('property_setup', 'guided')).toBe('entry')
  })

  it('skips payouts when payments are not on the account', () => {
    expect(getOnboardingStepOrder('fast_track', { includePayouts: false })).toEqual([
      'entry',
      'document_upload',
      'ai_review',
      'approval',
    ])
    expect(getPreviousOnboardingStep('review', 'guided', { includePayouts: false })).toBe('approval')
    expect(getPreviousOnboardingStep('review', 'fast_track', { includePayouts: false })).toBe(
      'ai_review',
    )
  })
})

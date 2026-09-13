import { describe, expect, it } from 'vitest'
import { resolveWizardDisplayStep } from './wizardNavigation'

describe('resolveWizardDisplayStep', () => {
  it('shows the remapped fast-track stage while currentStep is still review', () => {
    expect(
      resolveWizardDisplayStep({
        storedStep: 'review',
        setupPath: 'fast_track',
        onboardingStatus: 'in_progress',
        editingFromReview: true,
        reviewEditStep: 'property',
      }),
    ).toBe('document_upload')
  })

  it('follows navigation during a review edit (upload → AI review)', () => {
    expect(
      resolveWizardDisplayStep({
        storedStep: 'ai_review',
        setupPath: 'fast_track',
        onboardingStatus: 'in_progress',
        editingFromReview: true,
        reviewEditStep: 'document_upload',
      }),
    ).toBe('ai_review')
  })
})

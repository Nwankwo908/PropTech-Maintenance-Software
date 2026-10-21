import { describe, expect, it } from 'vitest'

/**
 * Contract for Start: the wizard clears displayed inventory only after
 * `start_fresh_onboarding_run` commits. Keep this aligned with
 * `useOnboardingWizard.beginOnboarding`.
 */
function planBeginOnboardingAfterFreshRun(input: {
  startedOk: boolean
  startedError?: string
}): {
  clearWizardInventory: boolean
  surfaceError: string | null
} {
  if (!input.startedOk) {
    return {
      clearWizardInventory: false,
      surfaceError:
        input.startedError?.trim() ||
        'Could not start a fresh setup. Your previous portfolio was left unchanged.',
    }
  }
  return { clearWizardInventory: true, surfaceError: null }
}

describe('beginOnboarding fail-closed UI gate', () => {
  it('keeps prior inventory when fresh-run cleanup fails', () => {
    const plan = planBeginOnboardingAfterFreshRun({
      startedOk: false,
      startedError:
        'This account has live work orders, payments, inspections, or equipment records.',
    })
    expect(plan.clearWizardInventory).toBe(false)
    expect(plan.surfaceError).toMatch(/live work orders/i)
  })

  it('clears the wizard only after the server commits the fresh run', () => {
    const plan = planBeginOnboardingAfterFreshRun({ startedOk: true })
    expect(plan.clearWizardInventory).toBe(true)
    expect(plan.surfaceError).toBeNull()
  })
})

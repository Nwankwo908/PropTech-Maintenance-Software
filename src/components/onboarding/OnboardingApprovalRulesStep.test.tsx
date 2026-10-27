/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnboardingApprovalRulesStep } from '@/components/onboarding/OnboardingApprovalRulesStep'
import { defaultOnboardingApprovalRules } from '@/lib/onboardingApprovalRules'

afterEach(() => cleanup())

function renderStep(onContinue = vi.fn()) {
  render(
    <OnboardingApprovalRulesStep
      initialRules={defaultOnboardingApprovalRules()}
      saving={false}
      showBack={false}
      showMarketplacePreference={false}
      onBack={() => undefined}
      onContinue={onContinue}
    />,
  )
  return onContinue
}

describe('emergency preferences', () => {
  it('shows emergency chips without a change link', () => {
    renderStep()
    expect(screen.queryByText('Required · about 2 minutes')).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Change emergency preferences' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('list').textContent).toContain('No heat')
    expect(screen.getByRole('list').textContent).toContain('Gas smell')
  })

  it('continues with the emergency chips that are shown', () => {
    const onContinue = renderStep()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const saved = onContinue.mock.calls[0]?.[0].emergencyTypes as string[]
    expect(saved).toContain('no_heat')
    expect(saved).toContain('gas_smell')
  })
})

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
  it('starts as a list and opens checkboxes from the change link', () => {
    renderStep()
    expect(screen.getByRole('list').textContent).toContain('No heat')
    expect(screen.getByRole('list').textContent).toContain('Gas smell')
    expect(screen.queryByRole('checkbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Change emergency preferences' }))

    expect(screen.getAllByRole('checkbox')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: '+ Change emergency preferences' })).toBeNull()
  })

  it('saves an adjusted list and continues with that selection', () => {
    const onContinue = renderStep()
    fireEvent.click(screen.getByRole('button', { name: '+ Change emergency preferences' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gas smell' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('list').textContent).toContain('No heat')
    expect(screen.getByRole('list').textContent).not.toContain('Gas smell')

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        emergencyTypes: expect.not.arrayContaining(['gas_smell']),
      }),
    )
    const saved = onContinue.mock.calls[0]?.[0].emergencyTypes as string[]
    expect(saved).toContain('no_heat')
    expect(saved).not.toContain('gas_smell')
  })

  it('hides the change link when customization is off', () => {
    render(
      <OnboardingApprovalRulesStep
        initialRules={defaultOnboardingApprovalRules()}
        saving={false}
        showBack={false}
        showMarketplacePreference={false}
        allowEmergencyCustomization={false}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    )
    expect(screen.queryByRole('button', { name: '+ Change emergency preferences' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

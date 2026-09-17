/**
 * Shared back / continue nav chrome for guided onboarding steps.
 */
import type { ReactNode } from 'react'
import { onboardingBtnBackClass, onboardingBtnContinueClass } from './onboardingFieldStyles'

export function OnboardingBackButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={onboardingBtnBackClass}>
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M15 18l-6-6 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back
    </button>
  )
}

export function OnboardingContinueButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={onboardingBtnContinueClass}>
      {children}
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M9 18l6-6-6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export function OnboardingStepNav({
  showBack,
  onBack,
  saving,
  children,
}: {
  showBack: boolean
  onBack: () => void
  saving: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4">
      {showBack ? <OnboardingBackButton disabled={saving} onClick={onBack} /> : <span aria-hidden />}
      <div className="flex items-center gap-3">{children}</div>
    </div>
  )
}

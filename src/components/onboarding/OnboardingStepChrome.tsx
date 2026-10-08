/**
 * Shared back / continue nav chrome for guided onboarding steps.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { onboardingBtnBackClass, onboardingBtnContinueClass } from './onboardingFieldStyles'

const OnboardingNavCenterContext = createContext<ReactNode>(null)

export function OnboardingNavCenterProvider({
  value,
  children,
}: {
  value: ReactNode
  children: ReactNode
}) {
  return (
    <OnboardingNavCenterContext.Provider value={value}>{children}</OnboardingNavCenterContext.Provider>
  )
}

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
  const center = useContext(OnboardingNavCenterContext)
  return (
    <div
      className="onb-sticky-nav fixed bottom-0 z-40 border-t border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(16,24,40,0.06)] sm:px-8"
      style={{
        left: 'var(--onb-sticky-nav-left, 0px)',
        right: 'var(--onb-sticky-nav-right, 0px)',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="justify-self-start">
          {showBack ? <OnboardingBackButton disabled={saving} onClick={onBack} /> : <span aria-hidden />}
        </div>
        <div className="justify-self-center text-center">{center}</div>
        <div className="flex items-center justify-end gap-3 justify-self-end">{children}</div>
      </div>
    </div>
  )
}

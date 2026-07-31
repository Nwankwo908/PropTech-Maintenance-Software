import { Fragment } from 'react'
import { getOnboardingStepsForPath, type OnboardingSetupPath, type OnboardingStep } from '@/lib/onboarding'

function getStepperSteps(setupPath: OnboardingSetupPath) {
  return getOnboardingStepsForPath(setupPath).filter((step) => step.id !== 'entry')
}

function StepMarker({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span
        className="onb-stepper-marker onb-stepper-marker-done flex size-6 shrink-0 items-center justify-center rounded-full bg-[#92C5DB]"
        aria-hidden
      >
        <svg viewBox="0 0 12 12" fill="none" className="size-3.5">
          <path
            d="M2.5 6l2.25 2.25L9.5 3.75"
            stroke="#186179"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }

  if (active) {
    return (
      <span
        className="onb-stepper-marker onb-stepper-marker-active flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-[#92C5DB] bg-white shadow-[0_0_0_3px_rgba(146,197,219,0.22)]"
        aria-hidden
      >
        <span className="onb-stepper-active-dot size-2 rounded-full bg-[#92C5DB]" />
      </span>
    )
  }

  return (
    <span
      className="onb-stepper-marker size-6 shrink-0 rounded-full bg-[#e5e7eb]"
      aria-hidden
    />
  )
}

function stepLabelClass(done: boolean, active: boolean): string {
  if (active) {
    return 'onb-stepper-label text-[12px] font-bold leading-4 text-[#364153]'
  }
  if (done) {
    return 'onb-stepper-label text-[12px] font-medium leading-4 text-[#64748b]'
  }
  return 'onb-stepper-label text-[12px] font-medium leading-4 text-[#9ca3af]'
}

export function OnboardingStepIndicator({
  current,
  setupPath = null,
  className,
}: {
  current: OnboardingStep
  setupPath?: OnboardingSetupPath
  className?: string
}) {
  const stepperSteps = getStepperSteps(setupPath)
  const currentIdx = stepperSteps.findIndex((step) => step.id === current)

  return (
    <nav
      aria-label="Onboarding progress"
      className={`overflow-x-auto pb-1 ${className ?? 'mb-8'}`}
    >
      <ol className="flex min-w-[480px] items-start lg:min-w-0">
        {stepperSteps.map((step, i) => {
          const done = currentIdx >= 0 && i < currentIdx
          const active = step.id === current
          const connectorFilled = currentIdx >= 0 && i <= currentIdx

          return (
            <Fragment key={step.id}>
              {i > 0 ? (
                <div
                  className={[
                    'onb-stepper-connector mt-3 h-0.5 min-w-[12px] flex-1',
                    connectorFilled ? 'bg-[#92C5DB]' : 'bg-[#e5e7eb]',
                  ].join(' ')}
                  aria-hidden
                />
              ) : null}
              <li className="flex w-[72px] shrink-0 flex-col items-center gap-2 sm:w-auto sm:min-w-[64px] sm:flex-1">
                <StepMarker done={done} active={active} />
                <span className={`max-w-[88px] text-center ${stepLabelClass(done, active)}`}>
                  {step.label}
                </span>
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

import { onboardingBtnContinueClass } from '@/components/onboarding/onboardingFieldStyles'

type OnboardingWelcomeHubProps = {
  onStartFastTrack: () => void
  starting?: boolean
}

/** First-login welcome hub — start Fast Track document upload. */
export function OnboardingWelcomeHub({
  onStartFastTrack,
  starting = false,
}: OnboardingWelcomeHubProps) {
  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col items-center">
      <h2 className="onb-welcome-title text-center text-[48px] font-semibold leading-tight tracking-[-0.6px] text-[#101828]">
        Let&apos;s get your portfolio set up
      </h2>
      <p className="onb-welcome-subtitle mt-2 max-w-[520px] text-center text-[16px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
        Get started in minutes by uploading your property records.
      </p>

      <button
        type="button"
        className={`onb-welcome-card ${onboardingBtnContinueClass} mt-10`}
        style={{ ['--onb-stagger' as string]: 0 }}
        disabled={starting}
        aria-busy={starting}
        onClick={onStartFastTrack}
      >
        Get started
      </button>
    </div>
  )
}

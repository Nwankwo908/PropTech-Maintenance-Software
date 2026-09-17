import allSetIllustration from '@/assets/onboarding-all-set.png'

type OnboardingAllSetWelcomeProps = {
  onGetStarted: () => void
}

/** Figma 1364:394 — post-setup welcome for Limited Alpha 1. */
export function OnboardingAllSetWelcome({ onGetStarted }: OnboardingAllSetWelcomeProps) {
  return (
    <main className="onb-all-set flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6 font-[family-name:var(--font-admin)] lg:h-[calc(100dvh-68px)] lg:max-h-[calc(100dvh-68px)] lg:overflow-hidden lg:px-10 lg:py-5">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center lg:justify-center">
        <div className="shrink-0">
          <h1 className="onb-all-set-title text-center font-[family-name:var(--font-admin)] text-[28px] font-semibold leading-tight tracking-[-0.5px] text-[#101828]">
            You&apos;re all set!
          </h1>
          <p className="onb-all-set-subtitle mt-2 max-w-[36rem] text-center text-[16px] font-normal leading-6 tracking-[-0.1504px] text-[#6a7282]">
            Complete the action-item checklist to get the most out of Ulo.
          </p>
        </div>

        <div className="relative mt-4 min-h-0 w-full flex-1 lg:mt-5">
          <img
            src={allSetIllustration}
            alt=""
            width={692}
            height={645}
            className="onb-all-set-art mx-auto h-full max-h-[min(520px,calc(100dvh-280px))] w-auto max-w-[min(692px,100%)] object-contain lg:absolute lg:inset-0 lg:max-h-full"
          />
        </div>

        <button
          type="button"
          className="onb-all-set-cta sa-press mt-4 shrink-0 rounded-[8px] bg-[#0d9488] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/50 focus-visible:ring-offset-2 lg:mt-5"
          onClick={onGetStarted}
        >
          Get Started
        </button>
      </div>
    </main>
  )
}

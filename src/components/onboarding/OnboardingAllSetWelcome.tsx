import allSetIllustration from '@/assets/onboarding-all-set.png'

type OnboardingAllSetWelcomeProps = {
  onGetStarted: () => void
}

/** Figma 1364:394 — post-setup welcome for Limited Alpha 1. */
export function OnboardingAllSetWelcome({ onGetStarted }: OnboardingAllSetWelcomeProps) {
  return (
    <main className="flex flex-1 flex-col items-center overflow-y-auto px-10 py-8">
      <div className="flex w-full flex-col items-center">
        <h1 className="text-center text-[28px] font-medium leading-normal text-[#0d0b26]">
          You&apos;re all set!
        </h1>
        <p className="mt-0 max-w-[36rem] text-center text-[20px] font-light leading-[1.2] text-[#0d0b26]">
          Complete the action-item checklist to get the most out of Ulo.
        </p>
      </div>

      <img
        src={allSetIllustration}
        alt=""
        width={692}
        height={645}
        className="mt-6 h-auto w-full max-w-[692px] object-contain"
      />

      <button
        type="button"
        className="sa-press mt-6 rounded-[8px] bg-[#0d9488] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d9488]/50 focus-visible:ring-offset-2"
        onClick={onGetStarted}
      >
        Get Started
      </button>
    </main>
  )
}

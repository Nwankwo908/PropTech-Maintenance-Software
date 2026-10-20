import iphoneMockup from '@/assets/Free Transparent iPhone 17 Mockup (Mockuuups Studio).png'
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
    <div className="relative w-full overflow-hidden rounded-[28px] bg-[#f3f4f6]">
      <div className="grid w-full lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="onb-welcome-copy relative z-10 flex min-w-0 max-w-[520px] flex-col items-start px-8 py-10 sm:px-12 sm:py-14 lg:justify-center lg:py-16 lg:pr-4">
          <h2 className="text-left text-[40px] font-semibold leading-tight tracking-[-0.6px] text-[#101828] sm:text-[48px]">
            <span className="block">Let&apos;s get your portfolio</span>
            <span className="block">set up</span>
          </h2>
          <p className="mt-3 max-w-[420px] text-left text-[16px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
            Get started in minutes by uploading your leasing documents.
          </p>

          <button
            type="button"
            className={`${onboardingBtnContinueClass} mt-8`}
            disabled={starting}
            aria-busy={starting}
            onClick={onStartFastTrack}
          >
            Get started
          </button>
        </div>

        {/* Desktop: image column reserves space so copy cannot overlap the mockup. */}
        <div className="relative hidden min-h-0 min-w-0 overflow-hidden lg:block">
          <img
            src={iphoneMockup}
            alt="Text conversation with Ulo about a clogged toilet"
            className="pointer-events-none absolute top-8 right-4 h-[min(820px,150%)] w-auto max-w-none xl:right-8"
          />
        </div>

        <div className="relative h-[300px] overflow-hidden lg:hidden">
          <img
            src={iphoneMockup}
            alt=""
            className="pointer-events-none absolute top-0 left-1/2 h-[560px] w-auto max-w-none -translate-x-1/2"
          />
        </div>
      </div>
    </div>
  )
}

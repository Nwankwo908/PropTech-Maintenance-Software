import textIcon from '@/assets/Text.svg'
import uloLogoSmall from '@/assets/Ulo_Logo_small.png'

type OnboardingUloNumberCardProps = {
  smsIntakeNumber: string | null | undefined
  smsIntakeNumberDisplay?: string | null
}

/** Assigned landlord SMS line shown during onboarding Review. */
export function OnboardingUloNumberCard({
  smsIntakeNumber,
  smsIntakeNumberDisplay,
}: OnboardingUloNumberCardProps) {
  const display =
    smsIntakeNumberDisplay?.trim() ||
    smsIntakeNumber?.trim() ||
    'Assigning your number…'

  return (
    <section className="onb-form-card sa-surface rounded-2xl border border-[#9DD4A6] bg-[#E6F4E9] px-6 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start gap-2">
        <img
          src={uloLogoSmall}
          alt=""
          className="mt-0.5 size-6 shrink-0 object-contain"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-[16px] font-semibold tracking-[-0.2px] text-[#111827]">
              Your Ulo Number
            </h3>
            <p className="flex shrink-0 items-center gap-1.5 text-[15px] leading-snug text-[#374151]">
              <img src={textIcon} alt="" className="size-4 shrink-0" aria-hidden />
              {display}
            </p>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            Residents text this Ulo number to report maintenance and get updates. Share it after
            setup, or include it in your welcome messages.
          </p>
        </div>
      </div>
    </section>
  )
}

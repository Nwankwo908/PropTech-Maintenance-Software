/**
 * Full-screen transition while onboarding completes or imports portfolio.
 */
export function OnboardingSetupTransition({
  title = 'Setting up your dashboard',
  subtitle = 'This will only take a moment…',
}: {
  title?: string
  subtitle?: string
}) {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="onb-setup-spinner" role="status" aria-label="Loading" />
      <div className="onb-setup-copy text-center">
        <p className="text-[16px] font-semibold text-[#101828]">{title}</p>
        <p className="mt-1 text-[14px] text-[#6a7282]">{subtitle}</p>
      </div>
    </main>
  )
}

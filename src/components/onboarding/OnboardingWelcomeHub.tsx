import startScratchIcon from '@/assets/onboarding-start-scratch.png'
import fastTrackIcon from '@/assets/onboarding-fast-track.png'

type OnboardingWelcomeHubProps = {
  onStartScratch: () => void
  onStartFastTrack: () => void
}

function pathCardClassName(interactive: boolean) {
  return [
    'flex h-full min-h-[220px] w-full flex-col rounded-[10px] border bg-white p-6 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] outline-none transition-[border-color,box-shadow] duration-150',
    interactive
      ? 'cursor-pointer border-[#e5e7eb] hover:border-[#70ABC5] hover:shadow-[0px_4px_12px_-2px_rgba(112,171,197,0.2)] focus-visible:border-[#70ABC5] focus-visible:ring-2 focus-visible:ring-[#70ABC5]/25'
      : 'border-[#e5e7eb]',
  ].join(' ')
}

/** Figma 650:1117 — first-login welcome hub for empty New Landlord accounts. */
export function OnboardingWelcomeHub({ onStartScratch, onStartFastTrack }: OnboardingWelcomeHubProps) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col items-center">
      <h1 className="text-center text-[32px] font-semibold leading-10 tracking-[-0.6px] text-[#101828]">
        Welcome to Ulo
      </h1>
      <p className="mt-2 max-w-[520px] text-center text-[16px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
        Choose how you&apos;d like to get your workspace set up.
      </p>

      <div className="mt-10 grid w-full gap-4 sm:grid-cols-2">
        <button type="button" className={pathCardClassName(true)} onClick={onStartScratch}>
          <span className="flex size-10 items-center justify-center rounded-full bg-[#f3f4f6]">
            <img src={startScratchIcon} alt="" className="size-5 object-contain" aria-hidden />
          </span>
          <span className="mt-4 text-[18px] font-semibold leading-7 tracking-[-0.2px] text-[#101828]">
            Add your property information yourself
          </span>
          <span className="mt-2 flex-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            We'll guide you through a few quick steps to get your account ready.
          </span>
          <span className="mt-6 text-[12px] font-medium text-[#6a7282]">~5 minutes · 5 steps</span>
        </button>

        <button type="button" className={pathCardClassName(true)} onClick={onStartFastTrack}>
          <span className="flex size-10 items-center justify-center rounded-full bg-[#f3f4f6]">
            <img src={fastTrackIcon} alt="" className="size-5 object-contain" aria-hidden />
          </span>
          <span className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[18px] font-semibold leading-7 tracking-[-0.2px] text-[#101828]">
            Already have property records? Start here.
            </span>
            <span className="rounded-full bg-[#C4E5C9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#187930]">
              Fastest
            </span>
          </span>
          <span className="mt-2 flex-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Upload leases, spreadsheets, or phots of documents and Ulo will help fill in your account information automatically.
          </span>
          <span className="mt-6 text-[12px] font-medium text-[#6a7282]">~2 minutes · PDF, CSV, XLSX</span>
        </button>
      </div>
    </div>
  )
}

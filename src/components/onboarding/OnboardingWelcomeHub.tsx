import startScratchIcon from '@/assets/onboarding-start-scratch.png'
import fastTrackIcon from '@/assets/onboarding-fast-track.png'
import { LANDING_DOCUMENT_IMPORT_ICONS } from '@/components/landing/LandingIcons'

type OnboardingWelcomeHubProps = {
  onStartScratch: () => void
  onStartFastTrack: () => void
  starting?: boolean
}

function pathCardClassName(interactive: boolean, variant: 'default' | 'fastTrack' = 'default') {
  const isFastTrack = variant === 'fastTrack'
  return [
    'sa-card sa-press flex h-full min-h-[220px] w-full flex-col self-stretch rounded-[10px] border p-6 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] outline-none sm:min-h-full',
    isFastTrack ? 'border-[#57B769] bg-[#E6F4E9]' : 'border-[#e5e7eb] bg-white',
    interactive
      ? isFastTrack
        ? 'cursor-pointer hover:border-[#57B769] hover:shadow-[0px_4px_12px_-2px_rgba(87,183,105,0.25)] focus-visible:border-[#57B769] focus-visible:ring-2 focus-visible:ring-[#57B769]/25'
        : 'cursor-pointer hover:border-[#70ABC5] hover:shadow-[0px_4px_12px_-2px_rgba(112,171,197,0.2)] focus-visible:border-[#70ABC5] focus-visible:ring-2 focus-visible:ring-[#70ABC5]/25'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Figma 650:1117 — first-login welcome hub for empty New Landlord accounts. */
export function OnboardingWelcomeHub({
  onStartScratch,
  onStartFastTrack,
  starting = false,
}: OnboardingWelcomeHubProps) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col items-center">
      <h2 className="onb-welcome-title text-center text-[48px] font-semibold leading-tight tracking-[-0.6px] text-[#101828]">
        Let&apos;s get your portfolio set up
      </h2>
      <p className="onb-welcome-subtitle mt-2 max-w-[520px] text-center text-[16px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
        Get started in minutes. Choose the fastest way to add your properties.
      </p>

      <div className="mt-10 grid w-full grid-cols-1 items-stretch gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
        <button
          type="button"
          className={`onb-welcome-card min-w-0 ${pathCardClassName(!starting, 'fastTrack')}`}
          style={{ ['--onb-stagger' as string]: 0 }}
          disabled={starting}
          aria-busy={starting}
          onClick={onStartFastTrack}
        >
          <span className="sa-pill self-start rounded-full bg-[#C4E5C9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#187930]">
            Fastest
          </span>
          <span className="mt-3 flex min-h-0 flex-1 flex-row items-stretch gap-4">
            <span className="flex size-10 shrink-0 self-start items-center justify-center">
              <img src={fastTrackIcon} alt="" className="size-5 object-contain" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[18px] font-semibold leading-7 tracking-[-0.2px] text-[#101828]">
                Upload your property records
              </span>
              <span className="mt-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Add leases, tenant lists, spreadsheets, or photos.
              </span>
              <span className="mt-3 flex flex-wrap items-center gap-1" aria-hidden>
                {LANDING_DOCUMENT_IMPORT_ICONS.map((Icon) => (
                  <span
                    key={Icon.name}
                    className="inline-flex drop-shadow-[0_1px_1px_rgba(15,23,42,0.24)] drop-shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
                  >
                    <Icon className="size-[25px] shrink-0" />
                  </span>
                ))}
              </span>
              <span className="mt-2 text-[12px] font-medium leading-4 tracking-[-0.1504px] text-[#6a7282]">
                PDF, Word, Excel, CSV
              </span>
              <span className="mt-auto pt-6 text-[12px] font-medium text-[#6a7282]">~1 minutes</span>
            </span>
          </span>
        </button>

        <div
          className="flex h-8 w-full items-center sm:h-auto sm:w-10 sm:flex-col sm:self-stretch"
          role="separator"
          aria-label="or"
        >
          <span className="h-px flex-1 bg-[#e5e7eb] sm:h-auto sm:w-px" />
          <span className="mx-3 flex size-8 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[12px] font-medium leading-none text-[#6a7282] sm:mx-0 sm:my-3">
            or
          </span>
          <span className="h-px flex-1 bg-[#e5e7eb] sm:h-auto sm:w-px" />
        </div>

        <button
          type="button"
          className={`onb-welcome-card min-w-0 ${pathCardClassName(!starting)}`}
          style={{ ['--onb-stagger' as string]: 1 }}
          disabled={starting}
          aria-busy={starting}
          onClick={onStartScratch}
        >
          <span className="flex min-h-0 flex-1 flex-row items-stretch gap-4">
            <span className="flex size-10 shrink-0 self-start items-center justify-center rounded-full bg-[#f3f4f6]">
              <img src={startScratchIcon} alt="" className="size-5 object-contain" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[18px] font-semibold leading-7 tracking-[-0.2px] text-[#101828]">
                Set up manually
              </span>
              <span className="mt-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                We’ll guide you through a few quick steps.
              </span>
              <span className="mt-3 flex flex-col gap-1.5 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                <span className="flex gap-2">
                  <span aria-hidden>•</span>
                  <span>Best if you have a few properties</span>
                </span>
                <span className="flex gap-2">
                  <span aria-hidden>•</span>
                  <span>Guided, step by step setup</span>
                </span>
              </span>
              <span className="mt-auto pt-6 text-[12px] font-medium text-[#6a7282]">
                ~5 minutes · 5 steps
              </span>
            </span>
          </span>
        </button>
      </div>
    </div>
  )
}

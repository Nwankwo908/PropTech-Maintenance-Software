import { Link } from 'react-router-dom'
import welcomeTextsIcon from '@/assets/invitation.png'
import verifyVendorsIcon from '@/assets/verify-vendors.png'
import propertyDetailsIcon from '@/assets/property-details.png'
import maintenancePrefsIcon from '@/assets/settings.png'
import testRequestIcon from '@/assets/test-tube.png'
import checkIcon from '@/assets/setup-success/check.svg'
import type { SetupSuccessItemId, SetupSuccessProgress } from '@/lib/setupSuccessChecklist'
import { setupCheckboxGuideLinkState } from '@/lib/setupSuccessGuide'

const ITEM_ICONS: Record<SetupSuccessItemId, string> = {
  welcome_texts: welcomeTextsIcon,
  verify_vendors: verifyVendorsIcon,
  property_details: propertyDetailsIcon,
  maintenance_prefs: maintenancePrefsIcon,
  test_request: testRequestIcon,
}

type GetSetUpForSuccessCardProps = {
  progress: SetupSuccessProgress
  onClose: () => void
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

export function GetSetUpForSuccessCard({ progress, onClose }: GetSetUpForSuccessCardProps) {
  const fillPercent = progress.total > 0 ? (progress.doneCount / progress.total) * 100 : 0

  return (
    <section
      className="sa-enter pointer-events-auto fixed bottom-6 left-6 z-40 w-[calc(100%-3rem)] max-w-[520px] rounded-[16px] border border-[#f1f5f9] bg-white p-6 shadow-[0px_8px_24px_rgba(16,24,40,0.12)] transition-[border-color,box-shadow] duration-200 hover:border-[#e5e7eb] hover:shadow-[0px_12px_32px_rgba(16,24,40,0.16)] lg:left-[calc(16rem+1.5rem)]"
      aria-label="Get set up for success"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
      >
        <CloseIcon />
      </button>
      <div className="flex w-full flex-col gap-2 pr-8">
        <h2 className="font-[family-name:var(--font-admin)] text-[18px] font-bold leading-normal text-[#0d0b26]">
          Get set up for success
        </h2>
        <p className="text-[13px] font-normal leading-[18px] text-[#4b5563]">
          Complete these recommended steps to finish setting up Ulo and get your property operations
          running smoothly.
        </p>
      </div>

      <div className="mt-5 h-2 w-full overflow-hidden rounded-[4px] bg-[#eef2f6]" aria-hidden>
        <div
          className="h-full rounded-[4px] bg-[#57b769] transition-[width] duration-300 ease-out"
          style={{ width: `${fillPercent}%` }}
        />
      </div>
      <p className="sr-only">
        {progress.doneCount} of {progress.total} setup steps complete
      </p>

      <div className="mt-5 overflow-hidden rounded-[12px] border border-[#e2e8f0]">
        {progress.items.map((item, index) => {
          const rowClass = `flex items-center justify-between py-4 pl-4 pr-5 ${
            index < progress.items.length - 1 ? 'border-b border-[#e2e8f0]' : ''
          }`
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#f3f4f6]">
                  <img
                    src={ITEM_ICONS[item.id]}
                    alt=""
                    width={28}
                    height={28}
                    className={`size-7 max-w-none object-contain ${
                      item.done ? 'opacity-40 grayscale' : ''
                    }`}
                  />
                </span>
                <span
                  className={`text-[14px] font-semibold leading-normal ${
                    item.done ? 'text-[#9ca3af] line-through' : 'text-[#1f2937]'
                  }`}
                >
                  {item.label}
                </span>
              </span>
              {item.done ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[12px] bg-[#57b769]">
                  <img src={checkIcon} alt="" width={12} height={12} className="size-3 max-w-none" />
                </span>
              ) : null}
            </>
          )

          if (item.done) {
            return (
              <div
                key={item.id}
                className={`${rowClass} cursor-default`}
                aria-disabled="true"
              >
                {body}
              </div>
            )
          }

          return (
            <Link
              key={item.id}
              to={item.to}
              state={setupCheckboxGuideLinkState(item.id)}
              className={`sa-press ${rowClass} transition-colors hover:bg-[#f9fafb] focus-visible:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5]`}
            >
              {body}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

import { Link } from 'react-router-dom'
import maintenanceIcon from '@/assets/Maintenance_Icon.svg'

/** Single source of truth for resident maintenance + review page top bar (height, padding, type). */
const HEADER_ROW_CLASS =
  'z-30 box-border flex w-full min-w-0 shrink-0 items-center gap-3 border-b border-[#e5e7eb] bg-white px-6 py-[16px] sm:px-12 lg:h-[96px] lg:py-0'

const breadcrumbCrumbClass =
  'rounded px-0.5 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282] outline-none transition-colors hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#2B7FFF] focus-visible:ring-offset-2'

export function MaintenancePortalPageHeader({
  sticky,
  step = 'form',
}: {
  /** `always`: form flow. `lg`: review flow. `none`: never sticky. */
  sticky: 'always' | 'lg' | 'none'
  /** `review`: confirm step. `submitted`: success screen after submission. */
  step?: 'form' | 'review' | 'submitted'
}) {
  const positionClass =
    sticky === 'always' ? 'sticky top-0' : sticky === 'lg' ? 'relative lg:sticky lg:top-0' : 'relative'

  return (
    <header className={`${positionClass} ${HEADER_ROW_CLASS}`}>
      <div className="relative size-12 shrink-0">
        <img
          src={maintenanceIcon}
          alt=""
          className="size-12 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <h1 className="m-0 text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-[#0a0a0a]">
          Submit a Maintenance Request
        </h1>
        <nav aria-label="Breadcrumb" className="mt-0.5">
          <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-1 gap-y-0.5 p-0">
            <li className="flex min-w-0 items-center gap-x-1">
              <Link to="/" className={`${breadcrumbCrumbClass} underline-offset-2 hover:underline`}>
                Resident Portal
              </Link>
              <span aria-hidden className="shrink-0 text-[14px] text-[#9ca3af]">
                /
              </span>
            </li>
            <li className="flex min-w-0 items-center gap-x-1">
              <span className={breadcrumbCrumbClass}>Maintenance</span>
              <span aria-hidden className="shrink-0 text-[14px] text-[#9ca3af]">
                /
              </span>
            </li>
            {step === 'submitted' ? (
              <>
                <li className="flex min-w-0 items-center gap-x-1">
                  <span className={breadcrumbCrumbClass}>Request</span>
                  <span aria-hidden className="shrink-0 text-[14px] text-[#9ca3af]">
                    /
                  </span>
                </li>
                <li className="flex min-w-0 items-center gap-x-1">
                  <span className={breadcrumbCrumbClass}>Review</span>
                  <span aria-hidden className="shrink-0 text-[14px] text-[#9ca3af]">
                    /
                  </span>
                </li>
                <li className="min-w-0">
                  <span
                    aria-current="page"
                    className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]"
                  >
                    Submitted
                  </span>
                </li>
              </>
            ) : step === 'review' ? (
              <>
                <li className="flex min-w-0 items-center gap-x-1">
                  <span className={breadcrumbCrumbClass}>Request</span>
                  <span aria-hidden className="shrink-0 text-[14px] text-[#9ca3af]">
                    /
                  </span>
                </li>
                <li className="min-w-0">
                  <span
                    aria-current="page"
                    className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]"
                  >
                    Review
                  </span>
                </li>
              </>
            ) : (
              <li className="min-w-0">
                <span
                  aria-current="page"
                  className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]"
                >
                  Request
                </span>
              </li>
            )}
          </ol>
        </nav>
      </div>
      <Link
        to="/"
        className="ml-auto shrink-0 rounded-lg px-3 py-2 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#2B7FFF] outline-none transition-colors hover:bg-[#2B7FFF]/10 focus-visible:ring-2 focus-visible:ring-[#2B7FFF] focus-visible:ring-offset-2"
      >
        Cancel
      </Link>
    </header>
  )
}

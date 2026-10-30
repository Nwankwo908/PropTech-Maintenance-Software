import { Fragment, useId, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import welcomeTextsIcon from '@/assets/invitation.png'
import verifyVendorsIcon from '@/assets/verify-vendors.png'
import propertyAccessIcon from '@/assets/noun_propertykey_8436012.svg'
import propertyIntelligenceIcon from '@/assets/property-details.png'
import propertyInsuranceIcon from '@/assets/noun_insurance_6623754.svg'
import maintenancePrefsIcon from '@/assets/settings.png'
import testRequestIcon from '@/assets/test-tube.png'
import checkIcon from '@/assets/setup-success/check.svg'
import {
  setupSuccessPercent,
  type SetupSuccessItemId,
  type SetupSuccessProgress,
} from '@/lib/setupSuccessChecklist'
import { setupPortfolioHeading } from '@/lib/setupPortfolioHeading'
import { TRY_DEMO_SPOTLIGHT_SETUP_SUCCESS_ID } from '@/lib/tryDemoAttentionGuide'
import {
  markSetupSuccessCheckboxGuidePending,
  armSetupSuccessPropertyDetailGuide,
  setupCheckboxGuideLinkState,
  setupCheckboxGuidePropertyDetailState,
} from '@/lib/setupSuccessGuide'

const ITEM_ICONS: Record<SetupSuccessItemId, string> = {
  welcome_texts: welcomeTextsIcon,
  verify_vendors: verifyVendorsIcon,
  property_access: propertyAccessIcon,
  property_intelligence: propertyIntelligenceIcon,
  property_insurance: propertyInsuranceIcon,
  maintenance_prefs: maintenancePrefsIcon,
  test_request: testRequestIcon,
}

type GetSetUpForSuccessCardProps = {
  progress: SetupSuccessProgress
  onClose: () => void
  /** Hide for this tab only when a checklist step is started (survives until refresh / Profile setup). */
  onMinimize?: () => void
  /** Deep-link property setup steps to the first property when available. */
  resolveItemTo?: (itemId: SetupSuccessItemId) => string | undefined
  /** Account holder's first name for the title. */
  firstName?: string | null
  /** Shown after Complete information on the Properties page. */
  showPropertyAccessPrompt?: boolean
}

function CloseIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function PropertyAccessPrompt({
  to,
  state,
  onSelect,
  detail,
}: {
  to: string
  state: unknown
  onSelect: () => void
  detail: string | null
}) {
  return (
    <div className="border-b border-[#e2e8f0] px-2 py-2">
      <div className="flex items-start gap-2 rounded-[8px] bg-[#E6F4E9] px-2.5 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#f3f4f6]">
          <span
            aria-hidden
            className="block size-4 bg-[#4b5563]"
            style={{
              WebkitMask: `url("${propertyAccessIcon}") center / contain no-repeat`,
              mask: `url("${propertyAccessIcon}") center / contain no-repeat`,
            }}
          />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold leading-[14px] text-[#1f2937]">
            Add property access so vendors know how to get in.
          </p>
          {detail ? (
            <p className="mt-0.5 text-[10px] font-normal leading-[13px] text-[#6b7280]">{detail}</p>
          ) : null}
          <Link
            to={to}
            state={state}
            onClick={onSelect}
            className="sa-press mt-2 inline-flex rounded-[6px] bg-[#187960] px-2.5 py-1.5 text-[11px] font-semibold leading-[14px] text-white outline-none hover:bg-[#146b54] focus-visible:ring-2 focus-visible:ring-[#187960] focus-visible:ring-offset-2 focus-visible:ring-offset-[#E6F4E9]"
          >
            Add details
          </Link>
        </div>
      </div>
    </div>
  )
}

function SetupChecklist({
  progress,
  resolveItemTo,
  onActionItemSelect,
  showPropertyAccessPrompt = false,
}: {
  progress: SetupSuccessProgress
  resolveItemTo?: (itemId: SetupSuccessItemId) => string | undefined
  /** Minimize the card when the landlord starts an action item. */
  onActionItemSelect?: () => void
  showPropertyAccessPrompt?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[#e2e8f0]">
      {progress.items.map((item, index) => {
        const rowClass = `sa-stagger sa-row flex items-center justify-between gap-2 py-2 pl-2 pr-2.5 ${
          index < progress.items.length - 1 ? 'border-b border-[#e2e8f0]' : ''
        }`
        const rowStyle = { '--sa-stagger': index } as CSSProperties
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#f3f4f6]">
                <span
                  aria-hidden
                  className={`block size-4 ${item.done ? 'bg-[#d1d5db]' : 'bg-[#4b5563]'}`}
                  style={{
                    WebkitMask: `url("${ITEM_ICONS[item.id]}") center / contain no-repeat`,
                    mask: `url("${ITEM_ICONS[item.id]}") center / contain no-repeat`,
                  }}
                />
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-[11px] font-semibold leading-[14px] ${
                    item.done ? 'text-[#9ca3af] line-through' : 'text-[#1f2937]'
                  }`}
                >
                  {item.label}
                </span>
                {item.detail ? (
                  <span className="mt-0.5 block text-[10px] font-normal leading-[13px] text-[#6b7280]">
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </span>
            {item.done ? (
              <span className="sa-enter-scale flex size-4 shrink-0 items-center justify-center rounded-[8px] bg-[#57b769]">
                <img src={checkIcon} alt="" width={8} height={8} className="size-2 max-w-none" />
              </span>
            ) : null}
          </>
        )

        const deepTo = resolveItemTo?.(item.id)?.trim() || undefined
        const to = deepTo ?? item.to
        const detailFollowup =
          deepTo &&
          (item.id === 'property_access' ||
            item.id === 'property_intelligence' ||
            item.id === 'property_insurance')
            ? item.id === 'property_intelligence'
              ? ('property_tab' as const)
              : item.id
            : null
        const linkState = detailFollowup
          ? setupCheckboxGuidePropertyDetailState(detailFollowup)
          : setupCheckboxGuideLinkState(item.id)
        const startItem = () => {
          onActionItemSelect?.()
          if (detailFollowup) armSetupSuccessPropertyDetailGuide(detailFollowup)
          else markSetupSuccessCheckboxGuidePending(item.id)
        }
        const prompt =
          showPropertyAccessPrompt && item.id === 'property_access' ? (
            <PropertyAccessPrompt
              to={to}
              state={linkState}
              onSelect={startItem}
              detail={item.detail}
            />
          ) : null

        if (item.done) {
          return (
            <Fragment key={item.id}>
              {prompt}
              <div className={`${rowClass} cursor-default`} style={rowStyle} aria-disabled="true">
                {body}
              </div>
            </Fragment>
          )
        }

        return (
          <Fragment key={item.id}>
            {prompt}
            <Link
              to={to}
              state={linkState}
              onClick={startItem}
              onPointerDown={() => {
                if (detailFollowup) armSetupSuccessPropertyDetailGuide(detailFollowup)
                else markSetupSuccessCheckboxGuidePending(item.id)
              }}
              className={`sa-press ${rowClass} hover:bg-[#f9fafb] focus-visible:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5]`}
              style={rowStyle}
            >
              {body}
            </Link>
          </Fragment>
        )
      })}
    </div>
  )
}

function SetupProgressBar({ progress }: { progress: SetupSuccessProgress }) {
  const fillPercent = setupSuccessPercent(progress)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 whitespace-nowrap text-[10px] font-semibold leading-[13px]">
        <p className="text-[#4b5563]">
          {progress.doneCount}/{progress.total} completed
        </p>
        <p className="text-[#0d0b26]">{fillPercent}%</p>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-[2px] bg-[#eef2f6]" aria-hidden>
        <div
          className="sa-bar h-full rounded-[2px] bg-[#57b769]"
          style={{ width: `${fillPercent}%` }}
        />
      </div>
      <p className="sr-only">
        {progress.doneCount} of {progress.total} completed, {fillPercent} percent complete
      </p>
    </div>
  )
}

function SetupCopy({
  titleId,
  firstName,
  percent,
}: {
  titleId: string
  firstName?: string | null
  percent: number
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 pr-5">
      <h2
        id={titleId}
        className="sa-enter min-w-0 break-words font-[family-name:var(--font-admin)] text-[13px] font-bold leading-normal text-[#0d0b26]"
      >
        {setupPortfolioHeading(percent, firstName)}
      </h2>
      <p className="sa-enter text-[10px] font-normal leading-[13px] text-[#4b5563]">
        Finish these steps to get Ulo up and running smoothly.
      </p>
    </div>
  )
}

export function GetSetUpForSuccessCard({
  progress,
  onClose,
  onMinimize,
  resolveItemTo,
  firstName,
  showPropertyAccessPrompt = false,
}: GetSetUpForSuccessCardProps) {
  const titleId = useId()

  // Non-modal floating card only — never a full-viewport sheet/scrim.
  // A blocking overlay here sat above the sidebar and killed NavLinks + buttons.
  return (
    <section
      id={TRY_DEMO_SPOTLIGHT_SETUP_SUCCESS_ID}
      className="sa-enter pointer-events-auto fixed bottom-4 left-4 z-40 w-[min(380px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-[#f1f5f9] bg-white p-3 shadow-[0px_8px_24px_rgba(16,24,40,0.12)] transition-[border-color,box-shadow] duration-200 hover:border-[#e5e7eb] hover:shadow-[0px_12px_32px_rgba(16,24,40,0.16)] sm:bottom-6 sm:left-6 lg:left-[calc(16rem+1.5rem)]"
      aria-labelledby={titleId}
      data-setup-success-card=""
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="sa-press absolute right-2 top-2 z-10 rounded-md p-0.5 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
      >
        <CloseIcon />
      </button>
      <div
        className="-mx-3 -mt-3 px-3 pb-3 pt-3"
        style={{
          backgroundColor: '#ffffff',
          backgroundImage:
            'conic-gradient(from 45deg at 50% 50%, #ffffff, #f0fdf4, #ffffff, #f0fdf4, #ffffff)',
        }}
      >
        <SetupCopy titleId={titleId} firstName={firstName} percent={setupSuccessPercent(progress)} />
        <div className="mt-2.5">
          <SetupProgressBar progress={progress} />
        </div>
      </div>
      <div className="mt-2.5">
        <SetupChecklist
          progress={progress}
          resolveItemTo={resolveItemTo}
          showPropertyAccessPrompt={showPropertyAccessPrompt}
          onActionItemSelect={onMinimize ?? onClose}
        />
      </div>
    </section>
  )
}

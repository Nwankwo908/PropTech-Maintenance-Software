import { useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { AdminUloNotificationsBell } from '@/components/AdminUloNotificationsBell'
import { AdminUniversalSearch } from '@/components/AdminUniversalSearch'
import { AskUloProvider, useAskUlo } from '@/components/AskUloContext'
import { AskUloPanel } from '@/components/AskUloPanel'
import uloLogo from '@/assets/landing/ulo-logo.png'
import { AdminSidebarContent } from '@/components/AdminSidebar'
import { signOutAdmin } from '@/lib/adminAuth'
import {
  getActiveLandlordId,
  getSessionLandlordId,
  isDemoAccountActive,
  LANDLORD_ACCOUNT_OPTIONS,
  setActiveLandlordOverride,
} from '@/lib/activeLandlord'
import { isOnboardingLandlordAccount, restartNewLandlordOnboarding } from '@/lib/landlordOnboarding'
import { supabase } from '@/lib/supabase'

// Sparkle strokes from assets/AI Icon (2).svg, without the purple circle
// background; stroke follows the button text color.
function AiSparkleIcon() {
  return (
    <svg
      viewBox="10 10 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.66667}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <path d="M18.2809 22.9167C18.2065 22.6283 18.0561 22.3651 17.8455 22.1545C17.6349 21.9439 17.3718 21.7936 17.0834 21.7192L11.9709 20.4008C11.8836 20.3761 11.8069 20.3236 11.7522 20.2512C11.6975 20.1789 11.668 20.0907 11.668 20C11.668 19.9093 11.6975 19.8211 11.7522 19.7488C11.8069 19.6765 11.8836 19.6239 11.9709 19.5992L17.0834 18.28C17.3717 18.2057 17.6348 18.0555 17.8454 17.845C18.056 17.6346 18.2063 17.3716 18.2809 17.0833L19.5992 11.9708C19.6237 11.8833 19.6762 11.8061 19.7486 11.7512C19.8211 11.6962 19.9095 11.6665 20.0004 11.6665C20.0914 11.6665 20.1798 11.6962 20.2523 11.7512C20.3247 11.8061 20.3772 11.8833 20.4017 11.9708L21.7192 17.0833C21.7936 17.3717 21.9439 17.6349 22.1545 17.8455C22.3651 18.0561 22.6283 18.2064 22.9167 18.2808L28.0292 19.5983C28.1171 19.6226 28.1946 19.675 28.2499 19.7476C28.3052 19.8201 28.3351 19.9088 28.3351 20C28.3351 20.0912 28.3052 20.1799 28.2499 20.2524C28.1946 20.325 28.1171 20.3774 28.0292 20.4017L22.9167 21.7192C22.6283 21.7936 22.3651 21.9439 22.1545 22.1545C21.9439 22.3651 21.7936 22.6283 21.7192 22.9167L20.4009 28.0292C20.3764 28.1167 20.3239 28.1939 20.2514 28.2489C20.179 28.3038 20.0905 28.3336 19.9996 28.3336C19.9087 28.3336 19.8202 28.3038 19.7478 28.2489C19.6754 28.1939 19.6229 28.1167 19.5984 28.0292L18.2809 22.9167Z" />
      <path d="M26.6666 12.5V15.8333" />
      <path d="M28.3333 14.1667H25" />
      <path d="M13.3334 24.1667V25.8333" />
      <path d="M14.1667 25H12.5" />
    </svg>
  )
}

function AdminHeaderActions({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="flex shrink-0 items-center gap-2">
      <AdminUloNotificationsBell onNavigate={onNavigate} />
      {supabase ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[13px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
          onClick={async (e) => {
            e.stopPropagation()
            await signOutAdmin()
            onNavigate?.()
            navigate('/admin/login', { replace: true })
          }}
        >
          Sign out
        </button>
      ) : null}
    </div>
  )
}

function AdminTopBar() {
  const { open, openAskUlo } = useAskUlo()
  const [resettingOnboarding, setResettingOnboarding] = useState(false)

  async function handleResetOnboarding() {
    if (resettingOnboarding) return
    setResettingOnboarding(true)
    try {
      const result = await restartNewLandlordOnboarding()
      if (!result.ok) {
        console.error('[AdminLayout] reset onboarding failed', result.error)
        window.alert(result.error ?? 'Could not reset onboarding.')
        setResettingOnboarding(false)
        return
      }
    } catch (err) {
      console.error('[AdminLayout] reset onboarding failed', err)
      window.alert(err instanceof Error ? err.message : 'Could not reset onboarding.')
      setResettingOnboarding(false)
      return
    }
    // Hard reload so wizard + guard remount on cleared not_started state.
    window.location.assign('/admin/onboarding')
  }

  return (
    <header className="sticky top-0 z-10 hidden h-[68px] shrink-0 items-center border-b border-[#e5e7eb] bg-white px-8 lg:flex">
      <div className="flex w-full items-center gap-4">
        <AdminUniversalSearch />
        <button
          type="button"
          title="Ulo AI assistant"
          aria-pressed={open}
          onClick={() => openAskUlo()}
          className={[
            'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[10px] border border-[#B4DFD6] px-4 text-center text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0A4D38] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#0A4D38] focus-visible:ring-offset-2',
            open
              ? 'bg-[#0A4D38]/10'
              : 'bg-transparent hover:bg-[#0A4D38]/5 active:bg-[#0A4D38]/10',
          ].join(' ')}
        >
          <AiSparkleIcon />
          Ask Ulo AI
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-4">
        {isDemoAccountActive() ? (
          <span className="shrink-0 rounded-full bg-[#fef9c2] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#a65f00]">
            Demo data
          </span>
        ) : isOnboardingLandlordAccount() ? (
          <>
            <button
              type="button"
              disabled={resettingOnboarding}
              className="shrink-0 cursor-pointer rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828]/20 disabled:cursor-wait disabled:opacity-60"
              onClick={() => {
                void handleResetOnboarding()
              }}
            >
              {resettingOnboarding ? 'Resetting…' : 'Reset onboarding'}
            </button>
            <span className="shrink-0 rounded-full bg-[#dbeafe] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#1d4ed8]">
              New Landlord
            </span>
          </>
        ) : (
          <span className="shrink-0 rounded-full bg-[#f3f4f6] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#4b5563]">
            Ulo Operations
          </span>
        )}
        {getSessionLandlordId() === null ? (
          <label className="flex shrink-0 items-center gap-2 text-[12px] text-[#6a7282]">
            Account
            <select
              value={getActiveLandlordId()}
              onChange={(e) => setActiveLandlordOverride(e.target.value)}
              className="h-9 cursor-pointer rounded-[10px] border border-[#e5e7eb] bg-white px-2 text-[13px] text-[#101828] outline-none focus-visible:ring-2 focus-visible:ring-[#101828]/20"
              aria-label="Switch landlord account"
            >
              {LANDLORD_ACCOUNT_OPTIONS.map((opt) => (
                <option key={opt.kind} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <AdminHeaderActions />
        </div>
      </div>
    </header>
  )
}

function AdminMainContent() {
  const { open, docked, closeAskUlo } = useAskUlo()

  if (!open) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-white">
        <Outlet />
      </div>
    )
  }

  if (docked) {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden bg-white">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
          <Outlet />
        </div>
        <aside
          className="ask-ulo-rail-enter relative z-20 flex h-full w-[min(100%,440px)] shrink-0 flex-col border-l border-[#e5e7eb] bg-white shadow-[-8px_0_24px_rgba(16,24,40,0.06)]"
          aria-label="Ask Ulo"
        >
          <AskUloPanel onClose={closeAskUlo} variant="rail" />
        </aside>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <AskUloPanel onClose={closeAskUlo} variant="full" />
    </div>
  )
}

export function AdminLayout() {
  const mobileNavRef = useRef<HTMLDetailsElement>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)

  return (
    <AskUloProvider>
      <div className="flex h-dvh max-h-dvh w-full overflow-hidden bg-[#f9fafb] font-[family-name:var(--font-admin)]">
        <aside
          className={[
            'relative z-20 hidden h-dvh max-h-dvh shrink-0 border-r border-[#e5e7eb] bg-white transition-[width] duration-200 ease-out lg:flex lg:flex-col',
            railCollapsed ? 'w-[72px]' : 'w-64',
          ].join(' ')}
        >
          <AdminSidebarContent
            forRail
            collapsed={railCollapsed}
            onCollapse={() => setRailCollapsed(true)}
            onExpand={() => setRailCollapsed(false)}
          />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <details
            ref={mobileNavRef}
            className="group shrink-0 border-b border-[#e5e7eb] bg-white lg:hidden"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-8 py-8 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <img
                  src={uloLogo}
                  alt="Ulo Home"
                  className="h-8 w-auto shrink-0 object-contain"
                />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#101828]">
                    Admin Panel
                  </p>
                  <p className="text-[11px] text-[#6a7282]">Property Mgmt</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <AdminHeaderActions
                  onNavigate={() => mobileNavRef.current?.removeAttribute('open')}
                />
                <span className="shrink-0 text-[12px] font-medium text-[#364153] group-open:rotate-180">
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M6 9l6 6 6-6" strokeWidth={2} />
                </svg>
                </span>
              </div>
            </summary>
            <div className="flex max-h-[min(70dvh,520px)] flex-col overflow-hidden border-t border-[#e5e7eb]">
              <AdminSidebarContent
                onNavigate={() => mobileNavRef.current?.removeAttribute('open')}
              />
            </div>
          </details>

          <AdminTopBar />
          <AdminMainContent />
        </div>
      </div>
    </AskUloProvider>
  )
}

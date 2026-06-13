import { NavLink, useNavigate } from 'react-router-dom'
import uloLogo from '@/assets/landing/ulo-logo.png'
import { SIDEBAR_ADMIN_PROFILE } from '@/constants/sidebarAdminProfile'
import { signOutAdmin } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

const navBase =
  'flex min-h-[44px] w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-[10px] px-4 text-left text-[14px] font-medium tracking-[-0.1504px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2 focus-visible:ring-offset-white'

function navClassName({ isActive }: { isActive: boolean }) {
  return [
    navBase,
    isActive
      ? 'bg-[#101828]/8 text-[#101828]'
      : 'text-[#364153] hover:bg-[#f3f4f6] active:bg-[#e5e7eb]',
  ].join(' ')
}

function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  )
}

function RequestsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h4" strokeLinecap="round" />
    </svg>
  )
}

function OperationsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M4 7h16M4 12h10M4 17h14" strokeLinecap="round" />
      <circle cx="18" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CommunicationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

function ResidentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
    </svg>
  )
}

function ResidentPortalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AdminSidebarContent({
  onNavigate,
  forRail,
}: {
  onNavigate?: () => void
  forRail?: boolean
}) {
  const navigate = useNavigate()
  const gutter = forRail ? 'px-6 py-4' : 'px-8 py-8'
  const navPad = forRail ? 'px-4 pt-6 pb-4' : 'px-8 py-8'
  const footerPad = forRail ? 'p-4' : 'px-8 py-8'

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className={`shrink-0 border-b border-[#e5e7eb] ${gutter}`}>
        <div className="flex items-center gap-3">
          <img
            src={uloLogo}
            alt="Ulo Home"
            className="h-9 w-auto shrink-0 object-contain"
          />
        </div>
      </div>

      <nav
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain ${navPad}`}
        aria-label="Admin"
      >
        <NavLink to="/admin" end onClick={onNavigate} className={navClassName}>
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <OverviewIcon />
          </span>
          Overview
        </NavLink>
        <NavLink to="/admin/requests" onClick={onNavigate} className={navClassName}>
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <RequestsIcon />
          </span>
          Properties
        </NavLink>
        <NavLink to="/admin/workflows" onClick={onNavigate} className={navClassName}>
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <OperationsIcon />
          </span>
          Operations
        </NavLink>
        <NavLink to="/admin/notifications" onClick={onNavigate} className={navClassName}>
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <CommunicationIcon />
          </span>
          Communication
        </NavLink>
        <NavLink to="/admin/users" onClick={onNavigate} className={navClassName}>
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <ResidentsIcon />
          </span>
          Residents
        </NavLink>
      </nav>

      <div className={`shrink-0 border-t border-[#e5e7eb] bg-white ${footerPad}`}>
        <NavLink
          to="/request"
          onClick={onNavigate}
          className={`${navBase} text-[#364153] hover:bg-[#f3f4f6] active:bg-[#e5e7eb]`}
        >
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <ResidentPortalIcon />
          </span>
          Resident Portal
        </NavLink>

        <div className="mt-3 flex w-full min-w-0 items-center gap-3 rounded-[10px] px-3 py-2">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#101828] text-[12px] font-semibold leading-none tracking-[-0.02em] text-white"
            aria-hidden
          >
            {SIDEBAR_ADMIN_PROFILE.initials}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[13px] font-semibold tracking-[-0.1504px] text-[#101828]">
              {SIDEBAR_ADMIN_PROFILE.name}
            </p>
            <p className="truncate text-[12px] leading-4 text-[#6a7282]">
              {SIDEBAR_ADMIN_PROFILE.email}
            </p>
          </div>
          {supabase ? (
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-[8px] border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#364153] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
              onClick={async () => {
                await signOutAdmin()
                onNavigate?.()
                navigate('/admin/login', { replace: true })
              }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

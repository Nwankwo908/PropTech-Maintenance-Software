import { NavLink, useNavigate } from 'react-router-dom'
import homeIcon from '@/assets/Home Icon.svg'
import requestServiceIcon from '@/assets/Request_Service_2.svg'
import { SIDEBAR_ADMIN_PROFILE } from '@/constants/sidebarAdminProfile'
import { signOutAdmin } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

const navBase =
  'flex min-h-[44px] w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-[10px] px-4 text-left text-[14px] font-medium tracking-[-0.1504px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 focus-visible:ring-offset-white'

export function AdminSidebarContent({
  onNavigate,
  forRail,
}: {
  onNavigate?: () => void
  forRail?: boolean
}) {
  const navigate = useNavigate()
  const gutter = forRail ? 'px-6 py-5' : 'px-8 py-8'
  const navPad = forRail ? 'p-4' : 'px-8 py-8'
  const footerPad = forRail ? 'p-4' : 'px-8 py-8'

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className={`shrink-0 border-b border-[#e5e7eb] ${gutter}`}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#101828]">
            <img src={homeIcon} alt="" className="size-10 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-[#101828]">
              Admin Panel
            </p>
            <p className="text-[12px] leading-4 text-[#6a7282]">Property Mgmt</p>
          </div>
        </div>
      </div>

      <nav
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain ${navPad}`}
        aria-label="Admin"
      >
        <NavLink
          to="/admin"
          end
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              navBase,
              isActive
                ? 'bg-[#101828] text-white hover:bg-[#475467] active:bg-[#0c111d]'
                : 'text-[#364153] hover:bg-[#e5e7eb] active:bg-[#d1d5dc]',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                <img
                  src={requestServiceIcon}
                  alt=""
                  className={[
                    'size-5 object-contain transition-[filter]',
                    isActive ? 'brightness-0 invert' : 'brightness-0',
                  ].join(' ')}
                />
              </span>
              Request Management
            </>
          )}
        </NavLink>
        <NavLink
          to="/admin/notifications"
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              navBase,
              isActive
                ? 'bg-[#101828] text-white hover:bg-[#475467] active:bg-[#0c111d]'
                : 'text-[#364153] hover:bg-[#e5e7eb] active:bg-[#d1d5dc]',
            ].join(' ')
          }
        >
          <span className="size-5 shrink-0" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
            </svg>
          </span>
          Notification Management
        </NavLink>
        <NavLink
          to="/admin/users"
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              navBase,
              isActive
                ? 'bg-[#101828] text-white hover:bg-[#475467] active:bg-[#0c111d]'
                : 'text-[#364153] hover:bg-[#e5e7eb] active:bg-[#d1d5dc]',
            ].join(' ')
          }
        >
          <span className="size-5 shrink-0 text-current" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
          </span>
          User Management
        </NavLink>
      </nav>

      <div
        className={`shrink-0 border-t border-[#e5e7eb] bg-white ${footerPad}`}
      >
        <div className="flex w-full min-w-0 items-center gap-3 rounded-[10px] px-3 py-2.5">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#944c73] text-[13px] font-semibold leading-none tracking-[-0.02em] text-white shadow-sm"
            aria-hidden
          >
            {SIDEBAR_ADMIN_PROFILE.initials}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
              {SIDEBAR_ADMIN_PROFILE.name}
            </p>
            <p className="mt-0.5 truncate text-[12px] leading-4 text-[#6a7282]">
              {SIDEBAR_ADMIN_PROFILE.email}
            </p>
            <p className="mt-1 text-[11px] font-medium leading-4 text-[#944c73]">
              Admin Portal
            </p>
          </div>
        </div>
        {supabase ? (
          <button
            type="button"
            className="mt-3 w-full cursor-pointer rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2.5 text-left text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-colors duration-150 hover:border-[#d1d5dc] hover:bg-[#e5e7eb] active:border-[#d1d5dc] active:bg-[#d1d5dc] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
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
  )
}

import { NavLink, useNavigate } from 'react-router-dom'
import heroLogo from '@/assets/Hero_Logo.svg'
import requestServiceIcon from '@/assets/Request_Service_2.svg'
import { SIDEBAR_ADMIN_PROFILE } from '@/constants/sidebarAdminProfile'
import { signOutAdmin } from '@/lib/adminAuth'
import { supabase } from '@/lib/supabase'

const navBase =
  'flex min-h-[44px] w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-[10px] px-4 text-left text-[14px] font-medium tracking-[-0.1504px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white'

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
      <div className={`shrink-0 border-b border-secondary ${gutter}`}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-3">
            <img src={heroLogo} alt="" className="size-10 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-extended-3">
              Admin Panel
            </p>
            <p className="text-[12px] leading-4 text-neutral">Property Mgmt</p>
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
                ? 'bg-[#ffee6c] text-[#b58500]'
                : 'text-neutral-variant hover:bg-secondary active:bg-secondary',
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
                    'size-5 object-contain transition-opacity',
                    isActive
                      ? 'opacity-100 [filter:brightness(0)_saturate(100%)_invert(53%)_sepia(63%)_saturate(1050%)_hue-rotate(18deg)_brightness(96%)_contrast(95%)]'
                      : 'opacity-55 brightness-0',
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
                ? 'bg-[#ffee6c] text-[#b58500]'
                : 'text-neutral-variant hover:bg-secondary active:bg-secondary',
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
                ? 'bg-[#ffee6c] text-[#b58500]'
                : 'text-neutral-variant hover:bg-secondary active:bg-secondary',
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
        className={`shrink-0 border-t border-secondary bg-white ${footerPad}`}
      >
        <div className="flex w-full min-w-0 items-center gap-3 rounded-[10px] px-3 py-2.5">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#00b585] text-[13px] font-semibold leading-none tracking-[-0.02em] text-black shadow-sm"
            aria-hidden
          >
            {SIDEBAR_ADMIN_PROFILE.initials}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[14px] font-semibold tracking-[-0.1504px] text-extended-3">
              {SIDEBAR_ADMIN_PROFILE.name}
            </p>
            <p className="mt-0.5 truncate text-[12px] leading-4 text-neutral">
              {SIDEBAR_ADMIN_PROFILE.email}
            </p>
            <p className="mt-1 text-[11px] font-medium leading-4 text-primary">
              Admin Portal
            </p>
          </div>
        </div>
        {supabase ? (
          <button
            type="button"
            className="mt-3 w-full cursor-pointer rounded-[10px] border border-secondary bg-white px-3 py-2.5 text-left text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant outline-none transition-colors duration-150 hover:border-secondary hover:bg-secondary active:border-secondary active:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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

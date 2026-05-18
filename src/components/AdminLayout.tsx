import { useRef } from 'react'
import { Outlet } from 'react-router-dom'
import heroLogo from '@/assets/Hero_Logo.svg'
import { AdminSidebarContent } from '@/components/AdminSidebar'

export function AdminLayout() {
  const mobileNavRef = useRef<HTMLDetailsElement>(null)

  return (
    <div className="flex min-h-dvh w-full bg-secondary font-sans">
      <div
        className="w-[8px] shrink-0 self-stretch bg-[#0030b5]"
        aria-hidden
      />
      <aside className="relative z-20 hidden h-dvh max-h-dvh w-72 shrink-0 border-r border-secondary bg-white lg:sticky lg:top-0 lg:flex lg:flex-col">
        <AdminSidebarContent forRail />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <details
          ref={mobileNavRef}
          className="group border-b border-secondary bg-white lg:hidden"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-8 py-8 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-extended-3">
                <img src={heroLogo} alt="" className="size-4 object-contain" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-extended-3">
                  Admin Panel
                </p>
                <p className="text-[11px] text-neutral">Property Mgmt</p>
              </div>
            </div>
            <span className="shrink-0 text-[12px] font-medium text-neutral-variant group-open:rotate-180">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 9l6 6 6-6" strokeWidth={2} />
              </svg>
            </span>
          </summary>
          <div className="flex max-h-[min(70dvh,520px)] flex-col overflow-hidden border-t border-secondary">
            <AdminSidebarContent
              onNavigate={() => mobileNavRef.current?.removeAttribute('open')}
            />
          </div>
        </details>

        <Outlet />
      </div>
    </div>
  )
}

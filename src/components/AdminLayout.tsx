import { useRef } from 'react'
import { Outlet } from 'react-router-dom'
import homeIcon from '@/assets/Home Icon.svg'
import { AdminSidebarContent } from '@/components/AdminSidebar'

export function AdminLayout() {
  const mobileNavRef = useRef<HTMLDetailsElement>(null)

  return (
    <div className="flex min-h-dvh w-full bg-[#f3f4f6] font-sans">
      <div
        className="w-[8px] shrink-0 self-stretch bg-[#944c73]"
        aria-hidden
      />
      <aside className="relative z-20 hidden h-dvh max-h-dvh w-72 shrink-0 border-r border-[#e5e7eb] bg-white lg:sticky lg:top-0 lg:flex lg:flex-col">
        <AdminSidebarContent forRail />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <details
          ref={mobileNavRef}
          className="group border-b border-[#e5e7eb] bg-white lg:hidden"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-8 py-8 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#101828]">
                <img src={homeIcon} alt="" className="size-4 object-contain" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[#101828]">
                  Admin Panel
                </p>
                <p className="text-[11px] text-[#6a7282]">Property Mgmt</p>
              </div>
            </div>
            <span className="shrink-0 text-[12px] font-medium text-[#364153] group-open:rotate-180">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 9l6 6 6-6" strokeWidth={2} />
              </svg>
            </span>
          </summary>
          <div className="flex max-h-[min(70dvh,520px)] flex-col overflow-hidden border-t border-[#e5e7eb]">
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

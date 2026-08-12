import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { AdminBillingSettings } from '@/components/AdminBillingSettings'
import { AdminConnectedEmailSettings } from '@/components/AdminConnectedEmailSettings'
import { AdminNotificationSettings } from '@/components/AdminNotificationSettings'
import { AdminOrganizationSettings } from '@/components/AdminOrganizationSettings'
import { getAdminSettingsNavCategories } from '@/lib/adminNavigation'

function settingsCardClassName(active: boolean, interactive: boolean) {
  return [
    'sa-card flex h-full min-h-[104px] flex-col gap-1 rounded-[10px] border bg-white p-6 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] outline-none',
    active
      ? 'border-[#155dfc]'
      : interactive
        ? 'border-[#e5e7eb] hover:border-[#155dfc] focus-visible:border-[#155dfc] focus-visible:ring-2 focus-visible:ring-[#155dfc]/20'
        : 'border-[#e5e7eb]',
    interactive ? 'cursor-pointer' : 'cursor-default',
  ].join(' ')
}

function SettingsCategoryCard({
  category,
  active,
  index = 0,
}: {
  category: ReturnType<typeof getAdminSettingsNavCategories>[number]
  active: boolean
  index?: number
}) {
  const content = (
    <>
      <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
        {category.title}
      </h2>
      <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {category.description}
      </p>
    </>
  )

  const enterClass = 'sa-enter-scale'
  const enterStyle = { animationDelay: `${Math.min(index, 8) * 40}ms` }

  return (
    <Link
      to={category.href}
      className={`${enterClass} ${settingsCardClassName(active, true)}`}
      style={enterStyle}
    >
      {content}
    </Link>
  )
}

function SettingsHome() {
  const { pathname } = useLocation()
  const settingsCategories = getAdminSettingsNavCategories()

  return (
    <>
      <div className="py-6">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
          Settings
        </h1>
        <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          Manage your workspace, team, and Ulo automation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {settingsCategories.map((category, index) => {
          const active =
            (category.activeOnExactPath != null && pathname === category.activeOnExactPath) ||
            pathname.startsWith(category.href)

          return (
            <SettingsCategoryCard
              key={category.id}
              category={category}
              active={active}
              index={index}
            />
          )
        })}
      </div>
    </>
  )
}

export function AdminSettingsDashboard() {
  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <Routes>
        <Route index element={<SettingsHome />} />
        <Route path="organization" element={<AdminOrganizationSettings />} />
        <Route path="billing" element={<AdminBillingSettings />} />
        <Route path="operations/notifications" element={<AdminNotificationSettings />} />
        <Route path="integrations/email" element={<AdminConnectedEmailSettings />} />
      </Routes>
    </main>
  )
}

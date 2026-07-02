import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { AdminBillingSettings } from '@/components/AdminBillingSettings'
import { AdminConnectedEmailSettings } from '@/components/AdminConnectedEmailSettings'
import { AdminNotificationSettings } from '@/components/AdminNotificationSettings'
import { AdminOrganizationSettings } from '@/components/AdminOrganizationSettings'

type SettingsCategory = {
  id: string
  title: string
  description: string
  href?: string
  activeOnExactPath?: string
  comingSoon?: boolean
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'organization',
    title: 'Organization',
    description: 'Company profile, branding, and time zone.',
    href: '/admin/settings/organization',
    activeOnExactPath: '/admin/settings',
  },
  {
    id: 'connected-email',
    title: 'Connected Email',
    description: 'Discover leases, invoices, and inspection reports from your inbox.',
    href: '/admin/settings/integrations/email',
  },
  {
    id: 'billing',
    title: 'Billing',
    description: 'Beta access, subscription details, and future billing.',
    href: '/admin/settings/billing',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Operational alerts by event, channel, and priority.',
    href: '/admin/settings/operations/notifications',
  },
]

function settingsCardClassName(active: boolean, interactive: boolean) {
  return [
    'flex h-full min-h-[104px] flex-col gap-1 rounded-[10px] border bg-white p-6 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] outline-none transition-[border-color,box-shadow] duration-150',
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
}: {
  category: SettingsCategory
  active: boolean
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

  if (category.href) {
    return (
      <Link to={category.href} className={settingsCardClassName(active, true)}>
        {content}
      </Link>
    )
  }

  if (category.comingSoon) {
    return (
      <div
        className={settingsCardClassName(active, false)}
        aria-disabled="true"
        title="Coming soon"
      >
        {content}
      </div>
    )
  }

  return (
    <div className={settingsCardClassName(active, false)} aria-current={active ? 'page' : undefined}>
      {content}
    </div>
  )
}

function SettingsHome() {
  const { pathname } = useLocation()

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
        {SETTINGS_CATEGORIES.map((category) => {
          const active =
            (category.activeOnExactPath != null && pathname === category.activeOnExactPath) ||
            (category.href != null && pathname.startsWith(category.href))

          return (
            <SettingsCategoryCard key={category.id} category={category} active={active} />
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

import { Link, useLocation } from 'react-router-dom'

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
    activeOnExactPath: '/admin/settings',
  },
  {
    id: 'team',
    title: 'Team & roles',
    description: 'Invite operators and configure permissions.',
    href: '/admin/users',
  },
  {
    id: 'ai-copilot',
    title: 'AI copilot',
    description: 'Tune automation thresholds and approval rules.',
    href: '/admin/workflows',
  },
  {
    id: 'integrations',
    title: 'Integrations',
    description: 'Accounting, payments, smart locks, and IoT sensors.',
    comingSoon: true,
  },
  {
    id: 'billing',
    title: 'Billing',
    description: 'Plan, invoices, and payment method.',
    comingSoon: true,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Email, SMS, and push delivery preferences.',
    href: '/admin/notifications',
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

export function AdminSettingsDashboard() {
  const { pathname } = useLocation()

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
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
            category.activeOnExactPath != null
              ? pathname === category.activeOnExactPath
              : category.href != null && pathname.startsWith(category.href)

          return (
            <SettingsCategoryCard key={category.id} category={category} active={active} />
          )
        })}
      </div>
    </main>
  )
}

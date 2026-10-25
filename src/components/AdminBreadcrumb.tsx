import { Fragment } from 'react'
import { Link } from 'react-router-dom'

export type AdminBreadcrumbItem = {
  label: string
  /** Omit on the current page and on labels that are not links. */
  to?: string
  onClick?: () => void
}

const linkClassName =
  'sa-link rounded-sm font-medium hover:text-[#101828] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2'

function Crumbs({ items }: { items: AdminBreadcrumbItem[] }) {
  return items.map((item, index) => {
    const current = index === items.length - 1
    return (
      <Fragment key={`${item.label}-${index}`}>
        {index > 0 ? <span aria-hidden>/</span> : null}
        {!current && item.to ? (
          <Link to={item.to} className={linkClassName} onClick={item.onClick}>
            {item.label}
          </Link>
        ) : (
          <span
            className={current ? 'text-[#101828]' : 'font-medium text-[#6a7282]'}
            {...(current ? { 'aria-current': 'page' as const } : {})}
          >
            {item.label}
          </span>
        )}
      </Fragment>
    )
  })
}

export function AdminBreadcrumb({
  items,
  collapseOnMobile = false,
  className,
}: {
  items: AdminBreadcrumbItem[]
  /** Below 640px, show only the parent as a back link. */
  collapseOnMobile?: boolean
  className?: string
}) {
  if (items.length === 0) return null
  const navClassName = [
    'text-[14px] tracking-[-0.1504px] text-[#6a7282]',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const parent = items.length > 1 ? items[items.length - 2] : null

  if (!collapseOnMobile) {
    return (
      <nav
        className={`flex flex-wrap items-center gap-2 ${navClassName}`}
        aria-label="Breadcrumb"
      >
        <Crumbs items={items} />
      </nav>
    )
  }

  return (
    <nav className={navClassName} aria-label="Breadcrumb">
      {parent?.to ? (
        <Link
          to={parent.to}
          onClick={parent.onClick}
          className={`${linkClassName} block max-w-full truncate whitespace-nowrap sm:hidden`}
        >
          {`← ${parent.label}`}
        </Link>
      ) : null}
      <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <Crumbs items={items} />
      </div>
    </nav>
  )
}

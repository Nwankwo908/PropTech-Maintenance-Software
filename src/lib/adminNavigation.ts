/**
 * Master admin navigation registry — single source for paths, labels, sidebar,
 * universal search shortcuts, and settings hub cards.
 *
 * Routes in App.tsx should stay aligned with `ADMIN_NAV_TREE` (enforced by tests).
 * Entity deep links (property detail, vendor detail) compose paths via `adminNavPath`.
 */

/** Mirrors `UniversalSearchCategory` — kept local to avoid circular imports. */
export type AdminNavSearchCategory =
  | 'property'
  | 'unit'
  | 'resident'
  | 'vendor'
  | 'work_order'
  | 'workflow'
  | 'conversation'
  | 'broadcast'
  | 'document'
  | 'inspection'
  | 'lease_renewal'
  | 'rent_collection'
  | 'report'

export type AdminNavSearchItem = {
  id: string
  category: AdminNavSearchCategory
  title: string
  subtitle: string
  href: string
  keywords: string
}

export type AdminNavId =
  | 'overview'
  | 'onboarding'
  | 'properties'
  | 'property_detail'
  | 'property_resident_detail'
  | 'communication'
  | 'requests'
  | 'vendors'
  | 'vendor_detail'
  | 'workflows'
  | 'residents'
  | 'resident_detail'
  | 'analytics'
  | 'settings'
  | 'settings_organization'
  | 'settings_connected_email'
  | 'settings_billing'
  | 'settings_notifications'

export type AdminNavSurfaces = {
  /** Show in the primary admin sidebar */
  sidebar?: boolean
  /** Include as a static shortcut in universal search */
  search?: boolean
}

export type AdminNavSearchMeta = {
  category: AdminNavSearchCategory
  subtitle: string
  keywords: readonly string[]
  /** Optional search-result title when it should differ from `label` */
  title?: string
}

export type AdminNavNode = {
  id: AdminNavId
  /** Canonical user-facing label */
  label: string
  /** Absolute path (may include :params for dynamic routes) */
  path: string
  /**
   * React Router path segment relative to `/admin` (or parent), used for route audits.
   * Omitted for index/overview.
   */
  routeSegment?: string
  /** Index route under `/admin` */
  index?: boolean
  /** Pass through to NavLink `end` */
  navEnd?: boolean
  surfaces: AdminNavSurfaces
  search?: AdminNavSearchMeta
  /** Settings hub card copy */
  description?: string
  /** When set, mark settings hub card active on this exact pathname */
  activeOnExactPath?: string
  children?: AdminNavNode[]
}

const ADMIN_BASE = '/admin'

/** Full navigation tree — order matches sidebar where applicable. */
export const ADMIN_NAV_TREE: AdminNavNode[] = [
  {
    id: 'overview',
    label: 'Overview',
    path: ADMIN_BASE,
    index: true,
    navEnd: true,
    routeSegment: '',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'report',
      subtitle: 'Portfolio snapshot and items needing attention',
      keywords: ['overview', 'dashboard', 'home', 'today', 'priorities'],
    },
  },
  {
    id: 'onboarding',
    label: 'Setup',
    path: `${ADMIN_BASE}/onboarding`,
    routeSegment: 'onboarding',
    surfaces: { sidebar: false, search: false },
  },
  {
    id: 'properties',
    label: 'Properties',
    path: `${ADMIN_BASE}/properties`,
    routeSegment: 'properties',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'property',
      subtitle: 'Buildings, units, and property operations',
      keywords: ['properties', 'buildings', 'portfolio', 'units'],
    },
    children: [
      {
        id: 'property_detail',
        label: 'Property',
        path: `${ADMIN_BASE}/properties/:propertySlug`,
        routeSegment: 'properties/:propertySlug',
        surfaces: { sidebar: false, search: false },
        children: [
          {
        id: 'property_resident_detail',
        label: 'Resident',
        path: `${ADMIN_BASE}/properties/:propertySlug/residents/:residentId`,
        routeSegment: 'properties/:propertySlug/residents/:residentId',
            surfaces: { sidebar: false, search: false },
          },
        ],
      },
    ],
  },
  {
    id: 'communication',
    label: 'Messages',
    path: `${ADMIN_BASE}/communication`,
    routeSegment: 'communication',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'conversation',
      subtitle: 'SMS inbox and resident or vendor threads',
      keywords: ['communication', 'inbox', 'messages', 'sms', 'threads', 'conversations'],
    },
  },
  {
    id: 'vendors',
    label: 'Vendors',
    path: `${ADMIN_BASE}/vendors`,
    routeSegment: 'vendors',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'vendor',
      subtitle: 'Preferred vendor network and verification',
      keywords: ['vendors', 'contractors', 'trades', 'verification'],
    },
    children: [
      {
        id: 'vendor_detail',
        label: 'Vendor',
        path: `${ADMIN_BASE}/vendors/:vendorId`,
        routeSegment: 'vendors/:vendorId',
        surfaces: { sidebar: false, search: false },
      },
    ],
  },
  {
    id: 'workflows',
    label: 'Active Tasks',
    path: `${ADMIN_BASE}/workflows`,
    routeSegment: 'workflows',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'workflow',
      title: 'Active Tasks',
      subtitle: 'Workflow pipeline and operational tasks',
      keywords: ['workflows', 'tasks', 'pipeline', 'operations', 'active tasks'],
    },
  },
  {
    id: 'residents',
    label: 'Residents',
    path: `${ADMIN_BASE}/residents`,
    routeSegment: 'residents',
    navEnd: true,
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'resident',
      subtitle: 'Tenant roster, leases, and activation',
      keywords: ['residents', 'tenants', 'users', 'leases'],
    },
    children: [
      {
        id: 'resident_detail',
        label: 'Resident',
        path: `${ADMIN_BASE}/residents/:residentId`,
        routeSegment: 'residents/:residentId',
        surfaces: { sidebar: false, search: false },
      },
    ],
  },
  {
    id: 'requests',
    label: 'Requests',
    path: `${ADMIN_BASE}/requests`,
    routeSegment: 'requests',
    surfaces: { sidebar: false, search: true },
    search: {
      category: 'work_order',
      subtitle: 'Maintenance request queue and triage',
      keywords: ['requests', 'maintenance', 'tickets', 'work orders', 'triage'],
    },
  },
  {
    id: 'analytics',
    label: 'Analytics',
    path: `${ADMIN_BASE}/analytics`,
    routeSegment: 'analytics',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'report',
      title: 'Reports & Analytics',
      subtitle: 'Portfolio performance and operational metrics',
      keywords: ['reports', 'analytics', 'dashboard', 'metrics', 'performance', 'insights', 'charts'],
    },
  },
  {
    id: 'settings',
    label: 'Settings',
    path: `${ADMIN_BASE}/settings`,
    routeSegment: 'settings/*',
    surfaces: { sidebar: true, search: true },
    search: {
      category: 'report',
      subtitle: 'Organization, billing, integrations, and notifications',
      keywords: ['settings', 'organization', 'billing', 'notifications', 'email', 'integrations'],
    },
    children: [
      {
        id: 'settings_organization',
        label: 'Organization',
        path: `${ADMIN_BASE}/settings/organization`,
        routeSegment: 'settings/organization',
        description: 'Company profile, branding, and time zone.',
        activeOnExactPath: `${ADMIN_BASE}/settings`,
        surfaces: { sidebar: false, search: true },
        search: {
          category: 'report',
          subtitle: 'Company profile, branding, and time zone',
          keywords: ['organization', 'company', 'profile', 'branding', 'timezone'],
        },
      },
      {
        id: 'settings_connected_email',
        label: 'Connected Email',
        path: `${ADMIN_BASE}/settings/integrations/email`,
        routeSegment: 'settings/integrations/email',
        description: 'Discover leases, invoices, and inspection reports from your inbox.',
        surfaces: { sidebar: false, search: true },
        search: {
          category: 'report',
          subtitle: 'Email integration for leases, invoices, and inspections',
          keywords: ['email', 'connected email', 'inbox', 'integrations', 'leases'],
        },
      },
      {
        id: 'settings_billing',
        label: 'Billing',
        path: `${ADMIN_BASE}/settings/billing`,
        routeSegment: 'settings/billing',
        description: 'Beta access, subscription details, and future billing.',
        surfaces: { sidebar: false, search: true },
        search: {
          category: 'report',
          subtitle: 'Subscription and billing preferences',
          keywords: ['billing', 'subscription', 'payment', 'beta'],
        },
      },
      {
        id: 'settings_notifications',
        label: 'Notifications',
        path: `${ADMIN_BASE}/settings/operations/notifications`,
        routeSegment: 'settings/operations/notifications',
        description: 'Operational alerts by event, channel, and priority.',
        surfaces: { sidebar: false, search: true },
        search: {
          category: 'report',
          subtitle: 'Alert channels and notification preferences',
          keywords: ['notifications', 'alerts', 'sms', 'email', 'operations'],
        },
      },
    ],
  },
]

export type AdminSidebarNavItem = {
  id: AdminNavId
  to: string
  label: string
  end?: boolean
}

export type AdminSettingsNavCategory = {
  id: AdminNavId
  title: string
  description: string
  href: string
  activeOnExactPath?: string
}

function flattenAdminNav(nodes: AdminNavNode[] = ADMIN_NAV_TREE): AdminNavNode[] {
  const out: AdminNavNode[] = []
  for (const node of nodes) {
    out.push(node)
    if (node.children?.length) {
      out.push(...flattenAdminNav(node.children))
    }
  }
  return out
}

const ADMIN_NAV_FLAT = flattenAdminNav()

const ADMIN_NAV_BY_ID = new Map<AdminNavId, AdminNavNode>(
  ADMIN_NAV_FLAT.map((node) => [node.id, node]),
)

/** All registered nodes (flat). */
export function getAdminNavNodes(): readonly AdminNavNode[] {
  return ADMIN_NAV_FLAT
}

/** Lookup a node by id — throws in dev if missing (returns fallback path in prod). */
export function getAdminNavNode(id: AdminNavId): AdminNavNode {
  const node = ADMIN_NAV_BY_ID.get(id)
  if (!node) {
    throw new Error(`Unknown admin nav id: ${id}`)
  }
  return node
}

/** Canonical absolute path for a registered nav id. */
export function adminNavPath(id: AdminNavId): string {
  return getAdminNavNode(id).path
}

/** Canonical label for a registered nav id. */
export function adminNavLabel(id: AdminNavId): string {
  return getAdminNavNode(id).label
}

/** Primary sidebar items derived from the master list. */
export function getAdminSidebarNavItems(): AdminSidebarNavItem[] {
  return ADMIN_NAV_FLAT.filter((node) => node.surfaces.sidebar).map((node) => ({
    id: node.id,
    to: node.path,
    label: node.label,
    end: node.navEnd,
  }))
}

/** Settings hub cards derived from settings children. */
export function getAdminSettingsNavCategories(): AdminSettingsNavCategory[] {
  const settings = getAdminNavNode('settings')
  return (settings.children ?? []).map((child) => ({
    id: child.id,
    title: child.label,
    description: child.description ?? '',
    href: child.path,
    activeOnExactPath: child.activeOnExactPath,
  }))
}

function buildSearchKeywords(node: AdminNavNode): string {
  const parts = [
    node.label,
    node.search?.title,
    node.search?.subtitle,
    ...(node.search?.keywords ?? []),
  ]
  return parts
    .map((part) => part?.trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
}

/** Static universal-search shortcuts derived from the master list. */
export function getAdminNavSearchItems(): AdminNavSearchItem[] {
  return ADMIN_NAV_FLAT.filter((node) => node.surfaces.search && node.search).map((node) => ({
    id: `nav-${node.id}`,
    category: node.search!.category,
    title: node.search!.title ?? node.label,
    subtitle: node.search!.subtitle,
    href: node.path.includes(':') ? node.path.replace(/:[^/]+/g, '') : node.path,
    keywords: buildSearchKeywords(node),
  }))
}

/**
 * React Router segments under `/admin` for consistency audits.
 * Wildcard settings uses `settings/*`; dynamic segments keep `:param` form.
 */
export function getAdminRouteSegmentsForAudit(): string[] {
  const segments: string[] = []
  function walk(nodes: AdminNavNode[]) {
    for (const node of nodes) {
      if (node.routeSegment != null) {
        segments.push(node.routeSegment)
      }
      if (node.children?.length) walk(node.children)
    }
  }
  walk(ADMIN_NAV_TREE)
  return segments
}

/** Best-effort match of pathname to a registered nav node (longest prefix). */
export function matchAdminNavPath(pathname: string): AdminNavNode | null {
  const normalized = pathname.replace(/\/+$/, '') || ADMIN_BASE
  let best: AdminNavNode | null = null
  for (const node of ADMIN_NAV_FLAT) {
    const nodePath = node.path.replace(/:[^/]+/g, '')
    if (normalized === node.path || normalized.startsWith(`${node.path}/`)) {
      if (!best || node.path.length > best.path.length) best = node
      continue
    }
    if (node.path.includes(':') && normalized.startsWith(nodePath)) {
      if (!best || nodePath.length > best.path.replace(/:[^/]+/g, '').length) best = node
    }
  }
  if (normalized === ADMIN_BASE) {
    return getAdminNavNode('overview')
  }
  return best
}

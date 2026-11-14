import { afterEach, describe, expect, it } from 'vitest'
import { setSessionLandlordFromEmail } from '@/lib/activeLandlord'
import {
  ADMIN_NAV_TREE,
  adminNavPath,
  getAdminNavNodes,
  getAdminNavSearchItems,
  getAdminRouteSegmentsForAudit,
  getAdminSettingsNavCategories,
  getAdminSidebarNavGroups,
  getAdminSidebarNavItems,
} from '@/lib/adminNavigation'

/** Segments registered under `<Route path="/admin">` in App.tsx (keep in sync). */
const APP_ADMIN_ROUTE_SEGMENTS = [
  '',
  'onboarding',
  'properties',
  'properties/:propertySlug',
  'properties/:propertySlug/residents/:residentId',
  'communication',
  'requests',
  'vendors',
  'vendors/:vendorId',
  'workflows',
  'residents',
  'residents/:residentId',
  'analytics',
  'ops',
  'settings/*',
  'settings/organization',
  'settings/billing',
  'settings/operations/notifications',
  'settings/integrations/email',
]

describe('adminNavigation registry', () => {
  afterEach(() => {
    setSessionLandlordFromEmail(null)
  })

  it('uses unique nav ids', () => {
    const ids = getAdminNavNodes().map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses unique absolute paths', () => {
    const paths = getAdminNavNodes().map((node) => node.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('derives sidebar items only from sidebar-enabled nodes', () => {
    const sidebar = getAdminSidebarNavItems()
    expect(sidebar.length).toBeGreaterThan(0)
    for (const item of sidebar) {
      const node = getAdminNavNodes().find((n) => n.id === item.id)
      expect(node?.surfaces.sidebar).toBe(true)
      expect(item.to).toBe(node?.path)
      expect(item.label).toBe(node?.label)
    }
  })

  it('derives search shortcuts with valid hrefs (no route params)', () => {
    for (const item of getAdminNavSearchItems()) {
      expect(item.href).not.toMatch(/:/)
      expect(item.href.startsWith('/admin')).toBe(true)
      expect(item.title.trim().length).toBeGreaterThan(0)
      expect(item.keywords.trim().length).toBeGreaterThan(0)
    }
  })

  it('derives settings hub cards from settings children', () => {
    const categories = getAdminSettingsNavCategories()
    // Billing is omitted when the active landlord lacks payments capability.
    expect(categories.length).toBeGreaterThanOrEqual(3)
    expect(categories.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'settings_organization',
        'settings_connected_email',
        'settings_notifications',
      ]),
    )
    for (const category of categories) {
      expect(category.href.startsWith(adminNavPath('settings'))).toBe(true)
      expect(category.title.length).toBeGreaterThan(0)
      expect(category.description.length).toBeGreaterThan(0)
    }
  })

  it('matches App.tsx admin route segments', () => {
    const registrySegments = getAdminRouteSegmentsForAudit().sort()
    const appSegments = [...APP_ADMIN_ROUTE_SEGMENTS].sort()
    expect(registrySegments).toEqual(appSegments)
  })

  it('exposes canonical paths via adminNavPath', () => {
    expect(adminNavPath('overview')).toBe('/admin')
    expect(adminNavPath('workflows')).toBe('/admin/workflows')
    expect(adminNavPath('communication')).toBe('/admin/communication')
    expect(adminNavPath('settings_notifications')).toBe(
      '/admin/settings/operations/notifications',
    )
  })

  it('keeps top-level tree order aligned with sidebar order', () => {
    const sidebarIds = getAdminSidebarNavItems().map((item) => item.id)
    const treeSidebarIds = ADMIN_NAV_TREE.filter(
      (node) => node.surfaces.sidebar && !node.staffOnly,
    ).map(
      (node) => node.id,
    )
    expect(sidebarIds).toEqual(treeSidebarIds)
    expect(sidebarIds).toEqual([
      'overview',
      'workflows',
      'communication',
      'properties',
      'residents',
      'vendors',
      'analytics',
      'settings',
    ])
  })

  it('exposes labeled primary groups with Settings separated', () => {
    const { groups, settings } = getAdminSidebarNavGroups()
    expect(groups.map((group) => group.id)).toEqual([
      'overview',
      'work',
      'people',
      'insights',
    ])
    expect(groups.map((group) => group.label)).toEqual([
      'Overview',
      'Work',
      'People & Properties',
      'Insights',
    ])
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['overview'],
      ['workflows', 'communication'],
      ['properties', 'residents', 'vendors'],
      ['analytics'],
    ])
    expect(settings?.id).toBe('settings')
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).not.toContain(
      'settings',
    )
  })

  it('shows Ulo Ops only to platform staff', () => {
    setSessionLandlordFromEmail('ceorentalsnj@gmail.com')
    expect(getAdminSidebarNavItems().map((item) => item.id)).not.toContain('staff_ops')
    expect(getAdminNavSearchItems().map((item) => item.id)).not.toContain('nav-staff_ops')

    setSessionLandlordFromEmail('emeka@ulohome.io')
    const { groups } = getAdminSidebarNavGroups()
    expect(groups.find((group) => group.id === 'insights')?.items.map((item) => item.id)).toEqual([
      'analytics',
      'staff_ops',
    ])
    expect(getAdminNavSearchItems().map((item) => item.id)).toContain('nav-staff_ops')
    expect(adminNavPath('staff_ops')).toBe('/admin/ops')
  })
})

import { describe, expect, it } from 'vitest'
import {
  ADMIN_NAV_TREE,
  adminNavPath,
  getAdminNavNodes,
  getAdminNavSearchItems,
  getAdminRouteSegmentsForAudit,
  getAdminSettingsNavCategories,
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
  'analytics',
  'settings/*',
  'settings/organization',
  'settings/billing',
  'settings/operations/notifications',
  'settings/integrations/email',
]

describe('adminNavigation registry', () => {
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
    expect(categories.length).toBe(4)
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
    const treeSidebarIds = ADMIN_NAV_TREE.filter((node) => node.surfaces.sidebar).map(
      (node) => node.id,
    )
    expect(sidebarIds).toEqual(treeSidebarIds)
  })
})

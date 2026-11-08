import { describe, expect, it } from 'vitest'
import { adminPageBreadcrumbItems } from '@/lib/adminPageBreadcrumb'

function labels(pathname: string): string[] {
  return adminPageBreadcrumbItems(pathname).map((item) => item.label)
}

describe('admin page breadcrumbs', () => {
  it('names the dashboard on the home page', () => {
    const items = adminPageBreadcrumbItems('/admin')
    expect(labels('/admin')).toEqual(['Dashboard'])
    expect(items[0]?.to).toBeUndefined()
  })

  it('links each section back to the dashboard', () => {
    const items = adminPageBreadcrumbItems('/admin/communication')
    expect(labels('/admin/communication')).toEqual(['Dashboard', 'Messages'])
    expect(items[0]?.to).toBe('/admin')
    expect(items[1]?.to).toBeUndefined()
  })

  it('includes the property and resident on a resident profile', () => {
    const items = adminPageBreadcrumbItems('/admin/properties/maple/residents/ada')
    expect(labels('/admin/properties/maple/residents/ada')).toEqual([
      'Dashboard',
      'Properties',
      'Property Overview',
      'Resident',
    ])
    expect(items[1]?.to).toBe('/admin/properties')
    expect(items[2]?.to).toBe('/admin/properties/maple')
  })

  it('uses the settings section names', () => {
    expect(labels('/admin/settings/operations/notifications')).toEqual([
      'Dashboard',
      'Settings',
      'Notifications',
    ])
    expect(labels('/admin/settings/billing')).toEqual([
      'Dashboard',
      'Settings',
      'Subscription & Billing',
    ])
  })

  it('leaves work orders to the page trail', () => {
    expect(adminPageBreadcrumbItems('/admin/requests')).toEqual([])
  })
})

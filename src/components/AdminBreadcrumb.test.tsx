/** @vitest-environment jsdom */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminBreadcrumb } from '@/components/AdminBreadcrumb'
import { AdminNotificationSettings } from '@/components/AdminNotificationSettings'
import { propertyDetailPath } from '@/lib/propertyRoutes'
import { workOrdersBreadcrumbItems } from '@/lib/workOrdersBreadcrumb'

vi.mock('@/lib/notificationSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notificationSettings')>()
  return {
    ...actual,
    loadNotificationSettingsForAccount: vi.fn(async () => actual.DEFAULT_NOTIFICATION_SETTINGS),
  }
})

vi.mock('@/lib/landlordAccountProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/landlordAccountProfile')>()
  return {
    ...actual,
    fetchLandlordAccountProfile: vi.fn(async () => actual.EMPTY_LANDLORD_ACCOUNT_PROFILE),
  }
})

vi.mock('@/lib/organizationSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/organizationSettings')>()
  return {
    ...actual,
    loadOrganizationSettings: vi.fn(async () => actual.DEFAULT_ORGANIZATION_SETTINGS),
  }
})

afterEach(() => {
  cleanup()
})

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

function renderTrail(items: ReturnType<typeof workOrdersBreadcrumbItems>) {
  return render(
    <MemoryRouter>
      <AdminBreadcrumb collapseOnMobile items={items} />
    </MemoryRouter>,
  )
}

describe('work order breadcrumbs', () => {
  it('shows Overview / Work Orders by default', () => {
    renderTrail(workOrdersBreadcrumbItems({}))
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.textContent).toBe('← OverviewOverview/Work Orders')
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/admin')
    const back = screen.getByRole('link', { name: '← Overview' })
    expect(back.getAttribute('href')).toBe('/admin')
    expect(back.className).toContain('sm:hidden')
    expect(back.className).toContain('whitespace-nowrap')
    const current = within(nav).getByText('Work Orders')
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.className).toContain('text-[#101828]')
    expect(current.tagName).toBe('SPAN')
  })

  it('links the property street when a property filter is set', () => {
    renderTrail(
      workOrdersBreadcrumbItems({
        property: { id: PROPERTY_ID, address: '14 Maple Ave' },
      }),
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.textContent).toContain('Overview/Properties/14 Maple Ave/Work Orders')
    expect(screen.getByRole('link', { name: 'Properties' }).getAttribute('href')).toBe(
      '/admin/properties',
    )
    expect(screen.getByRole('link', { name: '14 Maple Ave' }).getAttribute('href')).toBe(
      propertyDetailPath(PROPERTY_ID),
    )
    expect(within(nav).getByText('Work Orders').getAttribute('aria-current')).toBe('page')
  })

  it('drops ?q when Work Orders is clicked on a search trail', () => {
    function SearchTrail() {
      const [params] = useSearchParams()
      const query = params.get('q')
      return (
        <>
          <AdminBreadcrumb
            collapseOnMobile
            items={workOrdersBreadcrumbItems({ searchQuery: query })}
          />
          <output>{query ?? ''}</output>
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/admin/requests?q=sink']}>
        <SearchTrail />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.textContent).toContain('Overview/Work Orders/Search: "sink"')
    expect(within(nav).getByText('Search: "sink"').getAttribute('aria-current')).toBe('page')
    const workOrders = screen.getByRole('link', { name: 'Work Orders' })
    expect(workOrders.getAttribute('href')).toBe('/admin/requests')
    fireEvent.click(workOrders)
    expect(document.querySelector('output')?.textContent).toBe('')
    expect(within(nav).getByText('Work Orders').getAttribute('aria-current')).toBe('page')
    expect(screen.queryByText('Search: "sink"')).toBeNull()
  })

  it('shows the work order id and a short issue while a request is open', () => {
    const close = vi.fn()
    renderTrail(
      workOrdersBreadcrumbItems({
        openWorkOrder: {
          requestId: 'MNT-CB6CEBA1781C',
          description: 'Kitchen sink is leaking onto the floor overnight and again',
        },
        onCloseDetail: close,
      }),
    )
    const current = screen.getByText(/MNT-CB6CEBA1781C/)
    expect(current.getAttribute('aria-current')).toBe('page')
    const issue = current.textContent?.split(' — ')[1] ?? ''
    expect(issue.length).toBeLessThanOrEqual(40)
    expect(issue).toBe('Kitchen sink is leaking onto the floor')
    expect(screen.getByRole('link', { name: 'Work Orders' }).getAttribute('href')).toBe(
      '/admin/requests',
    )
    fireEvent.click(screen.getByRole('link', { name: 'Work Orders' }))
    expect(close).toHaveBeenCalled()
  })

  it('closes the open request from the Work Orders crumb', () => {
    function DetailTrail() {
      const [open, setOpen] = useState(true)
      return (
        <AdminBreadcrumb
          items={workOrdersBreadcrumbItems({
            openWorkOrder: open
              ? { requestId: 'MNT-CB6CEBA1781C', description: 'Kitchen sink leaking' }
              : null,
            onCloseDetail: () => setOpen(false),
          })}
        />
      )
    }

    render(
      <MemoryRouter>
        <DetailTrail />
      </MemoryRouter>,
    )
    const current = screen.getByText('MNT-CB6CEBA1781C — Kitchen sink leaking')
    expect(current.getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('link', { name: 'Work Orders' }))
    expect(screen.getByText('Work Orders').getAttribute('aria-current')).toBe('page')
    expect(screen.queryByText(/MNT-CB6CEBA1781C/)).toBeNull()
  })
})

describe('AdminNotificationSettings breadcrumb', () => {
  it('keeps the settings trail, separators, and current-page color', async () => {
    render(
      <MemoryRouter>
        <AdminNotificationSettings />
      </MemoryRouter>,
    )

    const nav = await waitFor(() => screen.getByRole('navigation', { name: 'Breadcrumb' }))
    expect(nav.className).toContain('flex flex-wrap items-center gap-2')
    expect(nav.className).toContain('text-[14px]')
    expect(nav.className).toContain('tracking-[-0.1504px]')
    expect(nav.className).toContain('text-[#6a7282]')

    const settings = within(nav).getByRole('link', { name: '← Settings' })
    expect(settings.getAttribute('href')).toBe('/admin/settings')
    expect(settings.className).toContain('sa-link')
    expect(settings.className).toContain('font-medium')
    expect(settings.className).toContain('hover:text-[#101828]')

    const operations = within(nav).getByText('Operations')
    expect(operations.className).toContain('font-medium')
    expect(operations.className).toContain('text-[#6a7282]')
    expect(operations.getAttribute('aria-current')).toBeNull()

    const current = within(nav).getByText('Notifications')
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.className).toContain('text-[#101828]')
    expect(current.tagName).toBe('SPAN')
    expect(nav.querySelectorAll('[aria-hidden]')).toHaveLength(2)
    expect(nav.textContent).toBe('← Settings/Operations/Notifications')
  })
})

/** @vitest-environment jsdom */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminBreadcrumb } from '@/components/AdminBreadcrumb'
import { propertyDetailPath } from '@/lib/propertyRoutes'
import { workOrdersBreadcrumbItems } from '@/lib/workOrdersBreadcrumb'

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

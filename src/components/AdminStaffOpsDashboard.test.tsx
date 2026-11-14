/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminStaffOpsDashboard } from '@/components/AdminStaffOpsDashboard'
import { setSessionLandlordFromEmail } from '@/lib/activeLandlord'

const fetchStaffMetrics = vi.fn()
const askStaffMetrics = vi.fn()

vi.mock('@/api/staffMetrics', () => ({
  fetchStaffMetrics: (...args: unknown[]) => fetchStaffMetrics(...args),
  askStaffMetrics: (...args: unknown[]) => askStaffMetrics(...args),
}))

const METRICS = {
  generated_at: '2026-11-14T12:00:00Z',
  window_days: 30,
  growth: {
    landlords_total: 7,
    funnel: { signed_up: 7, onboarding_completed: 5, added_property: 5, added_residents: 4, activated_a_resident: 3, first_work_order: 3 },
  },
  maintenance: {
    created: 41,
    open_now: 9,
    overdue_now: 3,
    by_trade: [{ trade: 'plumbing', created: 20 }],
    weekly: [{ week_start: '2026-11-09', created: 10, completed: 8 }],
  },
  vendors: { acceptance_rate: 0.6667 },
  data_health: {
    required_crons_missing: 1,
    crons_needing_attention: [{ jobname: 'ulo-weather-monitor', status: 'live', scheduled: false, failed_runs_24h: 0 }],
  },
}

afterEach(() => {
  cleanup()
  fetchStaffMetrics.mockReset()
  askStaffMetrics.mockReset()
  setSessionLandlordFromEmail(null)
})

describe('AdminStaffOpsDashboard', () => {
  it('does not load staff metrics for landlord accounts', () => {
    setSessionLandlordFromEmail('ceorentalsnj@gmail.com')
    render(<AdminStaffOpsDashboard />)
    expect(screen.getByRole('heading', { name: 'Ulo Ops is for Ulo staff' })).toBeTruthy()
    expect(fetchStaffMetrics).not.toHaveBeenCalled()
  })

  it('shows metrics, attention flags and the funnel for staff', async () => {
    setSessionLandlordFromEmail('emeka@ulohome.io')
    fetchStaffMetrics.mockResolvedValue(METRICS)
    render(<AdminStaffOpsDashboard />)

    await waitFor(() => expect(screen.getByText('41')).toBeTruthy())
    expect(fetchStaffMetrics).toHaveBeenCalledWith({ days: 30, includeDemo: false })
    expect(screen.getByText('67%')).toBeTruthy()
    expect(screen.getByText(/Overdue now:/)).toBeTruthy()
    expect(screen.getByText(/Scheduled jobs missing:/)).toBeTruthy()
    expect(screen.getByText('ulo-weather-monitor')).toBeTruthy()
    expect(screen.getByText('Onboarding funnel')).toBeTruthy()
  })

  it('reloads for a new window and answers questions from the same window', async () => {
    setSessionLandlordFromEmail('emeka@ulohome.io')
    fetchStaffMetrics.mockResolvedValue(METRICS)
    askStaffMetrics.mockResolvedValue({ answer: '**Overdue now** (right now): 3.', source: 'rules', metricPaths: [] })
    render(<AdminStaffOpsDashboard />)
    await waitFor(() => expect(fetchStaffMetrics).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(fetchStaffMetrics).toHaveBeenLastCalledWith({ days: 7, includeDemo: false }))

    fireEvent.change(screen.getByLabelText('Question about staff metrics'), {
      target: { value: 'How many are overdue?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByText('Matched directly from the metrics above.')).toBeTruthy())
    expect(askStaffMetrics).toHaveBeenCalledWith({ question: 'How many are overdue?', days: 7, includeDemo: false })
  })

  it('shows a clear error when metrics cannot load', async () => {
    setSessionLandlordFromEmail('emeka@ulohome.io')
    fetchStaffMetrics.mockRejectedValue(new Error('Ulo Ops is only available to Ulo staff accounts.'))
    render(<AdminStaffOpsDashboard />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('only available to Ulo staff'))
  })
})

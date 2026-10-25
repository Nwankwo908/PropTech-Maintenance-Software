/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { homeCheckRequest } from '@/api/homeCheck'
import { HomeCheckCapturePage } from '@/components/HomeCheckCapturePage'
import { HomeCheckPanel } from '@/components/HomeCheckPanel'
import { HOME_CHECK_CHANGED_EVENT } from '@/lib/homeCheckEvents'
import type { HomeCheckField } from '@shared/homeCheck'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('@/lib/assetRegistry', () => ({ notifyAssetRegistryChanged: vi.fn() }))
vi.mock('@/api/homeCheck', () => ({ homeCheckRequest: vi.fn() }))

function field(value: string | null): HomeCheckField {
  return {
    value,
    source: 'photo_text',
    capturedBy: 'landlord',
    confidence: 'low',
    photoIds: [],
  }
}

function asset(id: string, system: 'water_heater' | 'heating') {
  return {
    id,
    system,
    verified: false,
    manufactureDate: { year: null, month: null },
    fields: {
      make: field(null),
      model: field(null),
      serial: field(null),
      approximateAge: field(null),
      condition: field(null),
      lastService: field(null),
      lastFilterChange: field(null),
    },
  }
}

const openCheck = {
  id: 'check',
  reference: 'HC-100',
  property_label: '14 Maple Ave',
  unit_label: null,
  status: 'completed',
  expires_at: '2026-11-01T00:00:00.000Z',
  completed_at: '2026-10-25T00:00:00.000Z',
  confirmed_at: null,
  labels_readable: false,
  assets: [asset('heater', 'water_heater'), asset('furnace', 'heating')],
  photos: [
    { slot: 'water_heater_label', previewUrl: null, state: 'ready' },
    { slot: 'heating_label', previewUrl: null, state: 'ready' },
  ],
  role: 'landlord',
  sent: 0,
  opened: 0,
  completed: 1,
  labelReadable: 0,
  confirmed: 0,
  averageMinutes: null,
  issueShare: null,
  approvedJobShare: null,
}

describe('Home Check results', () => {
  afterEach(() => cleanup())
  beforeEach(() => {
    vi.mocked(homeCheckRequest).mockReset()
  })

  it('shows the equipment table without the retired capture instructions', async () => {
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [openCheck], metrics: [] })
    const html = render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    expect(await screen.findByText('Assets from Home Check')).toBeTruthy()
    expect(html.container.textContent).not.toContain('Scan property equipment')
    expect(html.container.textContent).not.toContain('I’ll do it')
    expect(html.container.textContent).not.toContain('Ask my tenant')
    expect(html.container.textContent).not.toContain('Open my Home Check')
    expect(html.container.textContent).toContain('14 Maple Ave')
    expect(html.container.textContent).not.toContain('Unit 1')
  })

  it('reviews a correction, confirms it, and reloads the saved record', async () => {
    const confirmed = {
      ...openCheck,
      confirmed_at: '2026-10-25T01:00:00.000Z',
      labels_readable: true,
      assets: openCheck.assets.map((row) => ({ ...row, verified: true })),
    }
    let lists = 0
    vi.mocked(homeCheckRequest).mockImplementation(async (body: Record<string, unknown>) => {
      if (body.action === 'list') {
        lists += 1
        return { checks: [lists > 1 ? confirmed : openCheck], metrics: [] }
      }
      return { ok: true }
    })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    expect(await screen.findByText('Assets from Home Check')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select all assets'))
    fireEvent.click(screen.getByRole('button', { name: /Edit selected/ }))
    fireEvent.change(screen.getAllByLabelText('Model')[0]!, { target: { value: 'ABC-1' } })
    fireEvent.change(screen.getAllByLabelText('Manufacture year')[0]!, { target: { value: '2019' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm asset records' }))
    await waitFor(() => {
      expect(homeCheckRequest).toHaveBeenCalledWith(expect.objectContaining({
        action: 'confirm',
        id: 'check',
        labelCorrections: expect.arrayContaining([
          expect.objectContaining({ assetId: 'heater', modelNumber: 'ABC-1', manufactureYear: 2019 }),
        ]),
      }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Confirm asset records' })).toBeNull()
    })
  })

  it('reloads the table after either upload entry finishes', async () => {
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [], metrics: [] })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    await waitFor(() => expect(homeCheckRequest).toHaveBeenCalled())
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [openCheck], metrics: [] })
    window.dispatchEvent(new CustomEvent(HOME_CHECK_CHANGED_EVENT, { detail: { propertyId: 'maple' } }))
    expect(await screen.findByText('Assets from Home Check')).toBeTruthy()
  })
})

describe('retired Home Check links', () => {
  it('explains the old page and does not offer another upload', () => {
    const html = render(<HomeCheckCapturePage />)
    expect(html.container.textContent).toContain('This Home Check link is no longer used')
    expect(html.container.querySelector('input')).toBeNull()
  })
})

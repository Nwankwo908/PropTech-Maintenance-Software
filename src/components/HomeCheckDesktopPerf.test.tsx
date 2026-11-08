/** @vitest-environment jsdom */
import { performance } from 'node:perf_hooks'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { HomeCheckRequestDialog, homeCheckRequestSelection } from '@/components/HomeCheckRequestModal'
import { oneRowPerAppliance } from '@/components/HomeCheckPanel'
import { PmHomeCheckPhotoReviews } from '@/components/PmHomeCheckPhotoReviews'
import type { HomeCheckOptions } from '@/api/homeCheck'
import type { InspectionAssessmentTableRow } from '@/components/InspectionAssessmentTable'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/api/homeCheck', () => ({ homeCheckRequest: mocks.request }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function screen(state: 'preview' | 'success' | 'setup') {
  return renderToStaticMarkup(createElement(HomeCheckRequestDialog, {
    titleId: 'home-check-title',
    location: '12 Oak St, Unit 2B',
    loading: false,
    submitting: false,
    vendor: state === 'preview',
    sent: state === 'success',
    error: null,
    onConfirm: () => undefined,
    onDismiss: () => undefined,
  }))
}

it('renders the desktop request screens for a full vendor handoff', () => {
  const options: HomeCheckOptions = {
    targets: [],
    closest: 'near',
    propertyState: 'NY',
    vendors: [{
      id: 'near',
      name: 'Test Contractor',
      distanceKm: 1.2,
      states: ['NY'],
      preferred: true,
    }],
  }
  const samples: number[] = []
  for (let i = 0; i < 30; i += 1) {
    const start = performance.now()
    const selection = homeCheckRequestSelection(options)
    const preview = screen('preview')
    const success = screen('success')
    const setup = screen('setup')
    samples.push(performance.now() - start)
    if (i === 0) {
      expect(selection.vendor?.id).toBe('near')
      expect(selection.error).toBeNull()
      expect(preview).toContain('Can you complete a Home Check at 12 Oak St, Unit 2B?')
      expect(preview).toContain('Reply YES to accept or NO to decline')
      expect(preview).toContain('coordinate a visit time with the landlord')
      expect(preview).not.toContain('Next: send a clear photo')
      expect(success).toContain('Message was sent successfully.')
      expect(setup).toContain('Go and set up your vendor first.')
    }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
  expect(p95).toBeLessThan(50)
})

function equipmentRow(id: string, type: string): InspectionAssessmentTableRow {
  return {
    id,
    categoryLabel: type,
    actionLabel: 'Review',
    result: {
      category: type,
      identifiedItem: {
        type,
        brand: 'Test',
        modelNumber: `M-${id}`,
        serialNumber: `S-${id}`,
      },
      manufactureDate: { year: 2019, month: 6 },
    },
  } as InspectionAssessmentTableRow
}

it('keeps Property Intelligence photo review and appliance rows under budget', async () => {
  const reviews = Array.from({ length: 24 }, (_, index) => ({
    id: `check-${index}`,
    property_id: 'property',
    property_label: '14 Maple Ave',
    unit_id: index % 3 === 0 ? 'unit-a' : 'unit-b',
    created_at: new Date(Date.UTC(2026, 9, 30 - (index % 10))).toISOString(),
    detected_warning: index % 2 === 0
      ? 'No drain pan installed beneath the water heater'
      : 'TPR line loops upwards; no catch pan',
  }))
  mocks.request.mockImplementation(async (body: { action: string }) => {
    if (body.action === 'photo_reviews') return { reviews }
    return {
      checks: reviews.map((review) => ({
        id: review.id,
        photos: [
          { slot: 'water_heater_whole', previewUrl: `https://example.invalid/${review.id}-whole` },
          { slot: 'heating_label', previewUrl: `https://example.invalid/${review.id}-label` },
        ],
      })),
    }
  })

  const samples: number[] = []
  for (let i = 0; i < 20; i += 1) {
    const start = performance.now()
    const rows = oneRowPerAppliance([
      ...Array.from({ length: 40 }, (_, index) => equipmentRow(`wh-${index}`, 'Water heater')),
      ...Array.from({ length: 40 }, (_, index) => equipmentRow(`heat-${index}`, 'Heating')),
    ])
    const view = render(createElement(PmHomeCheckPhotoReviews, { propertyId: 'property' }))
    await view.findByText('Photo review needed')
    samples.push(performance.now() - start)
    if (i === 0) {
      expect(rows).toHaveLength(2)
      expect(view.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0)
      expect(view.getAllByText('Ulo spotted something in a photo.').length).toBeGreaterThan(0)
    }
    cleanup()
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const p50 = sorted[Math.ceil(0.5 * sorted.length) - 1]
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
  expect(p50).toBeLessThan(120)
  expect(p95).toBeLessThan(250)
})

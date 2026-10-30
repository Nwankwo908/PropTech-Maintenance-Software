import { performance } from 'node:perf_hooks'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { HomeCheckRequestDialog, homeCheckRequestSelection } from '@/components/HomeCheckRequestModal'
import type { HomeCheckOptions } from '@/api/homeCheck'

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
      expect(preview).toContain('coordinate a visit time with the tenant')
      expect(preview).not.toContain('Next: send a clear photo')
      expect(success).toContain('Message was sent successfully.')
      expect(setup).toContain('Go and set up your vendor first.')
    }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const p50 = sorted[Math.ceil(0.5 * sorted.length) - 1]
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]
  expect(p95).toBeLessThan(50)
})

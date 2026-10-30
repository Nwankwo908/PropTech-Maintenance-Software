import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeCheckRequestDialog, homeCheckRequestSelection, homeCheckResendPrompt, latestCompletedHomeCheckSentAt } from '@/components/HomeCheckRequestModal'
import { selectActiveHomeCheckVendors } from '@/lib/homeCheckActiveVendor'
import type { HomeCheckVendor } from '@/api/homeCheck'

function dialogMarkup(input: {
  vendor?: boolean
  sent?: boolean
  error?: string | null
  loading?: boolean
  repeatPrompt?: string | null
}) {
  return renderToStaticMarkup(
    createElement(HomeCheckRequestDialog, {
      titleId: 'home-check-title',
      location: 'Maple Court',
      loading: input.loading ?? false,
      submitting: false,
      vendor: input.vendor ?? false,
      sent: input.sent ?? false,
      error: input.error ?? null,
      repeatPrompt: input.repeatPrompt,
      onConfirm: () => undefined,
      onDismiss: () => undefined,
    }),
  )
}

describe('HomeCheckRequestModal', () => {
  it('previews the vendor text before anything is sent', () => {
    const html = dialogMarkup({ vendor: true })
    expect(html).toContain('A message will be sent to your available vendor to complete your home health check.')
    expect(html).toContain('Hi, this is Ulo. Can you complete a Home Check at Maple Court?')
    expect(html).toContain('Reply YES to accept or NO to decline.')
    expect(html).not.toContain('Next: send a clear photo')
    expect(html).toContain('Cancel')
    expect(html).toContain('>OK<')
    expect(html).not.toContain('Message was sent successfully.')
  })

  it('asks before sending again after a completed home check', () => {
    expect(latestCompletedHomeCheckSentAt([
      { status: 'collecting', sent_at: '2026-10-01T15:00:00.000Z', created_at: '2026-10-01T15:00:00.000Z' },
    ])).toBeNull()
    expect(latestCompletedHomeCheckSentAt([
      { status: 'completed', sent_at: '2026-10-20T15:00:00.000Z', created_at: '2026-10-20T15:00:00.000Z' },
      { status: 'completed', sent_at: '2026-10-29T15:00:00.000Z', created_at: '2026-10-29T15:00:00.000Z' },
    ])).toBe('2026-10-29T15:00:00.000Z')
    const prompt = homeCheckResendPrompt('2026-10-29T15:00:00.000Z')
    expect(prompt).toMatch(/^This was sent out .+ 2026\. Are you sure you want to send again\?$/)
    const html = dialogMarkup({ vendor: true, repeatPrompt: prompt })
    expect(html).toContain(prompt)
    expect(html).toContain('Cancel')
    expect(html).not.toContain('Message preview')
  })

  it('confirms after the text is sent', () => {
    const html = dialogMarkup({ sent: true })
    expect(html).toContain('Message was sent successfully.')
    expect(html).not.toContain('Cancel')
  })

  it('tells the landlord to set up a vendor when none is active', () => {
    expect(homeCheckRequestSelection({
      targets: [],
      vendors: [],
      closest: null,
    })).toEqual({ vendor: null, error: null })
    const html = dialogMarkup({})
    expect(html).toContain('Go and set up your vendor first.')
    expect(html).not.toContain('Home Check visit')
    expect(html).not.toContain('Cancel')
  })

  it('drops a vendor who is not active', () => {
    const vendors: HomeCheckVendor[] = [
      { id: 'waiting', name: 'Waiting Electric', distanceKm: null },
    ]
    const active = selectActiveHomeCheckVendors(vendors, new Map([
      ['waiting', { verificationStatus: 'invited', vendorActive: true }],
    ]))
    expect(homeCheckRequestSelection({
      targets: [],
      vendors: active,
      closest: null,
    })).toEqual({ vendor: null, error: null })
  })

  it('keeps the state message when active vendors cannot cover the property', () => {
    const selection = homeCheckRequestSelection({
      targets: [],
      vendors: [{ id: 'far', name: 'Rapid Electric', distanceKm: null, states: ['NY'] }],
      closest: null,
      propertyState: 'NJ',
    })
    expect(selection.vendor).toBeNull()
    expect(selection.error).toBe('No contractor in this property’s state can take this home check.')
    const html = dialogMarkup({ error: selection.error })
    expect(html).toContain('No contractor in this property’s state can take this home check.')
    expect(html).not.toContain('Go and set up your vendor first.')
  })
})

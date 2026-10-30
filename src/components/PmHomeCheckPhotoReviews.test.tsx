/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { homeCheckPhotoObservations } from '@/lib/homeCheckPhotoReview'
import { PmHomeCheckPhotoReviews } from './PmHomeCheckPhotoReviews'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/api/homeCheck', () => ({ homeCheckRequest: mocks.request }))
const reviews = [{ id: 'check', property_id: 'property', property_label: 'Maintenance test house · 100 Disposable Test Lane · Newark, NJ', detected_warning: 'TPR line loops upwards; no catch pan' }]
beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockResolvedValue({ reviews })
})
afterEach(cleanup)
describe('Home Check photo review in Property Intelligence', () => {
  it('says what was in the photo without the address or an AI label', () => {
    expect(homeCheckPhotoObservations('TPR line loops upwards; no catch pan')).toEqual([
      "Relief valve pipe doesn't reach the floor",
      'No drain pan visible under the water heater',
    ])
  })
  it('uses the authenticated property-scoped API without repair claims', async () => {
    render(<PmHomeCheckPhotoReviews propertyId='property' />)
    expect(await screen.findByText('Ulo spotted something in a photo.')).toBeTruthy()
    const relief = screen.getByText("Relief valve pipe doesn't reach the floor")
    const pan = screen.getByText('No drain pan visible under the water heater')
    expect(relief.closest('ul')).toBe(pan.closest('ul'))
    expect(relief.tagName).toBe('LI')
    expect(pan.tagName).toBe('LI')
    const repair = screen.getByRole('button', { name: 'Create repair request' })
    const closer = screen.getByRole('button', { name: 'Request closer photo' })
    expect(screen.getByRole('button', { name: 'Looks fine' })).toBeTruthy()
    expect(repair.compareDocumentPosition(closer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(closer.className).toContain('enabled:hover:underline')
    expect(closer.className).not.toMatch(/\bborder\b/)
    expect(mocks.request).toHaveBeenCalledWith({ action: 'photo_reviews', propertyId: 'property', portfolio: false })
    expect(screen.queryByText(/AI observations/)).toBeNull()
    expect(screen.queryByText(/Disposable Test Lane/)).toBeNull()
    expect(screen.queryByText(/must run continuously/)).toBeNull()
  })
  it('does not fall back to all properties when property identity is missing', () => {
    render(<PmHomeCheckPhotoReviews />)
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('places every photo from that check on the right of the review', async () => {
    mocks.request.mockImplementation(async body => body.action === 'photo_reviews' ? { reviews } : { checks: [{ id: 'other', photos: [{ slot: 'wrong', previewUrl: 'https://example.invalid/wrong' }] }, { id: 'check', photos: [{ slot: 'water_heater_whole', previewUrl: 'https://example.invalid/right' }, { slot: 'heating_label', previewUrl: 'https://example.invalid/heat' }] }] })
    render(<PmHomeCheckPhotoReviews propertyId='property' />)
    const whole = await screen.findByAltText('water heater whole')
    const label = screen.getByAltText('heating label')
    expect(screen.queryByAltText('wrong')).toBeNull()
    expect(screen.getByText('Ulo spotted something in a photo.').compareDocumentPosition(whole) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(whole.closest('div')?.contains(label)).toBe(true)
    expect(whole.closest('div')?.parentElement?.className).toContain('justify-between')
    expect(mocks.request).toHaveBeenCalledWith({ action: 'list', propertyId: 'property' })
  })
  it('opens a repair through the photo review action and clears the card', async () => {
    mocks.request.mockImplementation(async body => body.action === 'photo_reviews' ? { reviews } : { ok: true })
    render(<PmHomeCheckPhotoReviews propertyId='property' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create repair request' }))
    await waitFor(() => expect(screen.queryByText('Ulo spotted something in a photo.')).toBeNull())
    expect(mocks.request).toHaveBeenCalledWith({ action: 'photo_review', id: 'check', decision: 'repair' })
  })
  it('asks for a closer photo without removing the review', async () => {
    mocks.request.mockImplementation(async body => body.action === 'photo_reviews' ? { reviews } : { ok: true })
    render(<PmHomeCheckPhotoReviews propertyId='property' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Request closer photo' }))
    expect(await screen.findByRole('button', { name: 'Closer photo requested' })).toBeTruthy()
    expect(screen.getByText('Ulo spotted something in a photo.')).toBeTruthy()
    expect(mocks.request).toHaveBeenCalledWith({ action: 'photo_review', id: 'check', decision: 'closer_photo' })
  })
  it('reports failed photo loads honestly and allows retry', async () => {
    mocks.request.mockImplementation(async body => { if (body.action === 'photo_reviews') return { reviews }; throw new Error('forbidden') })
    render(<PmHomeCheckPhotoReviews portfolio />)
    fireEvent.click(await screen.findByText('Review photos'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load these photos/))
    expect(mocks.request).toHaveBeenCalledWith({ action: 'photo_reviews', propertyId: undefined, portfolio: true })
  })
  it('shows an error rather than an empty success if the review API fails', async () => {
    mocks.request.mockRejectedValue(new Error('forbidden'))
    render(<PmHomeCheckPhotoReviews propertyId='property' />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

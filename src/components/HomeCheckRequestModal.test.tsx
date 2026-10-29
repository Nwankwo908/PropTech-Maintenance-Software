/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeCheckRequestModal } from '@/components/HomeCheckRequestModal'
import { homeCheckRequest, requestPlatformHomeCheck } from '@/api/homeCheck'

vi.mock('@/api/homeCheck', () => ({
  homeCheckRequest: vi.fn(),
  requestPlatformHomeCheck: vi.fn(),
}))

vi.mock('@/lib/homeCheckEvents', () => ({
  notifyHomeCheckChanged: vi.fn(),
}))

const homeCheckRequestMock = vi.mocked(homeCheckRequest)
const requestPlatformHomeCheckMock = vi.mocked(requestPlatformHomeCheck)

describe('HomeCheckRequestModal', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the selected contractor and requests the home check on continue', async () => {
    homeCheckRequestMock.mockResolvedValue({
      vendors: [{ id: 'near', name: 'Rapid Electric', distanceKm: 1.2 }],
      closest: 'near',
    })
    requestPlatformHomeCheckMock.mockResolvedValue({
      ok: true,
      checkId: 'check-1',
      workflowRunId: 'run-1',
      vendorName: 'Rapid Electric',
      deliveryError: null,
    })
    const onClose = vi.fn()
    const onRequested = vi.fn()
    render(
      <HomeCheckRequestModal
        open
        propertyId="maple"
        onClose={onClose}
        onRequested={onRequested}
      />,
    )
    expect(await screen.findByText('Rapid Electric')).toBeTruthy()
    expect(
      screen.getByText(
        'Rapid Electric will collect appliance details to help Ulo recommend maintenance and flag potential issues early.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(requestPlatformHomeCheckMock).toHaveBeenCalledWith({
        propertyId: 'maple',
        vendorId: 'near',
      })
    })
    expect(onRequested).toHaveBeenCalledWith('Home check requested. It is on Active Tasks.')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without requesting when cancelled', async () => {
    homeCheckRequestMock.mockResolvedValue({
      vendors: [{ id: 'near', name: 'Rapid Electric', distanceKm: 1.2 }],
      closest: 'near',
    })
    const onClose = vi.fn()
    render(
      <HomeCheckRequestModal
        open
        propertyId="maple"
        onClose={onClose}
        onRequested={vi.fn()}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(requestPlatformHomeCheckMock).not.toHaveBeenCalled()
  })
})
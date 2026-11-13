import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ activateUnit: vi.fn(), from: vi.fn() }))
vi.mock('@/api/unitVacancy', () => ({ activateUnit: mocks.activateUnit, markUnitVacant: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/activeLandlord', () => ({ getActiveLandlordId: () => '11111111-1111-4111-8111-111111111111' }))
import { applyAdminUnitOccupancyStatus } from './unitActivation'

describe('occupied status respects activation authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation(() => { throw new Error('Unexpected direct database access after Edge rejection') })
  })
  for (const error of ['Please sign in again to continue.', 'Forbidden', 'Unit not found', 'Authorization temporarily unavailable', 'Network unavailable']) {
    it('does not query or mutate the database when activation returns '+error, async () => {
      mocks.activateUnit.mockResolvedValue({ ok: false, error })
      const result = await applyAdminUnitOccupancyStatus({
        unitId: '22222222-2222-4222-8222-222222222222',
        landlordId: '11111111-1111-4111-8111-111111111111',
        status: 'occupied',
      })
      expect(result).toEqual({ ok: false, error })
      expect(mocks.activateUnit).toHaveBeenCalledExactlyOnceWith({
        unitId: '22222222-2222-4222-8222-222222222222',
        landlordId: '11111111-1111-4111-8111-111111111111',
        skipTenantRegistration: true,
      })
      expect(mocks.from).not.toHaveBeenCalled()
    })
  }
  it('does not query or mutate the database when activation throws', async () => {
    mocks.activateUnit.mockRejectedValue(new Error('Synthetic network failure'))
    await expect(applyAdminUnitOccupancyStatus({
      unitId: '22222222-2222-4222-8222-222222222222',
      landlordId: '11111111-1111-4111-8111-111111111111',
      status: 'occupied',
    })).rejects.toThrow('Synthetic network failure')
    expect(mocks.from).not.toHaveBeenCalled()
  })
})


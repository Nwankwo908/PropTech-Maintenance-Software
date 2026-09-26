import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { lookupCityStateFromUsZip, normalizeUsZip } from './lookupCityStateFromUsZip'

vi.mock('@/lib/googleMapsLoader', () => ({
  resolveGoogleMapsApiKey: () => null,
  loadGoogleMapsApi: vi.fn(),
}))

describe('normalizeUsZip', () => {
  it('accepts 5-digit and ZIP+4', () => {
    expect(normalizeUsZip('30308')).toBe('30308')
    expect(normalizeUsZip('30308-1234')).toBe('30308')
    expect(normalizeUsZip('3030')).toBeNull()
  })
})

describe('lookupCityStateFromUsZip', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          places: [
            {
              'place name': 'Atlanta',
              'state abbreviation': 'GA',
              state: 'Georgia',
            },
          ],
        }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to Zippopotam when Maps is unavailable', async () => {
    await expect(lookupCityStateFromUsZip('30308')).resolves.toEqual({
      city: 'Atlanta',
      state: 'GA',
      zipCode: '30308',
    })
  })
})

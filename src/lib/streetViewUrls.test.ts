import { describe, expect, it } from 'vitest'
import {
  googleMapsSearchUrl,
  googleMapsStreetViewPageUrl,
  googleStreetViewEmbedUrl,
  googleStreetViewStaticUrl,
  allowInteractiveStreetViewEmbed,
} from '@/lib/streetViewUrls'

describe('streetViewUrls', () => {
  it('builds official Street View Embed and Static URLs without Maps JavaScript', () => {
    const embed = googleStreetViewEmbedUrl({ apiKey: 'test-key', lat: 40.7357, lng: -74.1724 })
    expect(embed.startsWith('https://www.google.com/maps/embed/v1/streetview?')).toBe(true)
    expect(embed).toContain('location=40.7357%2C-74.1724')
    expect(embed).toContain('key=test-key')
    expect(embed).not.toContain('maps/api/js')
    expect(embed).not.toContain('openstreetmap')

    const still = googleStreetViewStaticUrl({ apiKey: 'test-key', lat: 40.7357, lng: -74.1724 })
    expect(still?.startsWith('https://maps.googleapis.com/maps/api/streetview?')).toBe(true)
  })

  it('can target Street View Static with an address when coordinates are missing', () => {
    const url = googleStreetViewStaticUrl({
      apiKey: 'test-key',
      query: '123 Main St, Newark, NJ',
    })
    expect(url).toContain('123+Main+St')
  })

  it('builds a Google Maps Street View page link', () => {
    expect(googleMapsStreetViewPageUrl(40.7, -74.1)).toContain('map_action=pano')
    expect(googleMapsSearchUrl('123 Main St')).toContain('123')
  })

  it('disables Maps Embed on localhost so the tab cannot jump to www.ulohome.io', () => {
    expect(allowInteractiveStreetViewEmbed('localhost', true)).toBe(false)
    expect(allowInteractiveStreetViewEmbed('127.0.0.1', true)).toBe(false)
    expect(allowInteractiveStreetViewEmbed('192.168.1.247', true)).toBe(false)
    expect(allowInteractiveStreetViewEmbed('www.ulohome.io', true)).toBe(false)
    expect(allowInteractiveStreetViewEmbed('www.ulohome.io', false)).toBe(true)
  })
})

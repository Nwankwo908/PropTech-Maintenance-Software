import { describe, expect, it } from 'vitest'
import { zillowHomesSearchUrl } from '@/lib/zillowPropertyUrl'

describe('zillowHomesSearchUrl', () => {
  it('builds a homes search URL from a street address', () => {
    expect(zillowHomesSearchUrl('123 Main St, Austin, TX 78701')).toBe(
      'https://www.zillow.com/homes/123-Main-St-Austin-TX-78701_rb/',
    )
  })

  it('returns the homes root when address is empty', () => {
    expect(zillowHomesSearchUrl('  ')).toBe('https://www.zillow.com/homes/')
  })
})

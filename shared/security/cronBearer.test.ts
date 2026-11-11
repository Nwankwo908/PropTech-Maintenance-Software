import { describe, expect, it } from 'vitest'
import { cronBearerMatches } from './cronBearer.ts'

describe('cronBearerMatches', () => {
  it('fails closed when the server secret is missing', () => {
    expect(cronBearerMatches(null, 'Bearer anything')).toBe(false)
    expect(cronBearerMatches('   ', 'Bearer anything')).toBe(false)
    expect(cronBearerMatches(undefined, null)).toBe(false)
  })

  it('rejects a missing or wrong bearer', () => {
    expect(cronBearerMatches('cron-secret', null)).toBe(false)
    expect(cronBearerMatches('cron-secret', 'Bearer other')).toBe(false)
    expect(cronBearerMatches('cron-secret', 'cron-secret')).toBe(false)
  })

  it('accepts an exact bearer match', () => {
    expect(cronBearerMatches('cron-secret', 'Bearer cron-secret')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  isPropertyIdSlug,
  parsePropertyRouteSlug,
  propertyDetailPath,
} from './propertyRoutes'

describe('propertyRoutes', () => {
  it('detects canonical property UUID slugs', () => {
    expect(isPropertyIdSlug('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
    expect(isPropertyIdSlug('Maple%20Heights')).toBe(false)
    expect(isPropertyIdSlug('')).toBe(false)
  })

  it('parses property id vs building name slugs', () => {
    const id = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    expect(parsePropertyRouteSlug(id)).toEqual({ kind: 'id', value: id })
    expect(parsePropertyRouteSlug('Maple%20Heights')).toEqual({
      kind: 'name',
      value: 'Maple Heights',
    })
  })

  it('builds property detail paths from stable ids', () => {
    const id = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    expect(propertyDetailPath(id)).toBe(`/admin/properties/${id}`)
    expect(propertyDetailPath(id, 'units')).toBe(`/admin/properties/${id}?tab=units`)
  })
})

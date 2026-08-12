import { describe, expect, it } from 'vitest'
import {
  buildPropertyIdByBuilding,
  isPropertyIdSlug,
  parsePropertyRouteSlug,
  propertyDetailPath,
  propertyDetailPathForBuilding,
  propertyResidentDetailPathForBuilding,
} from './propertyRoutes'
import { normalizeBuildingKey } from './propertyHealth'

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

  it('prefers canonical property id in building-based paths', () => {
    const id = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    const map = buildPropertyIdByBuilding([{ id, name: 'Maple Heights' }])
    expect(propertyDetailPathForBuilding('Maple Heights', map)).toBe(
      `/admin/properties/${id}`,
    )
    expect(propertyDetailPathForBuilding('Unknown Tower', map)).toBe(
      '/admin/properties/Unknown%20Tower',
    )
    expect(propertyResidentDetailPathForBuilding('Maple Heights', 'res-1', map)).toBe(
      `/admin/properties/${id}/residents/res-1`,
    )
  })
})

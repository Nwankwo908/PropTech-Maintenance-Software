import { describe, expect, it } from 'vitest'
import {
  normalizeResidentOccupancyStatus,
  residentOccupancyLabel,
  residentOccupancyOccupiesUnit,
  unitOccupancyFromResidentStatus,
} from './residentOccupancy'

describe('resident occupancy', () => {
  it('treats Occupied and Suspended as occupying the unit', () => {
    expect(residentOccupancyOccupiesUnit('active')).toBe(true)
    expect(residentOccupancyOccupiesUnit('occupied')).toBe(true)
    expect(residentOccupancyOccupiesUnit('suspended')).toBe(true)
    expect(unitOccupancyFromResidentStatus('active')).toBe('occupied')
  })

  it('does not occupy the unit for pending move-in or past resident', () => {
    expect(residentOccupancyOccupiesUnit('pending')).toBe(false)
    expect(residentOccupancyOccupiesUnit('past_resident')).toBe(false)
    expect(unitOccupancyFromResidentStatus('pending')).toBe('vacant')
    expect(unitOccupancyFromResidentStatus('past_resident')).toBe('vacant')
  })

  it('labels occupancy the same way onboarding, residents, and the property page do', () => {
    expect(residentOccupancyLabel('active')).toBe('Occupied')
    expect(residentOccupancyLabel('pending')).toBe('Pending move-in')
    expect(residentOccupancyLabel('past_resident')).toBe('Past resident')
    expect(residentOccupancyLabel('suspended')).toBe('Suspended')
    expect(normalizeResidentOccupancyStatus('Occupied')).toBe('active')
  })
})

import { describe, expect, it } from 'vitest'
import {
  countPropertiesNeedingMoreInformation,
  homeCheckIsComplete,
  propertiesNeedMoreInformationCopy,
  propertyNeedsMoreInformation,
} from '@/lib/propertyInformationGaps'

const properties = [
  { id: 'oak', name: '12 Oak St' },
  { id: 'maple', name: '14 Maple Ave' },
  { id: 'birch', name: 'Birch' },
]

describe('properties that need more information', () => {
  it('counts a property missing access, insurance, or a completed home check', () => {
    expect(propertyNeedsMoreInformation({
      hasAccess: true,
      hasInsurance: true,
      homeCheckComplete: true,
    })).toBe(false)
    expect(propertyNeedsMoreInformation({
      hasAccess: false,
      hasInsurance: true,
      homeCheckComplete: true,
    })).toBe(true)

    const count = countPropertiesNeedingMoreInformation(properties, {
      accessBuildings: new Set(['12 oak st', '14 maple ave']),
      insuredBuildings: new Set(['12 oak st']),
      homeCheckPropertyIds: new Set(['oak', 'maple']),
    })
    expect(count).toBe(2)
  })

  it('does not treat a collecting home check as complete', () => {
    expect(homeCheckIsComplete('collecting')).toBe(false)
    expect(homeCheckIsComplete('expired')).toBe(false)
    expect(homeCheckIsComplete('completed')).toBe(true)
    expect(homeCheckIsComplete('confirmed')).toBe(true)
  })

  it('writes the banner for one property and for several', () => {
    expect(propertiesNeedMoreInformationCopy(0)).toBeNull()
    expect(propertiesNeedMoreInformationCopy(1)?.title).toBe('1 property needs more information')
    expect(propertiesNeedMoreInformationCopy(3)?.title).toBe('3 properties need more information')
    expect(propertiesNeedMoreInformationCopy(3)?.detail).toBe(
      'Missing property access, insurance, or a completed home check.',
    )
  })
})

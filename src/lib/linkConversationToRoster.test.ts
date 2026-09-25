import { describe, expect, it } from 'vitest'
import {
  buildResidentByPhoneDigits,
  linkConversationToRosterByPhone,
  normalizeUnitLabelForMatch,
  resolveUnitIdFromInventory,
} from '@/lib/linkConversationToRoster'

describe('linkConversationToRosterByPhone', () => {
  const units = [
    { id: 'u-1', label: '1', building: '14 Maple Ave' },
    { id: 'u-2', label: '2', building: '14 Maple Ave' },
    { id: 'u-3', label: '1', building: '22 Pine St' },
  ]

  const residents = [
    {
      id: 'res-ganaia',
      name: 'Ganaia Smith',
      phone: '+15559876543',
      unit: '1',
      building: '14 Maple Ave',
    },
  ]

  it('links an unattached SMS phone to the roster resident and unit UUID', () => {
    const byPhone = buildResidentByPhoneDigits(residents)
    const linked = linkConversationToRosterByPhone({
      externalPhone: '(555) 987-6543',
      residentByPhone: byPhone,
      units,
    })
    expect(linked).toEqual({
      residentId: 'res-ganaia',
      unitId: 'u-1',
      name: 'Ganaia Smith',
      unitLabel: '1',
      building: '14 Maple Ave',
    })
  })

  it('returns null when the phone is not on the roster', () => {
    const byPhone = buildResidentByPhoneDigits(residents)
    expect(
      linkConversationToRosterByPhone({
        externalPhone: '+15551112222',
        residentByPhone: byPhone,
        units,
      }),
    ).toBeNull()
  })

  it('picks the unit matching building when labels collide', () => {
    expect(resolveUnitIdFromInventory(units, '1', '22 Pine St')).toBe('u-3')
    expect(normalizeUnitLabelForMatch('Unit #1')).toBe('1')
  })
})

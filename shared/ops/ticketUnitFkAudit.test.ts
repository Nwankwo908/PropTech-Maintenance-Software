import { describe, expect, it } from 'vitest'
import {
  findConversationUnitFkMismatches,
  findTicketUnitFkMismatches,
} from './ticketUnitFkAudit.ts'

describe('ticketUnitFkAudit', () => {
  const units = [
    {
      id: 'unit-bay',
      unit_label: '1',
      building: '3222 Avon Avenue',
      property_id: 'prop-avon',
    },
    {
      id: 'unit-ellerslie',
      unit_label: '1',
      building: '3110 Ellerslie Avenue',
      property_id: 'prop-ellerslie',
    },
  ]
  const residents = [
    {
      id: 'res-shahita',
      full_name: 'Shahita',
      unit: '1',
      building: '3222 Avon Avenue',
      email: 'shahita@example.com',
    },
  ]
  const occupancy = [{ resident_id: 'res-shahita', unit_id: 'unit-bay' }]

  it('flags ticket unit_id on the wrong property for the resident', () => {
    const mismatches = findTicketUnitFkMismatches({
      units,
      residents,
      occupancy,
      tickets: [
        {
          id: 'ticket-c2c7',
          unit: '1',
          unit_id: 'unit-ellerslie',
          property_id: 'prop-ellerslie',
          resident_user_id: 'res-shahita',
        },
      ],
      runs: [
        {
          id: 'run-c2c7',
          entity_id: 'ticket-c2c7',
          unit_id: 'unit-ellerslie',
          property_id: 'prop-ellerslie',
          resident_id: 'res-shahita',
        },
      ],
    })
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]!.ticketId).toBe('ticket-c2c7')
    expect(mismatches[0]!.expectedUnitIds).toEqual(['unit-bay'])
    expect(mismatches[0]!.reasons.join(' ')).toMatch(/unit_id/)
  })

  it('flags conversation unit_id that is not the resident occupancy', () => {
    const mismatches = findConversationUnitFkMismatches({
      residents,
      occupancy,
      conversations: [
        {
          id: 'convo-1',
          resident_id: 'res-shahita',
          unit_id: 'unit-ellerslie',
        },
      ],
    })
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]!.expectedUnitId).toBe('unit-bay')
  })

  it('passes when ticket FKs match occupancy', () => {
    expect(
      findTicketUnitFkMismatches({
        units,
        residents,
        occupancy,
        tickets: [
          {
            id: 'ticket-ok',
            unit: '1',
            unit_id: 'unit-bay',
            property_id: 'prop-avon',
            resident_user_id: 'res-shahita',
          },
        ],
        runs: [],
      }),
    ).toEqual([])
  })
})

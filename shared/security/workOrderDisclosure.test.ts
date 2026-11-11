import { describe, expect, it } from 'vitest'
import { discloseWorkOrderSensitiveFields } from './workOrderDisclosure.ts'

const access = {
  buildingEntry: 'Side door',
  gateCode: '1234',
  lockboxLocation: 'By the meter',
  lockboxCode: '9876',
  utilityRoomAccess: '',
  visitorParking: '',
  superintendentContact: 'Sam 555-0100',
  emergencyAccessNotes: '',
}

describe('discloseWorkOrderSensitiveFields', () => {
  it('hides phone and entry credentials from a link holder', () => {
    expect(
      discloseWorkOrderSensitiveFields({
        vendorSessionVerified: false,
        residentPhone: '+15555550100',
        accessInstructions: 'Gate code 1234',
        propertyAccess: access,
      }),
    ).toEqual({
      residentPhone: null,
      accessInstructions: null,
      propertyAccess: null,
    })
  })

  it('returns entry details to a verified assigned vendor session', () => {
    const disclosed = discloseWorkOrderSensitiveFields({
      vendorSessionVerified: true,
      residentPhone: '+15555550100',
      accessInstructions: 'Use the side door',
      propertyAccess: access,
    })
    expect(disclosed.residentPhone).toBe('+15555550100')
    expect(disclosed.propertyAccess?.lockboxCode).toBe('9876')
    expect(disclosed.propertyAccess?.gateCode).toBe('1234')
  })
})

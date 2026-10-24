import { describe, expect, it } from 'vitest'
import {
  isFictionalWelcomePhone,
  isReservedWelcomeEmail,
  landlordWelcomeContactsAreUndeliverable,
  planLandlordWelcomeDelivery,
  undeliverableWelcomeStatus,
} from './landlordWelcomeDelivery'

describe('landlord welcome delivery', () => {
  it('treats example.com and fictional 555 numbers as undeliverable', () => {
    expect(isReservedWelcomeEmail('lease-import-conflict@example.com')).toBe(true)
    expect(isReservedWelcomeEmail('alex@acme.test')).toBe(false)
    expect(isFictionalWelcomePhone('+12025550102')).toBe(true)
    expect(isFictionalWelcomePhone('+12025551212')).toBe(false)
    expect(
      landlordWelcomeContactsAreUndeliverable({
        emails: ['lease-import-conflict@example.com'],
        phones: ['+12025550102'],
      }),
    ).toBe(true)
    expect(
      undeliverableWelcomeStatus({
        emails: ['lease-import-conflict@example.com'],
        phones: ['+12025550102'],
      }),
    ).toMatch(/email and phone/)
  })

  it('does not retry an undeliverable address and still sends a new one', () => {
    const retry = planLandlordWelcomeDelivery({
      phones: ['+12025550102', '+12025551212'],
      emails: ['lease-import-conflict@example.com', 'owner@acme.test'],
      priorSmsSkipped: ['+12025550102'],
      priorEmailSkipped: ['lease-import-conflict@example.com'],
    })
    expect(retry.smsToSend).toEqual(['+12025551212'])
    expect(retry.emailToSend).toEqual(['owner@acme.test'])
    expect(retry.smsSkipped).toEqual([])
    expect(retry.emailSkipped).toEqual([])
  })

  it('does not send a second welcome after one was delivered', () => {
    const retry = planLandlordWelcomeDelivery({
      phones: ['+12025551212', '+12025551313'],
      emails: ['owner@acme.test', 'other@acme.test'],
      priorSmsSent: ['+12025551212'],
      priorEmailSent: ['owner@acme.test'],
    })
    expect(retry.smsToSend).toEqual([])
    expect(retry.emailToSend).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { smsMessageBelongsToWorkOrder } from './workOrderSmsPhotos'

const ticketA = '2026-08-15T15:42:00.000Z'
const ticketB = '2026-08-15T21:18:00.000Z'

describe('smsMessageBelongsToWorkOrder', () => {
  it('keeps the photo sent during this request', () => {
    expect(
      smsMessageBelongsToWorkOrder({
        messageCreatedAt: '2026-08-15T15:47:32.000Z',
        ticketCreatedAt: ticketA,
        nextTicketCreatedAt: ticketB,
      }),
    ).toBe(true)
  })

  it('does not put an earlier request photo on the latest work order', () => {
    expect(
      smsMessageBelongsToWorkOrder({
        messageCreatedAt: '2026-08-15T15:47:32.000Z',
        ticketCreatedAt: ticketB,
      }),
    ).toBe(false)
  })

  it('does not put a later request photo on the earlier work order', () => {
    expect(
      smsMessageBelongsToWorkOrder({
        messageCreatedAt: '2026-08-15T21:22:10.000Z',
        ticketCreatedAt: ticketA,
        nextTicketCreatedAt: ticketB,
      }),
    ).toBe(false)
  })

  it('includes the inbound MMS saved just before the ticket was minted', () => {
    expect(
      smsMessageBelongsToWorkOrder({
        messageCreatedAt: '2026-08-15T21:18:14.000Z',
        ticketCreatedAt: '2026-08-15T21:18:20.000Z',
      }),
    ).toBe(true)
  })

  it('omits conversation extras when the ticket has no created_at', () => {
    expect(
      smsMessageBelongsToWorkOrder({
        messageCreatedAt: '2026-08-15T21:22:10.000Z',
        ticketCreatedAt: null,
      }),
    ).toBe(false)
  })
})

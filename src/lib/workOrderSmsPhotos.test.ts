import { describe, expect, it } from 'vitest'
import {
  shouldSkipUnclaimedSmsMediaExtras,
  smsMediaExtraAllowedOnWorkOrder,
  smsMessageBelongsToWorkOrder,
} from './workOrderSmsPhotos'

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

describe('smsMediaExtraAllowedOnWorkOrder', () => {
  it('blocks media already curated onto this ticket (shown via photo_paths)', () => {
    expect(
      smsMediaExtraAllowedOnWorkOrder({
        ref: 'sms/a/1.jpg',
        thisTicketPhotoPaths: new Set(['sms/a/1.jpg']),
        claimedByOtherTicketPhotoPaths: new Set(),
      }),
    ).toBe(false)
  })

  it('blocks media re-homed onto another ticket photo_paths (Takeira split)', () => {
    expect(
      smsMediaExtraAllowedOnWorkOrder({
        ref: 'sms/a/habc.jpg',
        thisTicketPhotoPaths: new Set(['sms/a/pest.jpg']),
        claimedByOtherTicketPhotoPaths: new Set(['sms/a/habc.jpg', 'sms/a/paint-0.jpg']),
      }),
    ).toBe(false)
  })

  it('allows unclaimed SMS media not on this ticket', () => {
    expect(
      smsMediaExtraAllowedOnWorkOrder({
        ref: 'sms/a/update.jpg',
        thisTicketPhotoPaths: new Set(['sms/a/pest.jpg']),
        claimedByOtherTicketPhotoPaths: new Set(),
      }),
    ).toBe(true)
  })
})

describe('shouldSkipUnclaimedSmsMediaExtras', () => {
  it('skips late SMS extras when curated photo_paths exist and a later WO exists', () => {
    expect(
      shouldSkipUnclaimedSmsMediaExtras({
        thisTicketPhotoPathCount: 1,
        nextTicketCreatedAt: ticketB,
      }),
    ).toBe(true)
  })

  it('still loads SMS extras when this ticket has no photo_paths yet', () => {
    expect(
      shouldSkipUnclaimedSmsMediaExtras({
        thisTicketPhotoPathCount: 0,
        nextTicketCreatedAt: ticketB,
      }),
    ).toBe(false)
  })

  it('still loads SMS extras when there is no later sibling work order', () => {
    expect(
      shouldSkipUnclaimedSmsMediaExtras({
        thisTicketPhotoPathCount: 2,
        nextTicketCreatedAt: null,
      }),
    ).toBe(false)
  })
})

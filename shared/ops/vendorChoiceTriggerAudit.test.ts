import { describe, expect, it } from 'vitest'
import {
  findPhantomVendorChoiceSelected,
  isConfirmedDurableInboundTrigger,
  VENDOR_CHOICE_TRIGGER_WINDOW_MS,
} from './vendorChoiceTriggerAudit.ts'

describe('vendorChoiceTriggerAudit', () => {
  it('confirms a durable inbound row matching message/conversation/landlord', () => {
    const result = isConfirmedDurableInboundTrigger(
      {
        id: 'msg-1',
        direction: 'inbound',
        conversation_id: 'conv-1',
        landlord_id: 'll-1',
        provider_message_sid: 'SM123',
      },
      { messageId: 'msg-1', conversationId: 'conv-1', landlordId: 'll-1' },
    )
    expect(result).toEqual({
      ok: true,
      messageId: 'msg-1',
      providerMessageSid: 'SM123',
    })
  })

  it('refuses when the triggering row is missing (forced race)', () => {
    expect(
      isConfirmedDurableInboundTrigger(null, {
        messageId: 'msg-missing',
        conversationId: 'conv-1',
        landlordId: 'll-1',
      }),
    ).toEqual({ ok: false, reason: 'inbound_row_not_found' })
  })

  it('refuses outbound or mismatched conversation rows', () => {
    expect(
      isConfirmedDurableInboundTrigger(
        {
          id: 'msg-1',
          direction: 'outbound',
          conversation_id: 'conv-1',
          landlord_id: 'll-1',
        },
        { messageId: 'msg-1', conversationId: 'conv-1', landlordId: 'll-1' },
      ).ok,
    ).toBe(false)
    expect(
      isConfirmedDurableInboundTrigger(
        {
          id: 'msg-1',
          direction: 'inbound',
          conversation_id: 'other',
          landlord_id: 'll-1',
        },
        { messageId: 'msg-1', conversationId: 'conv-1', landlordId: 'll-1' },
      ).ok,
    ).toBe(false)
  })

  it('flags a synthetic phantom vendor_choice_selected fixture', () => {
    const phantoms = findPhantomVendorChoiceSelected({
      windowMs: VENDOR_CHOICE_TRIGGER_WINDOW_MS,
      events: [
        {
          id: 'ev-phantom',
          created_at: '2026-09-15T03:54:54.448Z',
          landlord_id: 'll-1',
          conversation_id: 'conv-1',
          message_id: null,
          maintenance_request_id: 'ticket-1',
          metadata: { message: 'Assigned Ivan after the landlord confirmed.' },
        },
        {
          id: 'ev-ok',
          created_at: '2026-09-15T04:35:43.901Z',
          landlord_id: 'll-1',
          conversation_id: 'conv-1',
          message_id: 'msg-yes',
          maintenance_request_id: 'ticket-2',
          metadata: { provider_message_sid: 'SM-ok' },
        },
      ],
      inboundMessages: [
        {
          id: 'msg-yes',
          created_at: '2026-09-15T04:35:42.300Z',
          conversation_id: 'conv-1',
          landlord_id: 'll-1',
          direction: 'inbound',
        },
      ],
    })

    expect(phantoms).toHaveLength(1)
    expect(phantoms[0]?.eventId).toBe('ev-phantom')
    expect(phantoms[0]?.reasons).toContain('no_inbound_in_preceding_window')
    expect(phantoms[0]?.reasons).toContain('event_message_id_null')
  })
})

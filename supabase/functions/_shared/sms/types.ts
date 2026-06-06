/** Supported SMS provider identifiers (matches `sms_providers.name`). */
export type SmsProviderName = "twilio" | "telnyx"

export type SendMessageInput = {
  to: string
  body: string
  /** E.164 sender; used when not sending via Messaging Service. */
  from?: string
  mediaUrls?: string[]
}

export type SendMessageResult = {
  provider: SmsProviderName
  /** Provider message SID (e.g. Twilio MessageSid). */
  providerMessageSid?: string
  /** @deprecated Use providerMessageSid; kept for transitional callers. */
  messageId?: string
  status?: string
  error?: string
}

export type InboundSMSMessage = {
  provider: SmsProviderName
  providerMessageSid: string
  /** @deprecated Use providerMessageSid. */
  messageId: string
  from: string
  to: string
  body: string
  mediaUrls: string[]
  rawPayload: Record<string, unknown>
}

export type SMSStatusUpdate = {
  provider: SmsProviderName
  providerMessageSid: string
  /** @deprecated Use providerMessageSid. */
  messageId: string
  status: string
  errorCode?: string
  from?: string
  to?: string
  rawPayload: Record<string, unknown>
}

export type ProvisionNumberInput = {
  country?: string
  areaCode?: string
  phoneNumber?: string
  messagingServiceSid?: string
  /** When the number already exists in Twilio console. */
  providerNumberSid?: string
}

export type ProvisionedNumber = {
  provider: SmsProviderName
  phoneNumber: string
  providerNumberSid: string
  messagingServiceSid?: string
}

export type ReleaseNumberInput = {
  providerNumberSid: string
}

/** Preserved webhook body + headers for provider signature validation. */
export type InboundWebhookContext = {
  rawBody: string
  signature: string
  /** Must exactly match the URL configured in the provider console. */
  url: string
}

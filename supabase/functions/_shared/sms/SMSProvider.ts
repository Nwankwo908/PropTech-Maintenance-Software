import type {
  InboundSMSMessage,
  InboundWebhookContext,
  ProvisionNumberInput,
  ProvisionedNumber,
  ReleaseNumberInput,
  SendMessageInput,
  SendMessageResult,
  SmsProviderName,
  SMSStatusUpdate,
} from "./types.ts"

/** Provider-agnostic SMS operations (Twilio, Telnyx, …). */
export interface SMSProvider {
  readonly name: SmsProviderName

  sendMessage(input: SendMessageInput): Promise<SendMessageResult>

  normalizeInboundWebhook(
    rawRequest: Request,
    context?: InboundWebhookContext,
  ): Promise<InboundSMSMessage>

  normalizeStatusWebhook(rawRequest: Request): Promise<SMSStatusUpdate>

  provisionNumber(input: ProvisionNumberInput): Promise<ProvisionedNumber>

  releaseNumber(input: ReleaseNumberInput): Promise<void>
}

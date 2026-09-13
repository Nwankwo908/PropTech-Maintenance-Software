import type { SMSProvider } from "./SMSProvider.ts"
import { TwilioProvider } from "./TwilioProvider.ts"
import type { SmsProviderName } from "./types.ts"

let cachedProvider: SMSProvider | null = null

export function resolveProviderName(): SmsProviderName {
  return "twilio"
}

export function getSMSProviderFor(_name?: SmsProviderName): SMSProvider {
  return getSMSProvider()
}

/** Provider that should send this landlord's outbound SMS. Twilio is the only provider. */
export function smsProviderNameForSend(_params?: {
  landlordId?: string | null
  lineProvider?: string | null
}): SmsProviderName {
  return "twilio"
}

export function getSMSProviderForSend(_params?: {
  landlordId?: string | null
  lineProvider?: string | null
}): SMSProvider {
  return getSMSProvider()
}

/** Returns the configured SMS provider (singleton per isolate). */
export function getSMSProvider(): SMSProvider {
  if (!cachedProvider) cachedProvider = new TwilioProvider()
  return cachedProvider
}

/** Clears cached provider (useful in tests). */
export function resetSMSProviderCache(): void {
  cachedProvider = null
}

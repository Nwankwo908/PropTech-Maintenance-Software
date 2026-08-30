import { landlordUsesTwilioSms } from "../../../../shared/landlordCapabilities.ts"
import type { SMSProvider } from "./SMSProvider.ts"
import { TelnyxProvider } from "./TelnyxProvider.ts"
import { TwilioProvider } from "./TwilioProvider.ts"
import type { SmsProviderName } from "./types.ts"

let cachedProvider: SMSProvider | null = null
let cachedProviderName: SmsProviderName | null = null
const namedProviders: Partial<Record<SmsProviderName, SMSProvider>> = {}

export function resolveProviderName(): SmsProviderName {
  const raw = Deno.env.get("SMS_PROVIDER")?.trim().toLowerCase() || "telnyx"
  if (raw === "twilio") return "twilio"
  if (raw === "telnyx") return "telnyx"
  throw new Error(`Unknown SMS_PROVIDER: ${raw}`)
}

export function getSMSProviderFor(name: SmsProviderName): SMSProvider {
  const existing = namedProviders[name]
  if (existing) return existing
  const created = name === "twilio" ? new TwilioProvider() : new TelnyxProvider()
  namedProviders[name] = created
  return created
}

/** Provider that should send this landlord's outbound SMS (Limited Alpha 1 = Twilio). */
export function smsProviderNameForSend(params: {
  landlordId?: string | null
  lineProvider?: string | null
}): SmsProviderName {
  if (landlordUsesTwilioSms(params.landlordId)) return "twilio"
  const line = (params.lineProvider ?? "").trim().toLowerCase()
  if (line === "twilio" || line === "telnyx") return line
  return resolveProviderName()
}

export function getSMSProviderForSend(params: {
  landlordId?: string | null
  lineProvider?: string | null
}): SMSProvider {
  return getSMSProviderFor(smsProviderNameForSend(params))
}

/** Returns the configured SMS provider (singleton per isolate). */
export function getSMSProvider(): SMSProvider {
  const name = resolveProviderName()
  if (cachedProvider && cachedProviderName === name) {
    return cachedProvider
  }
  cachedProvider = getSMSProviderFor(name)
  cachedProviderName = name
  return cachedProvider
}

/** Clears cached provider (useful in tests). */
export function resetSMSProviderCache(): void {
  cachedProvider = null
  cachedProviderName = null
  namedProviders.twilio = undefined
  namedProviders.telnyx = undefined
}

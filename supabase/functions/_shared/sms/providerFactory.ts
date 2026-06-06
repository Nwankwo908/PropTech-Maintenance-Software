import type { SMSProvider } from "./SMSProvider.ts"
import { TelnyxProvider } from "./TelnyxProvider.ts"
import { TwilioProvider } from "./TwilioProvider.ts"
import type { SmsProviderName } from "./types.ts"

let cachedProvider: SMSProvider | null = null
let cachedProviderName: SmsProviderName | null = null

function resolveProviderName(): SmsProviderName {
  const raw = Deno.env.get("SMS_PROVIDER")?.trim().toLowerCase() || "twilio"
  if (raw === "twilio") return "twilio"
  if (raw === "telnyx") return "telnyx"
  throw new Error(`Unknown SMS_PROVIDER: ${raw}`)
}

/** Returns the configured SMS provider (singleton per isolate). */
export function getSMSProvider(): SMSProvider {
  const name = resolveProviderName()
  if (cachedProvider && cachedProviderName === name) {
    return cachedProvider
  }

  if (name === "twilio") {
    cachedProvider = new TwilioProvider()
    cachedProviderName = name
    return cachedProvider
  }

  if (name === "telnyx") {
    cachedProvider = new TelnyxProvider()
    cachedProviderName = name
    return cachedProvider
  }

  throw new Error(`Unknown SMS_PROVIDER: ${name}`)
}

/** Clears cached provider (useful in tests). */
export function resetSMSProviderCache(): void {
  cachedProvider = null
  cachedProviderName = null
}

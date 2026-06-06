import type { SMSProvider } from "./SMSProvider.ts"
import type {
  InboundSMSMessage,
  InboundWebhookContext,
  ProvisionNumberInput,
  ProvisionedNumber,
  ReleaseNumberInput,
  SendMessageInput,
  SendMessageResult,
  SMSStatusUpdate,
} from "./types.ts"

const PROVISION_STUB_ERROR =
  "Telnyx number provisioning via API is not enabled yet. Register the number in Telnyx Mission Control and pass phoneNumber plus providerNumberSid."

const RELEASE_STUB_LOG =
  "[TelnyxProvider] releaseNumber stubbed — no Telnyx API call"

const WEBHOOK_TOLERANCE_SEC = 300

export type TelnyxConfig = {
  apiKey: string
  fromNumber?: string
  messagingProfileId?: string
  publicKey?: string
  statusCallbackUrl?: string
}

type TelnyxWebhookEvent = {
  data?: {
    event_type?: string
    id?: string
    occurred_at?: string
    payload?: TelnyxMessagePayload
  }
  meta?: Record<string, unknown>
}

type TelnyxMessagePayload = {
  id?: string
  direction?: string
  text?: string
  from?: { phone_number?: string }
  to?: Array<{ phone_number?: string; status?: string }>
  media?: Array<{ url?: string }>
  errors?: Array<{ code?: string; title?: string; detail?: string }>
}

export function readTelnyxConfig(): TelnyxConfig | { error: string } {
  const smsProvider = Deno.env.get("SMS_PROVIDER")?.trim().toLowerCase()
  if (smsProvider && smsProvider !== "telnyx") {
    return { error: `SMS_PROVIDER must be telnyx (got ${smsProvider})` }
  }

  const apiKey = Deno.env.get("TELNYX_API_KEY")?.trim()
  if (!apiKey) {
    return { error: "Telnyx not configured: TELNYX_API_KEY required" }
  }

  const fromNumber = Deno.env.get("TELNYX_FROM_NUMBER")?.trim() || undefined
  const messagingProfileId =
    Deno.env.get("TELNYX_MESSAGING_PROFILE_ID")?.trim() || undefined
  const publicKey = Deno.env.get("TELNYX_PUBLIC_KEY")?.trim() || undefined
  const statusCallbackUrl =
    Deno.env.get("TELNYX_STATUS_CALLBACK_URL")?.trim() || undefined

  if (!fromNumber && !messagingProfileId) {
    return {
      error:
        "Telnyx not configured: set TELNYX_FROM_NUMBER and/or TELNYX_MESSAGING_PROFILE_ID",
    }
  }

  return {
    apiKey,
    fromNumber,
    messagingProfileId,
    publicKey,
    statusCallbackUrl,
  }
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function importTelnyxPublicKey(publicKeyMaterial: string): Promise<CryptoKey> {
  const cleaned = publicKeyMaterial.trim().replace(/\s/g, "")

  let raw: Uint8Array
  if (/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    raw = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      raw[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
    }
  } else {
    raw = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0))
  }

  if (raw.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 public key, got ${raw.length}`)
  }

  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP",
      crv: "Ed25519",
      x: base64UrlFromBytes(raw),
      key_ops: ["verify"],
      ext: true,
    },
    { name: "Ed25519" },
    false,
    ["verify"],
  )
}

async function verifyTelnyxWebhook(
  rawBody: string,
  signatureB64: string,
  timestamp: string,
  publicKeyMaterial: string,
): Promise<void> {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    throw new Error("Invalid telnyx-timestamp")
  }

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SEC) {
    throw new Error("Telnyx webhook timestamp outside tolerance")
  }

  const key = await importTelnyxPublicKey(publicKeyMaterial)
  const signature = Uint8Array.from(atob(signatureB64.trim()), (c) =>
    c.charCodeAt(0)
  )
  const signedPayload = new TextEncoder().encode(`${timestamp}|${rawBody}`)
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signature,
    signedPayload,
  )

  if (!valid) {
    throw new Error("Invalid Telnyx webhook signature")
  }
}

function parseTelnyxEvent(rawBody: string): TelnyxWebhookEvent {
  try {
    return JSON.parse(rawBody) as TelnyxWebhookEvent
  } catch {
    throw new Error("Invalid Telnyx webhook JSON payload")
  }
}

function telnyxHeaders(rawRequest: Request): {
  signature: string
  timestamp: string
} {
  return {
    signature: rawRequest.headers.get("telnyx-signature-ed25519") ?? "",
    timestamp: rawRequest.headers.get("telnyx-timestamp") ?? "",
  }
}

async function readAndVerifyTelnyxWebhook(
  rawRequest: Request,
  rawBody: string,
  publicKeyMaterial?: string,
): Promise<TelnyxWebhookEvent> {
  const { signature, timestamp } = telnyxHeaders(rawRequest)

  if (publicKeyMaterial) {
    if (!signature || !timestamp) {
      throw new Error("Missing Telnyx webhook signature headers")
    }
    await verifyTelnyxWebhook(rawBody, signature, timestamp, publicKeyMaterial)
  } else {
    console.warn(
      "[TelnyxProvider] TELNYX_PUBLIC_KEY not set — skipping webhook signature verification",
    )
  }

  return parseTelnyxEvent(rawBody)
}

function extractFromNumber(payload: TelnyxMessagePayload): string {
  return payload.from?.phone_number?.trim() ?? ""
}

function extractToNumber(payload: TelnyxMessagePayload): string {
  const first = payload.to?.[0]?.phone_number
  return typeof first === "string" ? first.trim() : ""
}

function extractMediaUrls(payload: TelnyxMessagePayload): string[] {
  const urls: string[] = []
  for (const item of payload.media ?? []) {
    const url = item.url?.trim()
    if (url) urls.push(url)
  }
  return urls
}

function extractDeliveryStatus(payload: TelnyxMessagePayload): string {
  const raw = payload.to?.[0]?.status?.trim()
  return raw ? normalizeTelnyxDeliveryStatus(raw) : "sent"
}

/** Map Telnyx carrier statuses to values understood by sms-status-callback. */
export function normalizeTelnyxDeliveryStatus(raw: string): string {
  const status = raw.trim().toLowerCase()
  if (status === "delivered") return "delivered"
  if (status === "delivery_failed" || status === "sending_failed") {
    return "failed"
  }
  if (status === "delivery_unconfirmed") return "undelivered"
  return status
}

function successSendResult(
  providerMessageSid: string,
  status?: string,
): SendMessageResult {
  return {
    provider: "telnyx",
    providerMessageSid,
    messageId: providerMessageSid,
    status,
  }
}

function inboundFromPayload(
  payload: TelnyxMessagePayload,
  rawPayload: Record<string, unknown>,
): InboundSMSMessage {
  const providerMessageSid = payload.id?.trim() ?? ""
  const from = extractFromNumber(payload)
  const to = extractToNumber(payload)

  if (!providerMessageSid || !from || !to) {
    throw new Error("Incomplete Telnyx inbound webhook payload")
  }

  return {
    provider: "telnyx",
    providerMessageSid,
    messageId: providerMessageSid,
    from,
    to,
    body: payload.text ?? "",
    mediaUrls: extractMediaUrls(payload),
    rawPayload,
  }
}

function statusFromPayload(
  payload: TelnyxMessagePayload,
  eventType: string,
  rawPayload: Record<string, unknown>,
): SMSStatusUpdate {
  const providerMessageSid = payload.id?.trim() ?? ""
  const status = eventType === "message.sent"
    ? "sent"
    : extractDeliveryStatus(payload)

  if (!providerMessageSid || !status) {
    throw new Error("Incomplete Telnyx status webhook payload")
  }

  const errorCode = payload.errors?.[0]?.code?.trim()

  return {
    provider: "telnyx",
    providerMessageSid,
    messageId: providerMessageSid,
    status,
    errorCode: errorCode || undefined,
    from: extractFromNumber(payload) || undefined,
    to: extractToNumber(payload) || undefined,
    rawPayload,
  }
}

export class TelnyxProvider implements SMSProvider {
  readonly name = "telnyx" as const

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const cfg = readTelnyxConfig()
    if ("error" in cfg) {
      return { provider: "telnyx", error: cfg.error }
    }

    const body: Record<string, unknown> = {
      to: input.to.trim(),
      text: input.body,
    }

    const explicitFrom = input.from?.trim()
    if (explicitFrom) {
      body.from = explicitFrom
    } else if (cfg.fromNumber) {
      body.from = cfg.fromNumber
    } else if (cfg.messagingProfileId) {
      body.messaging_profile_id = cfg.messagingProfileId
    } else {
      return {
        provider: "telnyx",
        error: "Telnyx send requires from, TELNYX_FROM_NUMBER, or TELNYX_MESSAGING_PROFILE_ID",
      }
    }

    const mediaUrls = (input.mediaUrls ?? [])
      .map((url) => url.trim())
      .filter(Boolean)
    if (mediaUrls.length > 0) {
      body.media_urls = mediaUrls
    }

    if (cfg.statusCallbackUrl) {
      body.webhook_url = cfg.statusCallbackUrl
    }

    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    const raw = await res.text()
    if (!res.ok) {
      console.error("[TelnyxProvider] sendMessage error", res.status, raw)
      return {
        provider: "telnyx",
        error: raw.slice(0, 500) || `Telnyx HTTP ${res.status}`,
      }
    }

    try {
      const parsed = JSON.parse(raw) as {
        data?: { id?: string; to?: Array<{ status?: string }> }
      }
      const sid = parsed.data?.id?.trim() || "sent"
      const status = parsed.data?.to?.[0]?.status
      return successSendResult(sid, status)
    } catch {
      return successSendResult("sent")
    }
  }

  async normalizeInboundWebhook(
    rawRequest: Request,
    context?: InboundWebhookContext,
  ): Promise<InboundSMSMessage> {
    const cfg = readTelnyxConfig()
    if ("error" in cfg) throw new Error(cfg.error)

    const rawBody = context?.rawBody ?? await rawRequest.text()
    const event = await readAndVerifyTelnyxWebhook(
      rawRequest,
      rawBody,
      cfg.publicKey,
    )

    const eventType = event.data?.event_type?.trim() ?? ""
    if (eventType !== "message.received") {
      throw new Error(`Unsupported Telnyx inbound event_type: ${eventType || "(missing)"}`)
    }

    const payload = event.data?.payload
    if (!payload) {
      throw new Error("Missing Telnyx message.received payload")
    }

    return inboundFromPayload(payload, event as unknown as Record<string, unknown>)
  }

  async normalizeStatusWebhook(rawRequest: Request): Promise<SMSStatusUpdate> {
    const cfg = readTelnyxConfig()
    if ("error" in cfg) throw new Error(cfg.error)

    const rawBody = await rawRequest.text()
    const event = await readAndVerifyTelnyxWebhook(
      rawRequest,
      rawBody,
      cfg.publicKey,
    )

    const eventType = event.data?.event_type?.trim() ?? ""
    if (
      eventType !== "message.sent" &&
      eventType !== "message.finalized"
    ) {
      throw new Error(`Unsupported Telnyx status event_type: ${eventType || "(missing)"}`)
    }

    const payload = event.data?.payload
    if (!payload) {
      throw new Error(`Missing Telnyx ${eventType} payload`)
    }

    return statusFromPayload(
      payload,
      eventType,
      event as unknown as Record<string, unknown>,
    )
  }

  async provisionNumber(input: ProvisionNumberInput): Promise<ProvisionedNumber> {
    const cfg = readTelnyxConfig()
    if ("error" in cfg) throw new Error(cfg.error)

    const phoneNumber = input.phoneNumber?.trim()
    const providerNumberSid = input.providerNumberSid?.trim()

    if (!phoneNumber) {
      throw new Error(PROVISION_STUB_ERROR)
    }

    if (!providerNumberSid) {
      throw new Error(
        `${PROVISION_STUB_ERROR} Include providerNumberSid (Telnyx phone number id).`,
      )
    }

    return {
      provider: "telnyx",
      phoneNumber,
      providerNumberSid,
      messagingServiceSid:
        input.messagingServiceSid?.trim() ||
        cfg.messagingProfileId ||
        undefined,
    }
  }

  async releaseNumber(input: ReleaseNumberInput): Promise<void> {
    const sid = input.providerNumberSid?.trim()
    if (!sid) throw new Error("providerNumberSid is required")
    console.warn(RELEASE_STUB_LOG, sid)
  }
}

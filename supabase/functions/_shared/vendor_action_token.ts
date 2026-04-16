/**
 * HMAC-SHA256 signed tokens for vendor email Accept / Decline links.
 * Set secret: `VENDOR_EMAIL_ACTION_SECRET` in Edge Function env (32+ chars recommended).
 */

export type EmailActionPayload = {
  ticketId: string
  vendorId: string
  action: "accept" | "decline"
  /** Unix seconds */
  exp: number
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

/** Default 24h */
const DEFAULT_TTL_SEC = 86_400

export async function signVendorEmailAction(
  secret: string,
  parts: Omit<EmailActionPayload, "exp">,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const payload: EmailActionPayload = { ...parts, exp }
  const payloadStr = JSON.stringify(payload)
  const data = new TextEncoder().encode(payloadStr)
  const key = await importHmacKey(secret)
  const sigBuf = await crypto.subtle.sign(
    { name: "HMAC", hash: "SHA-256" },
    key,
    data.buffer as ArrayBuffer,
  )
  return `${toBase64Url(data.buffer)}.${toBase64Url(sigBuf)}`
}

export async function verifyVendorEmailAction(
  secret: string,
  token: string,
): Promise<EmailActionPayload | null> {
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  let data: Uint8Array
  let sig: Uint8Array
  try {
    data = fromBase64Url(parts[0]!)
    sig = fromBase64Url(parts[1]!)
  } catch {
    return null
  }
  const key = await importHmacKey(secret)
  const ok = await crypto.subtle.verify(
    { name: "HMAC", hash: "SHA-256" },
    key,
    sig.buffer as ArrayBuffer,
    data.buffer as ArrayBuffer,
  )
  if (!ok) return null
  let parsed: EmailActionPayload
  try {
    parsed = JSON.parse(new TextDecoder().decode(data)) as EmailActionPayload
  } catch {
    return null
  }
  if (
    typeof parsed.ticketId !== "string" ||
    typeof parsed.vendorId !== "string" ||
    (parsed.action !== "accept" && parsed.action !== "decline") ||
    typeof parsed.exp !== "number"
  ) {
    return null
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null
  return parsed
}

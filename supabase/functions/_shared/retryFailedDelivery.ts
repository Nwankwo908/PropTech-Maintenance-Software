/**
 * Auth, eligibility, and the atomic retry claim for retry-failed-delivery.
 * The database function claim_delivery_retry uses the same predicates.
 */
import { timingSafeEqualHex } from "./inspectionCapture/token.ts"

export type RetrySource = "resident" | "vendor" | "broadcast"
export type RetryChannel = "email" | "sms"

export const RETRY_LIMIT = 3
export const RETRY_GAP_MS = 5 * 60 * 1000
export const RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const RETRY_HOURLY_LIMIT = 30

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ulo-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

export type DeliveryLog = {
  id: string
  landlordId: string
  source: RetrySource
  channel: RetryChannel
  status: string
  createdAt: string
  retryCount: number
  lastRetryAt: string | null
  recipientOptedOut: boolean
  results: Record<string, Record<string, unknown>>
}

export type ClaimOutcome =
  | { kind: "deny"; status: number; reason: string }
  | { kind: "replay"; body: Record<string, unknown> }
  | { kind: "send"; retryCount: number; idempotencyKey: string }

export type RetryDeps = {
  now?: () => Date
  env: { internalKey: string; anonKey: string }
  resolveLandlords: (jwt: string) => Promise<string[] | null>
  loadLog: (input: {
    source: RetrySource
    logId: string
    landlordIds: string[] | null
  }) => Promise<DeliveryLog | null>
  claim: (log: DeliveryLog) => Promise<ClaimOutcome>
  send: (log: DeliveryLog) => Promise<void>
  storeResult: (key: string, body: Record<string, unknown>) => Promise<void>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function deny(status: number, reason: string): ClaimOutcome {
  return { kind: "deny", status, reason }
}

export function retryIdempotencyKey(logId: string, retryCount: number): string {
  return `${logId}:${retryCount}`
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization")?.trim() ?? ""
  if (!header.toLowerCase().startsWith("bearer ")) return null
  const token = header.slice(7).trim()
  return token || null
}

function jwtRole(token: string): string {
  const parts = token.split(".")
  if (parts.length !== 3) return ""
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    const payload = JSON.parse(json) as { role?: unknown }
    return typeof payload.role === "string" ? payload.role.trim().toLowerCase() : ""
  } catch {
    return ""
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Constant-time string compare. Unequal lengths still compare full hashes. */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)])
  return timingSafeEqualHex(left, right)
}

export async function authorizeRetryCaller(
  req: Request,
  env: { internalKey: string; anonKey: string },
): Promise<
  | { ok: true; mode: "internal" }
  | { ok: true; mode: "user"; token: string }
  | { ok: false }
> {
  const anon = env.anonKey.trim()
  const internal = env.internalKey.trim()
  const presented = req.headers.get("x-ulo-internal-key")?.trim() ?? ""
  if (presented) {
    if (!internal || !anon || internal === anon || presented === anon) return { ok: false }
    const match = await timingSafeEqualString(presented, internal)
    return match ? { ok: true, mode: "internal" } : { ok: false }
  }
  const token = bearerToken(req)
  if (!token || token === anon || jwtRole(token) === "anon") return { ok: false }
  return { ok: true, mode: "user", token }
}

/**
 * One claim decision. Callers must invoke this only after a compare-and-swap
 * on retryCount (the SQL update's `retry_count = expected` lock).
 */
export function commitRetryClaim(
  row: DeliveryLog,
  now: Date,
  recentRetries: number,
): ClaimOutcome {
  if (row.recipientOptedOut) return deny(409, "opted_out")
  const status = row.status.trim().toLowerCase()
  if (status !== "failed" && status !== "undelivered") return deny(409, "not_failed")
  const created = new Date(row.createdAt).getTime()
  if (!Number.isFinite(created) || now.getTime() - created >= RETRY_MAX_AGE_MS) {
    return deny(409, "expired")
  }
  if (row.retryCount >= RETRY_LIMIT) return deny(429, "retry_limit")
  if (row.retryCount > 0 && row.lastRetryAt) {
    const last = new Date(row.lastRetryAt).getTime()
    if (Number.isFinite(last) && now.getTime() - last < RETRY_GAP_MS) {
      const key = retryIdempotencyKey(row.id, row.retryCount)
      const stored = row.results[key]
      if (stored) return { kind: "replay", body: stored }
      return deny(429, "retry_gap")
    }
  }
  if (recentRetries >= RETRY_HOURLY_LIMIT) return deny(429, "rate_limit")
  row.retryCount += 1
  row.lastRetryAt = now.toISOString()
  return {
    kind: "send",
    retryCount: row.retryCount,
    idempotencyKey: retryIdempotencyKey(row.id, row.retryCount),
  }
}

/** Lost the compare-and-swap: replay the stored attempt, otherwise 429. */
export function lostRetryClaim(row: DeliveryLog): ClaimOutcome {
  const key = retryIdempotencyKey(row.id, row.retryCount)
  const stored = row.results[key]
  if (stored) return { kind: "replay", body: stored }
  return deny(429, "conflict")
}

export async function handleRetryFailedDelivery(
  req: Request,
  deps: RetryDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  const auth = await authorizeRetryCaller(req, deps.env)
  if (!auth.ok) return jsonResponse({ error: "Unauthorized" }, 401)

  let body: { source?: RetrySource; logId?: string; channel?: RetryChannel }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }
  const source = body.source
  const logId = typeof body.logId === "string" ? body.logId.trim() : ""
  const channel = body.channel
  if (source !== "resident" && source !== "vendor" && source !== "broadcast") {
    return jsonResponse({ error: "Invalid source" }, 400)
  }
  if (!logId) return jsonResponse({ error: "Missing logId" }, 400)
  if (channel !== "email" && channel !== "sms") {
    return jsonResponse({ error: "Invalid channel" }, 400)
  }

  let landlordIds: string[] | null = null
  if (auth.mode === "user") {
    landlordIds = await deps.resolveLandlords(auth.token)
    if (!landlordIds) return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const log = await deps.loadLog({ source, logId, landlordIds })
  if (!log || log.channel !== channel) return jsonResponse({ error: "Not found" }, 404)

  const outcome = await deps.claim(log)
  if (outcome.kind === "deny") {
    return jsonResponse({ error: outcome.reason }, outcome.status)
  }
  if (outcome.kind === "replay") {
    return jsonResponse(outcome.body, 200)
  }

  try {
    await deps.send(log)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed"
    return jsonResponse({ error: message }, 400)
  }

  const result = {
    ok: true,
    source,
    logId,
    channel,
    idempotencyKey: outcome.idempotencyKey,
  }
  await deps.storeResult(outcome.idempotencyKey, result)
  return jsonResponse(result, 200)
}

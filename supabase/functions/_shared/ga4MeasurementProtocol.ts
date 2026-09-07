/**
 * Server-side GA4 Measurement Protocol for product events that happen off-browser
 * (SMS intake, auto-assign, vendor complete).
 *
 * Env (Edge secrets, never VITE_):
 *   GA4_MEASUREMENT_ID  — same G- id as VITE_GA4_MEASUREMENT_ID
 *   GA4_API_SECRET      — GA4 Admin → Data collection → Measurement Protocol API secrets
 *
 * client_id is a SHA-256 fold of landlord_id (not the raw UUID). Events are not
 * stitched to the browser gtag session. Best-effort; never throw.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { VENDOR_TRADE_SLUGS } from "./vendor_trades.ts"

const TRADE_SLUGS = new Set<string>(VENDOR_TRADE_SLUGS)

export const SERVER_PRODUCT_EVENTS = [
  "maintenance_request_started",
  "maintenance_request_completed",
  "job_created",
  "vendor_matched",
  "job_completed",
  "second_job_created",
  "repeat_usage",
] as const

export type ServerProductEvent = (typeof SERVER_PRODUCT_EVENTS)[number]

export type ServerProductEventProps = {
  job_type?: string
  property_count?: number
  unit_count?: number
}

function measurementId(): string {
  return (Deno.env.get("GA4_MEASUREMENT_ID") ?? "").trim()
}

function apiSecret(): string {
  return (Deno.env.get("GA4_API_SECRET") ?? "").trim()
}

export function isServerGa4Configured(): boolean {
  return Boolean(measurementId() && apiSecret())
}

function analyticsJobType(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined
  const slug = raw.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (!slug || !TRADE_SLUGS.has(slug)) return undefined
  return slug
}

function finiteCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

function approvedParams(
  properties: ServerProductEventProps | undefined,
  acquisition: {
    acquisition_source?: string | null
    acquisition_medium?: string | null
    acquisition_campaign?: string | null
  },
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const source = typeof acquisition.acquisition_source === "string"
    ? acquisition.acquisition_source.trim().toLowerCase()
    : ""
  const medium = typeof acquisition.acquisition_medium === "string"
    ? acquisition.acquisition_medium.trim().toLowerCase()
    : ""
  const campaign = typeof acquisition.acquisition_campaign === "string"
    ? acquisition.acquisition_campaign.trim().toLowerCase()
    : ""
  if (source && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(source)) {
    out.acquisition_source = source
  }
  if (medium && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(medium)) {
    out.acquisition_medium = medium
  }
  if (campaign && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(campaign)) {
    out.acquisition_campaign = campaign
  }
  const jobType = analyticsJobType(properties?.job_type)
  const propertyCount = finiteCount(properties?.property_count)
  const unitCount = finiteCount(properties?.unit_count)
  if (jobType) out.job_type = jobType
  if (propertyCount != null) out.property_count = propertyCount
  if (unitCount != null) out.unit_count = unitCount
  out.engagement_time_msec = 1
  return out
}

async function hashedClientId(landlordId: string): Promise<string> {
  const data = new TextEncoder().encode(`ulo-ga4-cid:${landlordId}`)
  const buf = await crypto.subtle.digest("SHA-256", data)
  const view = new DataView(buf)
  return `${view.getUint32(0)}.${view.getUint32(4)}`
}

async function loadLandlordAcquisition(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{
  acquisition_source?: string | null
  acquisition_medium?: string | null
  acquisition_campaign?: string | null
}> {
  const { data } = await supabase
    .from("landlords")
    .select("acquisition_source, acquisition_medium, acquisition_campaign")
    .eq("id", landlordId)
    .maybeSingle()
  return {
    acquisition_source: typeof data?.acquisition_source === "string" ? data.acquisition_source : null,
    acquisition_medium: typeof data?.acquisition_medium === "string" ? data.acquisition_medium : null,
    acquisition_campaign:
      typeof data?.acquisition_campaign === "string" ? data.acquisition_campaign : null,
  }
}

export async function emitServerProductEvent(
  supabase: SupabaseClient,
  input: {
    eventName: ServerProductEvent
    landlordId: string | null | undefined
    properties?: ServerProductEventProps
  },
): Promise<void> {
  try {
    if (!isServerGa4Configured()) return
    const landlordId = input.landlordId?.trim()
    if (!landlordId) return
    const id = measurementId()
    const secret = apiSecret()
    const [clientId, acquisition] = await Promise.all([
      hashedClientId(landlordId),
      loadLandlordAcquisition(supabase, landlordId),
    ])
    const params = approvedParams(input.properties, acquisition)
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          events: [{ name: input.eventName, params }],
        }),
      },
    )
    if (!res.ok) {
      console.info("[ga4-mp]", { ok: false, status: res.status, event: input.eventName })
    }
  } catch (err) {
    console.info("[ga4-mp] skipped", err instanceof Error ? err.message : "error")
  }
}

async function countLandlordJobs(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("maintenance_requests")
    .select("id", { count: "exact", head: true })
    .eq("landlord_id", landlordId)
    .neq("vendor_work_status", "cancelled")
  if (error || count == null) return null
  return count
}

/** Ticket insert succeeded: filing completed + canonical job created. */
export async function emitJobCreatedBundle(
  supabase: SupabaseClient,
  input: {
    landlordId: string | null | undefined
    jobType?: string | null
  },
): Promise<void> {
  const landlordId = input.landlordId?.trim()
  if (!landlordId) return
  const jobType = analyticsJobType(input.jobType) 
  const props = jobType ? { job_type: jobType } : undefined
  await emitServerProductEvent(supabase, {
    eventName: "maintenance_request_completed",
    landlordId,
    properties: props,
  })
  await emitServerProductEvent(supabase, {
    eventName: "job_created",
    landlordId,
    properties: props,
  })
  const n = await countLandlordJobs(supabase, landlordId)
  if (n === 2) {
    await emitServerProductEvent(supabase, {
      eventName: "second_job_created",
      landlordId,
      properties: props,
    })
  } else if (n === 3) {
    await emitServerProductEvent(supabase, {
      eventName: "repeat_usage",
      landlordId,
      properties: props,
    })
  }
}

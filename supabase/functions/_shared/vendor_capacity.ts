/**
 * Vendor capacity commands (separate from account / verification status).
 *
 * A vendor can be ACTIVE (verified) but PAUSED (not accepting new jobs).
 * Existing scheduled jobs are unaffected by PAUSE.
 *
 * SMS:
 *   PAUSE      → capacity paused
 *   RESUME     → capacity active + confirmation
 *   JOBS MAX n → weekly dispatch cap; auto-pauses at cap
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"

export type VendorCapacityCommand =
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "jobs_max"; max: number }

export function parseVendorCapacityCommand(body: string): VendorCapacityCommand | null {
  const normalized = body.trim().replace(/\s+/g, " ")
  if (!normalized) return null

  if (/^pause\b/i.test(normalized) || /^paused\b/i.test(normalized)) {
    return { kind: "pause" }
  }
  if (/^resume\b/i.test(normalized) || /^unpause\b/i.test(normalized)) {
    return { kind: "resume" }
  }

  const jobsMax = normalized.match(/^jobs?\s*max(?:imum)?\s+(\d+)\s*$/i)
  if (jobsMax) {
    return { kind: "jobs_max", max: Number(jobsMax[1]) }
  }

  return null
}

export function buildVendorCapacityPausedSms(): string {
  return (
    "Got it — you're paused and won't receive new job offers.\n\n" +
    "Jobs you already accepted or scheduled are unchanged.\n\n" +
    "Reply RESUME when you're ready for new work again."
  )
}

export function buildVendorCapacityResumedSms(): string {
  return (
    "You're back on — we'll start sending you new job offers again.\n\n" +
    "Reply PAUSE anytime if you need to stop new work for a while."
  )
}

export function buildVendorJobsMaxSms(max: number, autoPaused: boolean): string {
  if (max <= 0) {
    return (
      "Weekly job cap set to 0. You're paused and won't receive new job offers until you raise the cap or reply RESUME.\n\n" +
      "Reply JOBS MAX 3 (or any number) to set a new weekly limit."
    )
  }
  const base =
    `Weekly job cap set to ${max}. Once you hit that many new assignments this week, we'll pause new offers automatically.`
  if (autoPaused) {
    return (
      `${base}\n\n` +
      `You're already at this week's cap, so new offers are paused for now. Reply RESUME if you want to take more work.`
    )
  }
  return `${base}\n\nReply PAUSE anytime to stop new offers immediately.`
}

export function buildVendorCapacityUnknownSms(): string {
  return (
    "I didn't catch that capacity update. You can reply:\n" +
    "• PAUSE — stop new job offers\n" +
    "• RESUME — start receiving jobs again\n" +
    "• JOBS MAX 3 — set a weekly job limit"
  )
}

/** Monday 00:00 UTC of the current ISO-style week. */
export function startOfUtcWeek(now = new Date()): string {
  const day = now.getUTCDay() // 0 Sun … 6 Sat
  const daysFromMonday = (day + 6) % 7
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday),
  )
  return monday.toISOString()
}

export async function countVendorWeeklyAssignments(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<number> {
  const weekStart = startOfUtcWeek()
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("id, vendor_work_status")
    .eq("assigned_vendor_id", vendorId)
    .gte("assigned_at", weekStart)

  if (error) {
    console.error("[vendor-capacity] weekly assignment count", error.message)
    return 0
  }

  let count = 0
  for (const row of data ?? []) {
    const status = String((row as { vendor_work_status?: string }).vendor_work_status ?? "")
      .trim()
      .toLowerCase()
    if (status === "declined" || status === "unassigned") continue
    count += 1
  }
  return count
}

async function syncVendorRosterActive(
  supabase: SupabaseClient,
  params: { landlordId: string; vendorId: string; verified: boolean },
): Promise<void> {
  // Account readiness stays true when verified — capacity pause is separate.
  const { error } = await supabase
    .from("vendors")
    .update({ active: params.verified })
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)
  if (error) {
    console.warn("[vendor-capacity] sync vendors.active", error.message)
  }
}

async function loadLatestVerification(
  supabase: SupabaseClient,
  params: { landlordId: string; vendorId: string },
): Promise<{ id: string; status: string; availability: string } | null> {
  const { data, error } = await supabase
    .from("vendor_verifications")
    .select("id, status, availability")
    .eq("landlord_id", params.landlordId)
    .eq("vendor_id", params.vendorId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[vendor-capacity] load verification", error.message)
    return null
  }
  if (!data) return null
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    availability: String(data.availability ?? "active"),
  }
}

export async function setVendorCapacityAvailability(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    availability: "active" | "paused"
    source: "sms" | "portal" | "system"
  },
): Promise<{ ok: true; verified: boolean } | { ok: false; error: string }> {
  const verification = await loadLatestVerification(supabase, params)
  if (!verification) {
    return { ok: false, error: "verification_not_found" }
  }

  const verified = verification.status.trim().toLowerCase() === "verified"
  const { error } = await supabase
    .from("vendor_verifications")
    .update({
      availability: params.availability,
      updated_at: new Date().toISOString(),
    })
    .eq("id", verification.id)

  if (error) {
    console.error("[vendor-capacity] update availability", error.message)
    return { ok: false, error: "update_failed" }
  }

  await syncVendorRosterActive(supabase, {
    landlordId: params.landlordId,
    vendorId: params.vendorId,
    verified,
  })

  await logGraphEvent(supabase, {
    event_type:
      params.availability === "paused"
        ? "vendor.capacity_paused"
        : "vendor.capacity_resumed",
    landlord_id: params.landlordId,
    vendor_id: params.vendorId,
    actor_type: params.source === "system" ? "system" : "vendor",
    actor_id: params.vendorId,
    source:
      params.source === "sms"
        ? "sms"
        : params.source === "portal"
          ? "vendor_portal"
          : "automation",
    metadata: {
      availability: params.availability,
      account_verified: verified,
      source: params.source,
      summary:
        params.availability === "paused"
          ? "Vendor paused new job offers."
          : "Vendor resumed new job offers.",
    },
  })

  return { ok: true, verified }
}

export async function setVendorWeeklyJobCap(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    max: number
    source: "sms" | "portal" | "system"
  },
): Promise<
  | { ok: true; max: number; weeklyCount: number; autoPaused: boolean }
  | { ok: false; error: string }
> {
  const max = Math.max(0, Math.floor(params.max))
  const { error } = await supabase
    .from("vendors")
    .update({ weekly_job_cap: max })
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)

  if (error) {
    console.error("[vendor-capacity] set weekly_job_cap", error.message)
    return { ok: false, error: "update_failed" }
  }

  const weeklyCount = await countVendorWeeklyAssignments(supabase, params.vendorId)
  let autoPaused = false
  if (weeklyCount >= max) {
    const paused = await setVendorCapacityAvailability(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      availability: "paused",
      source: params.source === "sms" ? "sms" : "system",
    })
    autoPaused = paused.ok
  }

  await logGraphEvent(supabase, {
    event_type: "vendor.weekly_job_cap_set",
    landlord_id: params.landlordId,
    vendor_id: params.vendorId,
    actor_type: "vendor",
    actor_id: params.vendorId,
    source: params.source === "sms" ? "sms" : "vendor_portal",
    metadata: {
      weekly_job_cap: max,
      weekly_count: weeklyCount,
      auto_paused: autoPaused,
      source: params.source,
      summary: `Vendor set weekly job cap to ${max}.`,
    },
  })

  return { ok: true, max, weeklyCount, autoPaused }
}

/** After a new assignment, pause capacity when the weekly cap is reached. */
export async function maybeAutoPauseVendorAtWeeklyCap(
  supabase: SupabaseClient,
  params: { landlordId: string; vendorId: string },
): Promise<{ paused: boolean; weeklyCount: number; cap: number | null }> {
  const { data: vendor, error } = await supabase
    .from("vendors")
    .select("weekly_job_cap")
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (error || !vendor) {
    if (error) console.warn("[vendor-capacity] load weekly_job_cap", error.message)
    return { paused: false, weeklyCount: 0, cap: null }
  }

  const capRaw = (vendor as { weekly_job_cap?: number | null }).weekly_job_cap
  if (capRaw == null || !Number.isFinite(Number(capRaw))) {
    return { paused: false, weeklyCount: 0, cap: null }
  }
  const cap = Math.max(0, Math.floor(Number(capRaw)))
  const weeklyCount = await countVendorWeeklyAssignments(supabase, params.vendorId)
  if (weeklyCount < cap) {
    return { paused: false, weeklyCount, cap }
  }

  const result = await setVendorCapacityAvailability(supabase, {
    landlordId: params.landlordId,
    vendorId: params.vendorId,
    availability: "paused",
    source: "system",
  })
  return { paused: result.ok, weeklyCount, cap }
}

export async function tryHandleVendorCapacityInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null | undefined
    identityType: string
    body: string
  },
): Promise<
  | { handled: false }
  | {
      handled: true
      command: VendorCapacityCommand | "unknown"
      replyBody: string
    }
> {
  if (params.identityType !== "vendor") return { handled: false }
  const vendorId = params.vendorId?.trim()
  if (!vendorId) return { handled: false }

  const command = parseVendorCapacityCommand(params.body)
  if (!command) {
    // Only claim unknown when the message looks capacity-related.
    if (/^\s*(jobs?\s*max|pause|resume|capacity)\b/i.test(params.body)) {
      return {
        handled: true,
        command: "unknown",
        replyBody: buildVendorCapacityUnknownSms(),
      }
    }
    return { handled: false }
  }

  if (command.kind === "pause") {
    const result = await setVendorCapacityAvailability(supabase, {
      landlordId: params.landlordId,
      vendorId,
      availability: "paused",
      source: "sms",
    })
    if (!result.ok) {
      return {
        handled: true,
        command,
        replyBody:
          "We couldn't update your availability just yet. Please try again in a moment, or use your verification link to pause new jobs.",
      }
    }
    return { handled: true, command, replyBody: buildVendorCapacityPausedSms() }
  }

  if (command.kind === "resume") {
    const result = await setVendorCapacityAvailability(supabase, {
      landlordId: params.landlordId,
      vendorId,
      availability: "active",
      source: "sms",
    })
    if (!result.ok) {
      return {
        handled: true,
        command,
        replyBody:
          "We couldn't resume job offers just yet. Please try again in a moment, or use your verification link to turn work back on.",
      }
    }
    return { handled: true, command, replyBody: buildVendorCapacityResumedSms() }
  }

  const capResult = await setVendorWeeklyJobCap(supabase, {
    landlordId: params.landlordId,
    vendorId,
    max: command.max,
    source: "sms",
  })
  if (!capResult.ok) {
    return {
      handled: true,
      command,
      replyBody:
        "We couldn't save that weekly job limit. Please try again in a moment (for example: JOBS MAX 3).",
    }
  }
  return {
    handled: true,
    command,
    replyBody: buildVendorJobsMaxSms(capResult.max, capResult.autoPaused),
  }
}

/** True when weekly assignments have already reached the vendor's cap. */
export async function isVendorAtWeeklyJobCap(
  supabase: SupabaseClient,
  params: { landlordId: string; vendorId: string; weeklyJobCap?: number | null },
): Promise<boolean> {
  let cap = params.weeklyJobCap
  if (cap == null) {
    const { data } = await supabase
      .from("vendors")
      .select("weekly_job_cap")
      .eq("id", params.vendorId)
      .eq("landlord_id", params.landlordId)
      .maybeSingle()
    cap = (data as { weekly_job_cap?: number | null } | null)?.weekly_job_cap ?? null
  }
  if (cap == null || !Number.isFinite(Number(cap))) return false
  const limit = Math.max(0, Math.floor(Number(cap)))
  const weeklyCount = await countVendorWeeklyAssignments(supabase, params.vendorId)
  return weeklyCount >= limit
}

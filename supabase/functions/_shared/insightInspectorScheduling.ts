/**
 * Insight CTA → inspector soft-offer scheduling (Edge orchestration).
 * Pure rules: ./portfolioIntelligence/insightInspectorScheduling.ts
 * (vendored under functions/ so Supabase Docker bundle can resolve them;
 * keep in sync with shared/portfolioIntelligence/insightInspectorScheduling.ts).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  INSPECTOR_PROBE_TIMEOUT_MS,
  INSPECTION_TRADE_SLUG,
  decideInsightInspectorScheduling,
  defaultInsightTargetDay,
  entersInspectorSchedulingFlow,
  isProbeTimedOut,
  listFreeInspectorsForDay,
  schedulingScopeForAction,
  type InspectorBusyTicket,
  type InspectorCandidate,
  type InspectorDayHold,
} from "./portfolioIntelligence/insightInspectorScheduling.ts"
import type { InsightRecommendationActionType } from "./portfolioIntelligence/types.ts"
import { isVendorMatchableForDispatch } from "./vendor_assignment.ts"
import type { VendorAssignmentOption, VendorAssignmentRow } from "./vendor_assignment.ts"
import { startVendorAvailabilityProbe } from "./vendorAvailabilityProbe.ts"

export type StartInsightInspectorSchedulingInput = {
  landlordId: string
  insightCardId: string
  actionType: InsightRecommendationActionType
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
  categoryLabel?: string | null
  issueSummary?: string | null
  /** Optional override; default = next calendar day. */
  targetDay?: string | null
  propertyState?: string | null
  timeZone?: string | null
}

export type StartInsightInspectorSchedulingResult = {
  ok: true
  status: "probing" | "needs_external"
  requestId: string
  ticketId: string
  targetDay: string
  holdId?: string | null
  vendorId?: string | null
  /** Never include inspector name while probing. */
  inspectorName: null
  message: string
} | {
  ok: false
  error: string
}

function probeTimeoutMs(): number {
  const raw = Deno.env.get("INSPECTOR_PROBE_TIMEOUT_MS")?.trim()
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : INSPECTOR_PROBE_TIMEOUT_MS
}

async function loadInspectionCandidates(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<Array<InspectorCandidate & { row: VendorAssignmentRow; verificationStatus: string | null; availability: string | null }>> {
  const { data: vendors, error } = await supabase
    .from("vendors")
    .select(
      "id, name, phone, email, active, category, roster_status, onboarding_overridden_at, preferred_emergency, state, last_assigned_at, created_at, portal_api_key, onboarded_from_external",
    )
    .eq("landlord_id", landlordId)
    .eq("category", INSPECTION_TRADE_SLUG)

  if (error) {
    console.error("[insight-inspector] load vendors", error.message)
    return []
  }

  const vendorIds = (vendors ?? []).map((v) => v.id as string)
  const verificationByVendor = new Map<string, { status: string | null; availability: string | null }>()
  if (vendorIds.length > 0) {
    const { data: vers } = await supabase
      .from("vendor_verifications")
      .select("vendor_id, status, availability")
      .in("vendor_id", vendorIds)
      .order("created_at", { ascending: false })
    for (const row of vers ?? []) {
      const vid = row.vendor_id as string
      if (verificationByVendor.has(vid)) continue
      verificationByVendor.set(vid, {
        status: typeof row.status === "string" ? row.status : null,
        availability: typeof row.availability === "string" ? row.availability : null,
      })
    }
  }

  const out: Array<
    InspectorCandidate & {
      row: VendorAssignmentRow
      verificationStatus: string | null
      availability: string | null
    }
  > = []

  for (const v of vendors ?? []) {
    const vid = v.id as string
    const ver = verificationByVendor.get(vid)
    const matchable = isVendorMatchableForDispatch({
      verificationStatus: ver?.status ?? null,
      vendorActive: v.active as boolean | null,
      availability: ver?.availability ?? null,
      rosterStatus: typeof v.roster_status === "string" ? v.roster_status : null,
      onboardingOverriddenAt: typeof v.onboarding_overridden_at === "string"
        ? v.onboarding_overridden_at
        : null,
    })
    const row: VendorAssignmentRow = {
      id: vid,
      name: String(v.name ?? "Inspector"),
      phone: typeof v.phone === "string" ? v.phone : null,
      email: typeof v.email === "string" ? v.email : null,
      notification_channel: "sms",
      active: v.active !== false,
      category: INSPECTION_TRADE_SLUG,
      portal_api_key: typeof v.portal_api_key === "string" ? v.portal_api_key : null,
      last_assigned_at: typeof v.last_assigned_at === "string" ? v.last_assigned_at : null,
      created_at: typeof v.created_at === "string" ? v.created_at : "",
      preferred_emergency: v.preferred_emergency === true,
      onboarded_from_external: v.onboarded_from_external === true,
      roster_status: typeof v.roster_status === "string" ? v.roster_status : null,
      onboarding_overridden_at: typeof v.onboarding_overridden_at === "string"
        ? v.onboarding_overridden_at
        : null,
      state: typeof v.state === "string" ? v.state : null,
    }
    out.push({
      vendorId: vid,
      name: row.name,
      phone: row.phone,
      category: INSPECTION_TRADE_SLUG,
      matchable,
      serviceState: typeof v.state === "string" ? v.state : null,
      row,
      verificationStatus: ver?.status ?? null,
      availability: ver?.availability ?? null,
    })
  }
  return out
}

async function loadBusyTickets(
  supabase: SupabaseClient,
  landlordId: string,
  vendorIds: string[],
): Promise<InspectorBusyTicket[]> {
  if (vendorIds.length === 0) return []
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("assigned_vendor_id, scheduled_at, schedule_confirmed_at, vendor_work_status")
    .eq("landlord_id", landlordId)
    .in("assigned_vendor_id", vendorIds)

  if (error) {
    // landlord_id may be absent on older tickets — fall back without landlord filter.
    const { data: fallback } = await supabase
      .from("maintenance_requests")
      .select("assigned_vendor_id, scheduled_at, schedule_confirmed_at, vendor_work_status")
      .in("assigned_vendor_id", vendorIds)
    return (fallback ?? []).map((t) => ({
      assignedVendorId: typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null,
      scheduledAt: typeof t.scheduled_at === "string" ? t.scheduled_at : null,
      scheduleConfirmedAt: typeof t.schedule_confirmed_at === "string"
        ? t.schedule_confirmed_at
        : null,
      vendorWorkStatus: typeof t.vendor_work_status === "string" ? t.vendor_work_status : null,
    }))
  }

  return (data ?? []).map((t) => ({
    assignedVendorId: typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null,
    scheduledAt: typeof t.scheduled_at === "string" ? t.scheduled_at : null,
    scheduleConfirmedAt: typeof t.schedule_confirmed_at === "string"
      ? t.schedule_confirmed_at
      : null,
    vendorWorkStatus: typeof t.vendor_work_status === "string" ? t.vendor_work_status : null,
  }))
}

async function loadActiveHolds(
  supabase: SupabaseClient,
  landlordId: string,
  day: string,
): Promise<InspectorDayHold[]> {
  const { data } = await supabase
    .from("inspector_day_holds")
    .select("vendor_id, hold_date, status, expires_at")
    .eq("landlord_id", landlordId)
    .eq("hold_date", day)
    .eq("status", "held")

  return (data ?? []).map((h) => ({
    vendorId: String(h.vendor_id),
    holdDate: String(h.hold_date).slice(0, 10),
    status: "held" as const,
    expiresAt: typeof h.expires_at === "string" ? h.expires_at : null,
  }))
}

async function mintInsightInspectionTicket(
  supabase: SupabaseClient,
  input: StartInsightInspectorSchedulingInput & { targetDay: string },
): Promise<string> {
  const unit = (input.unitLabel ?? "").replace(/^Unit\s+/i, "").trim() || "—"
  const summary = (input.issueSummary ?? "").trim() || "Property inspection visit"
  const category = (input.categoryLabel ?? "Inspection").trim() || "Inspection"
  const description =
    `${summary}\n\nTarget day: ${input.targetDay}` +
    (input.building ? `\nBuilding: ${input.building}` : "") +
    (unit !== "—" ? `\nUnit: ${unit}` : "")

  const row: Record<string, unknown> = {
    unit,
    description,
    issue_headline: summary.slice(0, 120),
    issue_category: category,
    priority: "normal",
    urgency: "normal",
    vendor_work_status: "unassigned",
    photo_paths: [],
    building: input.building ?? null,
  }
  if (input.unitId?.trim()) row.unit_id = input.unitId.trim()
  // Best-effort landlord scope when column exists.
  row.landlord_id = input.landlordId

  const { data, error } = await supabase
    .from("maintenance_requests")
    .insert(row)
    .select("id")
    .single()

  if (error || !data?.id) {
    // Retry without landlord_id if column missing / RLS.
    delete row.landlord_id
    const retry = await supabase
      .from("maintenance_requests")
      .insert(row)
      .select("id")
      .single()
    if (retry.error || !retry.data?.id) {
      throw new Error(retry.error?.message || error?.message || "Failed to create work order")
    }
    return retry.data.id as string
  }
  return data.id as string
}

async function claimHold(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    vendorId: string
    day: string
    ticketId: string
    insightCardId: string
    expiresAt: string
  },
): Promise<{ claimed: true; holdId: string } | { claimed: false; reason: "already_held" }> {
  const { data, error } = await supabase
    .from("inspector_day_holds")
    .insert({
      landlord_id: input.landlordId,
      vendor_id: input.vendorId,
      hold_date: input.day,
      ticket_id: input.ticketId,
      insight_card_id: input.insightCardId,
      status: "held",
      expires_at: input.expiresAt,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    const msg = (error?.message ?? "").toLowerCase()
    if (msg.includes("unique") || msg.includes("duplicate") || error?.code === "23505") {
      return { claimed: false, reason: "already_held" }
    }
    console.error("[insight-inspector] claim hold", error?.message)
    return { claimed: false, reason: "already_held" }
  }
  return { claimed: true, holdId: data.id as string }
}

export async function releaseInspectorDayHold(
  supabase: SupabaseClient,
  holdId: string | null | undefined,
): Promise<void> {
  if (!holdId?.trim()) return
  await supabase
    .from("inspector_day_holds")
    .update({ status: "released" })
    .eq("id", holdId.trim())
    .eq("status", "held")
}

export async function consumeInspectorDayHold(
  supabase: SupabaseClient,
  holdId: string | null | undefined,
): Promise<void> {
  if (!holdId?.trim()) return
  await supabase
    .from("inspector_day_holds")
    .update({ status: "consumed" })
    .eq("id", holdId.trim())
    .eq("status", "held")
}

export async function markInsightSchedulingNeedsExternal(
  supabase: SupabaseClient,
  requestId: string,
): Promise<void> {
  const { data: req } = await supabase
    .from("insight_scheduling_requests")
    .select("hold_id, landlord_id, ticket_id, target_day")
    .eq("id", requestId)
    .maybeSingle()

  if (req?.hold_id) {
    await releaseInspectorDayHold(supabase, req.hold_id as string)
  }

  await supabase
    .from("insight_scheduling_requests")
    .update({
      status: "needs_external",
      hold_id: null,
      vendor_id: null,
      inspector_name: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "probing")

  if (req?.landlord_id) {
    await recordActivityLog(supabase, {
      landlordId: req.landlord_id as string,
      eventType: "insight.inspector_unavailable",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: typeof req.ticket_id === "string" ? req.ticket_id : undefined,
      metadata: {
        message: "No inspector available — find an external vendor.",
        target_day: req.target_day,
        request_id: requestId,
      },
    })
  }
}

export async function markInsightSchedulingAccepted(
  supabase: SupabaseClient,
  input: {
    requestId: string
    inspectorName: string
    confirmedWindow: string | null
    vendorId: string
  },
): Promise<void> {
  const { data: req } = await supabase
    .from("insight_scheduling_requests")
    .select("hold_id, landlord_id, ticket_id, target_day")
    .eq("id", input.requestId)
    .maybeSingle()

  if (req?.hold_id) {
    await consumeInspectorDayHold(supabase, req.hold_id as string)
  }

  await supabase
    .from("insight_scheduling_requests")
    .update({
      status: "accepted",
      inspector_name: input.inspectorName,
      confirmed_window: input.confirmedWindow,
      vendor_id: input.vendorId,
      hold_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)

  if (req?.landlord_id) {
    await recordActivityLog(supabase, {
      landlordId: req.landlord_id as string,
      eventType: "insight.inspector_scheduled",
      source: "automation",
      actorType: "system",
      vendorId: input.vendorId,
      maintenanceRequestId: typeof req.ticket_id === "string" ? req.ticket_id : undefined,
      metadata: {
        message: `${input.inspectorName} confirmed for ${req.target_day}.`,
        confirmed_window: input.confirmedWindow,
        request_id: input.requestId,
      },
    })
  }
}

/**
 * Start scheduling for an insight CTA (not flag_for_review / nudge_vendor).
 */
export async function startInsightInspectorScheduling(
  supabase: SupabaseClient,
  input: StartInsightInspectorSchedulingInput,
): Promise<StartInsightInspectorSchedulingResult> {
  if (!entersInspectorSchedulingFlow(input.actionType)) {
    return { ok: false, error: "Action does not enter inspector scheduling." }
  }

  const scope = schedulingScopeForAction(input.actionType) ?? "unit"
  const targetDay =
    input.targetDay?.trim() ||
    defaultInsightTargetDay(new Date(), input.timeZone?.trim() || undefined)
  const timeoutMs = probeTimeoutMs()
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString()
  const nowIso = new Date().toISOString()

  let ticketId: string
  try {
    ticketId = await mintInsightInspectionTicket(supabase, { ...input, targetDay })
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create work order.",
    }
  }

  const { data: requestRow, error: reqErr } = await supabase
    .from("insight_scheduling_requests")
    .insert({
      landlord_id: input.landlordId,
      insight_card_id: input.insightCardId,
      action_type: input.actionType,
      scope,
      status: "probing",
      target_day: targetDay,
      ticket_id: ticketId,
      unit_id: input.unitId?.trim() || null,
      unit_label: input.unitLabel ?? null,
      building: input.building ?? null,
      category_label: input.categoryLabel ?? null,
      issue_summary: input.issueSummary ?? null,
      probe_started_at: nowIso,
      expires_at: expiresAt,
    })
    .select("id")
    .single()

  if (reqErr || !requestRow?.id) {
    return {
      ok: false,
      error: reqErr?.message || "Could not create scheduling request.",
    }
  }
  const requestId = requestRow.id as string

  const candidates = await loadInspectionCandidates(supabase, input.landlordId)
  const busyTickets = await loadBusyTickets(
    supabase,
    input.landlordId,
    candidates.map((c) => c.vendorId),
  )
  const holds = await loadActiveHolds(supabase, input.landlordId, targetDay)
  const free = listFreeInspectorsForDay({
    candidates,
    busyTickets,
    holds,
    day: targetDay,
    propertyState: input.propertyState,
  })

  if (free.length === 0) {
    await supabase
      .from("insight_scheduling_requests")
      .update({
        status: "needs_external",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)

    await recordActivityLog(supabase, {
      landlordId: input.landlordId,
      eventType: "insight.inspector_unavailable",
      source: "edge_function",
      actorType: "system",
      maintenanceRequestId: ticketId,
      metadata: {
        message: "No inspector available at request time — find an external vendor.",
        target_day: targetDay,
        request_id: requestId,
      },
    })

    return {
      ok: true,
      status: "needs_external",
      requestId,
      ticketId,
      targetDay,
      inspectorName: null,
      message: "No inspector available for that day.",
    }
  }

  const first = free[0]!
  const claim = await claimHold(supabase, {
    landlordId: input.landlordId,
    vendorId: first.vendorId,
    day: targetDay,
    ticketId,
    insightCardId: input.insightCardId,
    expiresAt,
  })

  const holdClaim = claim.claimed
    ? {
      claimed: true as const,
      vendorId: first.vendorId,
      day: targetDay,
      holdId: claim.holdId,
    }
    : { claimed: false as const, reason: "already_held" as const }

  // Re-check pure decision (concurrent second CTA → already_held).
  const decision = decideInsightInspectorScheduling({
    freeInspectors: free,
    holdClaim,
    ticketId,
    targetDay,
    requestId,
  })

  if (decision.outcome === "needs_external") {
    await supabase
      .from("insight_scheduling_requests")
      .update({
        status: "needs_external",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)

    return {
      ok: true,
      status: "needs_external",
      requestId,
      ticketId,
      targetDay,
      inspectorName: null,
      message: "No inspector available for that day.",
    }
  }

  const candidate = candidates.find((c) => c.vendorId === decision.vendorId)
  if (!candidate) {
    await releaseInspectorDayHold(supabase, decision.holdId)
    await markInsightSchedulingNeedsExternal(supabase, requestId)
    return {
      ok: true,
      status: "needs_external",
      requestId,
      ticketId,
      targetDay,
      inspectorName: null,
      message: "No inspector available for that day.",
    }
  }

  const option: VendorAssignmentOption = {
    vendor: candidate.row,
    role: "specialist",
  }

  const probed = await startVendorAvailabilityProbe(supabase, {
    landlordId: input.landlordId,
    ticketId,
    unit: (input.unitLabel ?? "").replace(/^Unit\s+/i, "").trim() || "—",
    issueCategory: input.categoryLabel ?? "Inspection",
    description: input.issueSummary ?? "Property inspection visit",
    issueHeadline: (input.issueSummary ?? "Inspection visit").slice(0, 120),
    residentAvailabilityText: `Preferred day: ${targetDay}`,
    options: [option],
    insightAutoAssign: true,
    insightSchedulingRequestId: requestId,
  })

  if (probed.probed === 0) {
    await releaseInspectorDayHold(supabase, decision.holdId)
    await markInsightSchedulingNeedsExternal(supabase, requestId)
    return {
      ok: true,
      status: "needs_external",
      requestId,
      ticketId,
      targetDay,
      holdId: null,
      inspectorName: null,
      message: "Could not reach an inspector — find an external vendor.",
    }
  }

  await supabase
    .from("insight_scheduling_requests")
    .update({
      status: "probing",
      hold_id: decision.holdId,
      vendor_id: decision.vendorId,
      // Name withheld until accept — do not persist display name on probing.
      inspector_name: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)

  await recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: "insight.inspector_probe_started",
    source: "edge_function",
    actorType: "system",
    vendorId: decision.vendorId,
    maintenanceRequestId: ticketId,
    metadata: {
      message: "Reaching out to an available inspector.",
      target_day: targetDay,
      request_id: requestId,
      hold_id: decision.holdId,
    },
  })

  return {
    ok: true,
    status: "probing",
    requestId,
    ticketId,
    targetDay,
    holdId: decision.holdId,
    vendorId: decision.vendorId,
    inspectorName: null,
    message: "Reaching out to an available inspector",
  }
}

/** Cron: release timed-out probes → needs_external. */
export async function processExpiredInsightInspectorProbes(
  supabase: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{ timedOut: number }> {
  const { data: rows } = await supabase
    .from("insight_scheduling_requests")
    .select("id, probe_started_at, expires_at")
    .eq("status", "probing")
    .limit(100)

  let timedOut = 0
  for (const row of rows ?? []) {
    const id = row.id as string
    const started =
      typeof row.probe_started_at === "string"
        ? row.probe_started_at
        : typeof row.expires_at === "string"
        ? new Date(Date.parse(row.expires_at) - probeTimeoutMs()).toISOString()
        : ""
    const expiredByClock =
      typeof row.expires_at === "string" && Date.parse(row.expires_at) <= nowMs
    const expiredByTimeout = started
      ? isProbeTimedOut({
        startedAt: started,
        nowMs,
        timeoutMs: probeTimeoutMs(),
      })
      : false
    if (!expiredByClock && !expiredByTimeout) continue
    await markInsightSchedulingNeedsExternal(supabase, id)
    timedOut += 1
  }
  return { timedOut }
}

/** Look up open scheduling request by ticket (probe accept/decline hook). */
export async function findInsightSchedulingRequestByTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{ id: string; holdId: string | null; status: string } | null> {
  const { data } = await supabase
    .from("insight_scheduling_requests")
    .select("id, hold_id, status")
    .eq("ticket_id", ticketId)
    .in("status", ["probing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.id) return null
  return {
    id: data.id as string,
    holdId: typeof data.hold_id === "string" ? data.hold_id : null,
    status: String(data.status ?? ""),
  }
}

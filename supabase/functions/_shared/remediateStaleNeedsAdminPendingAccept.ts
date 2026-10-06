/**
 * One-shot: clear stale pending_accept assignment on sticky needs_admin_vendor
 * tickets and resurface landlord attention via escalateWhenNoReplacementVendor.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  formatAttentionLocationLine,
  formatReportedAgo,
  notifyLandlordNeedsAttention,
  shortRepairLabel,
} from "./landlordAttentionNotify.ts"
import { discoverExternalVendorsForTicket } from "./external_vendor/discover.ts"
import { loadPropertyLocationFromTable } from "./properties/propertyLocation.ts"
import {
  choiceOptionsFromExternalSuggestions,
  formatExternalVendorSmsLine,
  landlordNumberedChoiceReplyHint,
  type AwaitingVendorChoice,
} from "./vendorLandlordChoice.ts"
import { escalateWhenNoReplacementVendor } from "./vendor_reassignment.ts"
import type { NotifyLandlordAttentionResult } from "./landlordAttentionNotify.ts"

type TicketAttentionRow = {
  id: string
  landlord_id: string | null
  assigned_vendor_id: string | null
  unit: string | null
  description: string | null
  issue_category: string | null
  created_at: string | null
  urgency: string | null
  priority: string | null
  property_id: string | null
}

/**
 * Fresh assign_vendor attention with a unique idempotency key (Twilio/Resend
 * must run in the deployed edge — not local Deno).
 */
export async function resurfaceAssignVendorAttentionForTicket(
  supabase: SupabaseClient,
  ticketId: string,
  opts?: { reasonTag?: string },
): Promise<
  | { ok: true; attention: NotifyLandlordAttentionResult; landlordId: string }
  | { ok: false; error: string }
> {
  const id = ticketId.trim()
  if (!id) return { ok: false, error: "missing_ticket_id" }

  const { data: t, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, unit, description, issue_category, created_at, urgency, priority, property_id",
    )
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!t) return { ok: false, error: "not_found" }

  const landlordId = typeof t.landlord_id === "string" ? t.landlord_id : null
  if (!landlordId) return { ok: false, error: "missing_landlord" }

  const row = t as TicketAttentionRow
  const now = new Date().toISOString()
  const reasonTag = (opts?.reasonTag ?? "stale_pending_accept_clear").trim() ||
    "stale_pending_accept_clear"

  const unit = typeof row.unit === "string" ? row.unit.trim() : ""
  const description = typeof row.description === "string" ? row.description : ""
  const issueCategory =
    typeof row.issue_category === "string" ? row.issue_category : ""
  const createdAt = typeof row.created_at === "string" ? row.created_at : ""
  let building = ""
  if (typeof row.property_id === "string" && row.property_id.trim()) {
    const { data: prop } = await supabase
      .from("properties")
      .select("name, address_line1")
      .eq("id", row.property_id)
      .maybeSingle()
    building =
      (typeof prop?.name === "string" && prop.name.trim()) ||
      (typeof prop?.address_line1 === "string" && prop.address_line1.trim()) ||
      ""
  }
  const location = await loadPropertyLocationFromTable(supabase, landlordId, {
    building: building || null,
  })
  const repair = shortRepairLabel(description, issueCategory)
  const locationLine = formatAttentionLocationLine({
    street: location?.streetAddress,
    building,
    unit,
    reportedAgo: formatReportedAgo(createdAt),
  })
  let nextSteps: string[] = []
  let choiceReplyHint: string | null = null
  let vendorChoice: AwaitingVendorChoice | null = null
  const discovered = await discoverExternalVendorsForTicket(supabase, id, {
    limit: 3,
  }).catch(() => ({ error: "discover_failed" as const }))
  if (!("error" in discovered)) {
    const options = choiceOptionsFromExternalSuggestions(discovered.suggestions, 3)
    if (options.length > 0) {
      const named = discovered.suggestions.filter((r) => r.name.trim())
      nextSteps = named.slice(0, options.length).map(formatExternalVendorSmsLine)
      choiceReplyHint = landlordNumberedChoiceReplyHint(options.length)
      const urgency =
        typeof row.urgency === "string" && row.urgency.trim()
          ? row.urgency.trim()
          : typeof row.priority === "string" && row.priority.trim()
            ? row.priority.trim()
            : null
      vendorChoice = {
        ticketId: id,
        options,
        searchLocation:
          discovered.searchLocation || discovered.locationLabel || null,
        issueCategory: issueCategory || discovered.issueCategory || null,
        issueSummary: description.trim() || null,
        urgency,
      }
    }
  }

  const { data: run } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("entity_id", id)
    .eq("template_id", "maintenance_request")
    .in("status", ["active", "escalated"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const attention = await notifyLandlordNeedsAttention(supabase, {
    landlordId,
    kind: "assign_vendor",
    headline: `Vendor unresponsive — ${repair}`,
    detail: locationLine,
    locationLine,
    whyLine: nextSteps.length
      ? "The assigned vendor never accepted. Nearby vendors:"
      : "The assigned vendor never accepted. No one on your preferred list can take this right now.",
    nextSteps,
    choiceReplyHint,
    vendorChoice,
    idempotencyKey: `assign_vendor:${id}:${reasonTag}:${now}`,
    maintenanceRequestId: id,
    workflowRunId: typeof run?.id === "string" ? run.id : null,
  })

  return { ok: true, attention, landlordId }
}

export async function remediateStaleNeedsAdminPendingAccept(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<
  | {
    ok: true
    previousVendorId: string | null
    attention?: NotifyLandlordAttentionResult
  }
  | { ok: false; error: string }
> {
  const id = ticketId.trim()
  if (!id) return { ok: false, error: "missing_ticket_id" }

  const { data: t, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, vendor_work_status, auto_reassign_last_outcome, unit, description, issue_category, created_at, urgency, priority, property_id",
    )
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!t) return { ok: false, error: "not_found" }

  const previousVendorId =
    typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null
  const now = new Date().toISOString()

  const { error: updErr } = await supabase
    .from("maintenance_requests")
    .update({
      previous_vendor_id: previousVendorId,
      previous_vendor_work_status: "pending_accept",
      assigned_vendor_id: null,
      vendor_action_token: null,
      vendor_work_status: "unassigned",
      vendor_notified_at: null,
      vendor_notify_error: null,
      auto_reassign_last_outcome: "needs_admin_vendor|pending_accept_stale",
      auto_reassign_same_outcome_count: 1,
      auto_reassign_same_outcome_since: now,
    })
    .eq("id", id)
  if (updErr) return { ok: false, error: updErr.message }

  if (previousVendorId) {
    await supabase.from("vendor_status_events").insert({
      ticket_id: id,
      from_status: "pending_accept",
      to_status: "unassigned",
      source: "manual_stale_needs_admin_clear",
      vendor_id: previousVendorId,
    })
  }

  const landlordId = typeof t.landlord_id === "string" ? t.landlord_id : null
  if (!landlordId) return { ok: false, error: "missing_landlord" }

  // Refresh escalated workflow + graph (attention SMS may no-op on idempotency).
  await escalateWhenNoReplacementVendor(
    supabase,
    { id, landlord_id: landlordId },
    "pending_accept_stale",
  )

  const attentionResult = await resurfaceAssignVendorAttentionForTicket(supabase, id, {
    reasonTag: "stale_pending_accept_clear",
  })

  await recordActivityLog(supabase, {
    landlordId,
    eventType: "maintenance.stale_assignment_cleared",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: id,
    vendorId: previousVendorId,
    metadata: {
      message:
        "Cleared a stale pending-accept vendor assignment after needs-admin sticky hold — landlord attention resurfaced for a new vendor choice.",
      previous_vendor_id: previousVendorId,
    },
  }).catch(() => {})

  if (!attentionResult.ok) {
    return { ok: true, previousVendorId, attention: undefined }
  }
  return { ok: true, previousVendorId, attention: attentionResult.attention }
}

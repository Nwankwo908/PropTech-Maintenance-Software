/**
 * Retrieve daily-priority candidates within authorized scope.
 * Failures are partial knowledge — never invent empty-as-proof.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isPestControlIssue } from "../../../vendor_trades.ts"
import { loadLandlordScheduleTimeZone } from "../../../landlordNotificationPrefs.ts"
import { summarizeWorkOrderIssue } from "../maintenance/workOrderPresentation.ts"
import {
  buildDailyPrioritiesResult,
  instantIsOnLocalDay,
  type DailyPriorityActorRole,
  type DailyPriorityCandidate,
  type DailyPrioritiesResult,
} from "./dailyPriorities.ts"

const OPEN_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
] as const

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function isEmergency(priority: unknown, urgency: unknown): boolean {
  const p = String(priority ?? "").toLowerCase()
  const u = String(urgency ?? "").toLowerCase()
  return (
    ["emergency", "critical", "urgent", "fire", "habitability"].includes(p) ||
    ["emergency", "critical", "urgent", "fire", "habitability"].includes(u) ||
    /\b(flood|flooding|fire|gas\s*leak|no\s*heat|habitab)\b/i.test(`${p} ${u}`)
  )
}

function urgencyRank(priority: unknown, urgency: unknown): number {
  const u = String(urgency ?? priority ?? "").toLowerCase()
  if (u.includes("fire") || u.includes("habitab")) return 0
  if (u.includes("emergency") || u.includes("critical")) return 1
  if (u.includes("urgent") || u === "high") return 2
  return 40
}

function placeFromTicket(row: Record<string, unknown>): {
  propertyLabel: string | null
  unitLabel: string | null
  propertyId: string | null
  unitId: string | null
  addressKnown: boolean
} {
  const building =
    (typeof row.building === "string" && row.building.trim()) ||
    (typeof row.property_name === "string" && row.property_name.trim()) ||
    null
  let unitLabel =
    (typeof row.unit_label === "string" && row.unit_label.trim()) ||
    (typeof row.unit === "string" && row.unit.trim()) ||
    null
  // unit may be "Building · 3"
  if (unitLabel?.includes("·")) {
    const parts = unitLabel.split("·").map((s) => s.trim())
    unitLabel = parts[parts.length - 1] || unitLabel
  }
  const propertyId = typeof row.property_id === "string" ? row.property_id : null
  const unitId = typeof row.unit_id === "string" ? row.unit_id : null
  const addressKnown = Boolean(building || propertyId || unitLabel)
  return { propertyLabel: building, unitLabel, propertyId, unitId, addressKnown }
}

export type DailyPrioritiesLookupInput = {
  landlordId: string
  role: DailyPriorityActorRole | "unresolved"
  residentId?: string | null
  /** Optional narrow property scope from the question. */
  propertyId?: string | null
  buildingFilter?: string | null
  now?: Date
  timeZone?: string | null
}

export async function lookupDailyPriorities(
  supabase: SupabaseClient,
  input: DailyPrioritiesLookupInput,
): Promise<DailyPrioritiesResult> {
  const landlordId = input.landlordId.trim()
  const now = input.now ?? new Date()
  const partialSources: string[] = []
  const candidates: DailyPriorityCandidate[] = []

  if (!landlordId || input.role === "unresolved") {
    return buildDailyPrioritiesResult({
      role: "unresolved",
      candidates: [],
      available: false,
    })
  }

  let timeZone = input.timeZone?.trim() || null
  if (!timeZone) {
    try {
      timeZone = await loadLandlordScheduleTimeZone(supabase, landlordId)
    } catch {
      partialSources.push("timezone")
      timeZone = "America/New_York"
    }
  }

  // --- Open work orders (emergencies + unassigned + visits) ---
  const pendingEstimateIds = new Set<string>()
  if (input.role === "landlord") {
    const { data: estimates, error: estErr } = await supabase
      .from("maintenance_estimates")
      .select("maintenance_request_id, status")
      .eq("landlord_id", landlordId)
      .eq("status", "pending_approval")
      .limit(100)
    if (estErr) {
      console.error("[dailyPriorities] estimates", estErr.message)
      partialSources.push("maintenance_estimates")
    } else {
      for (const row of estimates ?? []) {
        const id =
          typeof (row as { maintenance_request_id?: string }).maintenance_request_id ===
          "string"
            ? (row as { maintenance_request_id: string }).maintenance_request_id
            : ""
        if (id) pendingEstimateIds.add(id)
      }
    }
  }

  {
    let q = supabase
      .from("maintenance_requests")
      .select(
        "id, display_id, description, issue_category, priority, urgency, vendor_work_status, property_id, unit_id, unit, resident_id, scheduled_at, vendor_notify_error, awaiting_landlord_choice_at, spend_status, created_at",
      )
      .eq("landlord_id", landlordId)
      .in("vendor_work_status", [...OPEN_STATUSES])
      .limit(80)
    if (input.propertyId?.trim()) q = q.eq("property_id", input.propertyId.trim())
    if (input.role === "tenant" && input.residentId?.trim()) {
      q = q.eq("resident_id", input.residentId.trim())
    }
    const { data, error } = await q
    if (error) {
      console.error("[dailyPriorities] tickets", error.message)
      partialSources.push("maintenance_requests")
    } else {
      for (const raw of data ?? []) {
        const row = asRecord(raw)
        if (!row) continue
        const id = typeof row.id === "string" ? row.id : ""
        if (!id) continue
        const buildingHay =
          `${String(row.building ?? "")} ${String(row.unit ?? "")}`.toLowerCase()
        if (
          input.buildingFilter?.trim() &&
          !buildingHay.includes(input.buildingFilter.trim().toLowerCase())
        ) {
          continue
        }
        const place = placeFromTicket(row)
        const issueCategory =
          typeof row.issue_category === "string" ? row.issue_category : null
        const title = summarizeWorkOrderIssue(
          String(row.description ?? ""),
          issueCategory,
        )
        const emergency = isEmergency(row.priority, row.urgency) ||
          /\bflood(?:ing)?\b/i.test(String(row.description ?? ""))
        const status = String(row.vendor_work_status ?? "")
        const needsVendor = status === "unassigned"
        // Pest never offers assign unless a specialist path marked canAssign true.
        // Lookup leaves pest canAssign false (specialist check is assign-time).
        const canAssign =
          needsVendor && place.addressKnown && !isPestControlIssue(issueCategory)

        if (emergency) {
          candidates.push({
            dedupeKey: `ticket:${id}`,
            category: "emergency",
            entityType: "maintenance_request",
            entityId: id,
            displayId: typeof row.display_id === "number" ? row.display_id : null,
            title: title || "Emergency repair",
            ...place,
            instantAt: null,
            blocker: place.addressKnown
              ? needsVendor
                ? "Vendor needed"
                : null
              : "Address unknown — confirm location before booking",
            issueCategory,
            addressKnown: place.addressKnown,
            canAssign: place.addressKnown && canAssign,
            landlordOnly: false,
            residentId: typeof row.resident_id === "string" ? row.resident_id : null,
            urgencyRank: urgencyRank(row.priority, row.urgency),
          })
        } else if (needsVendor && place.addressKnown) {
          candidates.push({
            dedupeKey: `ticket:${id}`,
            category: "deadline",
            entityType: "maintenance_request",
            entityId: id,
            displayId: typeof row.display_id === "number" ? row.display_id : null,
            title: title || "Open repair",
            ...place,
            instantAt: null,
            blocker: "Vendor needed",
            issueCategory,
            addressKnown: true,
            canAssign,
            landlordOnly: false,
            residentId: typeof row.resident_id === "string" ? row.resident_id : null,
            urgencyRank: 30 + urgencyRank(row.priority, row.urgency),
          })
        }

        const visitAt =
          typeof row.scheduled_at === "string" ? row.scheduled_at : null
        if (visitAt && instantIsOnLocalDay(visitAt, now, timeZone)) {
          candidates.push({
            dedupeKey: `ticket:${id}`,
            category: "visit_today",
            entityType: "appointment",
            entityId: id,
            displayId: typeof row.display_id === "number" ? row.display_id : null,
            title: title || "Vendor visit",
            ...place,
            instantAt: visitAt,
            blocker: "Visit scheduled today",
            issueCategory,
            addressKnown: place.addressKnown,
            canAssign: false,
            landlordOnly: false,
            residentId: typeof row.resident_id === "string" ? row.resident_id : null,
            urgencyRank: 20,
          })
        }

        const awaitingChoice = row.awaiting_landlord_choice_at != null
        const spendPending = String(row.spend_status ?? "") === "pending_approval"
        const notify = String(row.vendor_notify_error ?? "").toLowerCase()
        if (
          input.role === "landlord" &&
          (pendingEstimateIds.has(id) ||
            awaitingChoice ||
            spendPending ||
            notify.includes("approval"))
        ) {
          candidates.push({
            dedupeKey: `ticket:${id}`,
            category: "approval",
            entityType: "estimate",
            entityId: id,
            displayId: typeof row.display_id === "number" ? row.display_id : null,
            title: title || "Repair approval",
            ...place,
            instantAt: null,
            blocker: "Needs approval",
            issueCategory,
            addressKnown: place.addressKnown,
            canAssign: false,
            landlordOnly: true,
            residentId: typeof row.resident_id === "string" ? row.resident_id : null,
            urgencyRank: 15,
          })
        }
      }
    }
  }

  // --- Inspection / required-repair deadlines with financial consequence ---
  if (input.role === "landlord") {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("id, entity_id, template_id, status, metadata, due_at, property_id, unit_id")
      .eq("landlord_id", landlordId)
      .in("status", ["active", "escalated"])
      .limit(60)
    if (error) {
      console.error("[dailyPriorities] workflows", error.message)
      partialSources.push("workflow_runs")
    } else {
      for (const raw of data ?? []) {
        const row = asRecord(raw)
        if (!row) continue
        const template = String(row.template_id ?? "").toLowerCase()
        const meta = asRecord(row.metadata)
        const dueAt =
          (typeof row.due_at === "string" && row.due_at) ||
          (typeof meta?.due_at === "string" && meta.due_at) ||
          (typeof meta?.deadline_at === "string" && meta.deadline_at) ||
          null
        const isInspection =
          template.includes("inspection") ||
          Boolean(meta?.inspection_id) ||
          /\binspection\b/i.test(String(meta?.message ?? ""))
        const financial =
          Boolean(meta?.financial_consequence) ||
          Boolean(meta?.required_repairs) ||
          /\b(fine|penalty|fail|hqs|required\s+repair)\b/i.test(
            JSON.stringify(meta ?? {}),
          )
        if (!isInspection && !financial) continue
        if (!dueAt) continue
        const due = new Date(dueAt)
        if (Number.isNaN(due.getTime())) continue
        // Overdue or due within ~7 local days counts as today's actionable deadline.
        const msLeft = due.getTime() - now.getTime()
        if (msLeft > 7 * 24 * 3600_000) continue
        const id = typeof row.id === "string" ? row.id : ""
        if (!id) continue
        const entityId =
          (typeof row.entity_id === "string" && row.entity_id) || id
        candidates.push({
          dedupeKey: `inspection:${entityId}`,
          category: "deadline",
          entityType: "inspection",
          entityId,
          title: "Inspection repairs",
          propertyLabel:
            (typeof meta?.property_name === "string" && meta.property_name) ||
            (typeof meta?.building === "string" && meta.building) ||
            null,
          unitLabel:
            (typeof meta?.unit_label === "string" && meta.unit_label) || null,
          propertyId: typeof row.property_id === "string" ? row.property_id : null,
          unitId: typeof row.unit_id === "string" ? row.unit_id : null,
          instantAt: dueAt,
          blocker: msLeft < 0 ? "Overdue — financial risk if missed" : "Deadline approaching",
          addressKnown: true,
          canAssign: false,
          landlordOnly: true,
          urgencyRank: msLeft < 0 ? 5 : 10,
        })
      }
    }
  }

  return buildDailyPrioritiesResult({
    role: input.role,
    residentId: input.residentId,
    candidates,
    partialSources,
    available: partialSources.length === 0,
  })
}

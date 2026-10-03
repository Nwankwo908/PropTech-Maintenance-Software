/**
 * Tenant-forwarded inspection notices → inspection_reports + optional WO links.
 * Distinct from landlord HQS fail-letter confirm (no deficiency mint).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  extractTenantInspectionNotice,
  type TenantInspectionNoticeExtraction,
} from "../../../../shared/maintenance/tenantInspectionNotice.ts"
import { planStandaloneInspectionPmComplianceTask } from "../../../../shared/maintenance/standaloneInspectionTask.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { isStorageMediaPath } from "./media.ts"
import { pickUnitIdFromInventoryRows } from "./resolveUnitId.ts"

export const TENANT_NOTICE_LETTER_TYPE = "tenant_notice" as const

export type EnsureTenantInspectionNoticeInput = {
  landlordId: string
  residentId: string
  conversationId?: string | null
  body: string
  /** Rehosted storage paths from the inbound (HABC screenshot, etc.). */
  mediaPaths?: string[] | null
  /** Preferred inspection date override (ISO yyyy-mm-dd). */
  inspectionDate?: string | null
  extraction?: TenantInspectionNoticeExtraction | null
}

export type EnsureTenantInspectionNoticeResult =
  | {
    ok: true
    inspectionReportId: string
    created: boolean
    sourceDocumentId: string | null
    inspectionDate: string | null
    unitId: string
    propertyId: string | null
  }
  | { ok: false; reason: "no_unit" | "insert_failed"; detail?: string }

async function resolveResidentUnit(
  supabase: SupabaseClient,
  input: { landlordId: string; residentId: string },
): Promise<{ unitId: string; propertyId: string | null } | null> {
  const { data: occupancy } = await supabase
    .from("occupancy")
    .select("unit_id")
    .eq("landlord_id", input.landlordId)
    .eq("resident_id", input.residentId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let unitId =
    typeof occupancy?.unit_id === "string" && occupancy.unit_id.trim()
      ? occupancy.unit_id.trim()
      : ""

  if (!unitId) {
    const { data: user } = await supabase
      .from("users")
      .select("unit")
      .eq("id", input.residentId)
      .maybeSingle()
    const label = typeof user?.unit === "string" ? user.unit.trim() : ""
    if (label) {
      const { data: units } = await supabase
        .from("units")
        .select("id, unit_label, property_id, building")
        .eq("landlord_id", input.landlordId)
      unitId =
        pickUnitIdFromInventoryRows(
          (units ?? []) as Array<{
            id: string
            unit_label: string | null
            building: string | null
            property_id?: string | null
          }>,
          { unitLabel: label },
        ) ?? ""
    }
  }

  if (!unitId) return null

  const { data: unitRow } = await supabase
    .from("units")
    .select("id, property_id")
    .eq("id", unitId)
    .maybeSingle()
  const propertyId =
    typeof unitRow?.property_id === "string" && unitRow.property_id.trim()
      ? unitRow.property_id.trim()
      : null
  return { unitId, propertyId }
}

export async function findOpenTenantInspectionReport(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    unitId: string
    inspectionDate?: string | null
  },
): Promise<{ id: string; inspection_date: string | null; source_document_id: string | null } | null> {
  let query = supabase
    .from("inspection_reports")
    .select("id, inspection_date, source_document_id, status")
    .eq("landlord_id", input.landlordId)
    .eq("unit_id", input.unitId)
    .eq("letter_type", TENANT_NOTICE_LETTER_TYPE)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(5)

  if (input.inspectionDate?.trim()) {
    query = query.eq("inspection_date", input.inspectionDate.trim())
  }

  const { data } = await query
  const row = (data ?? [])[0]
  if (!row?.id) return null
  return {
    id: String(row.id),
    inspection_date:
      row.inspection_date == null ? null : String(row.inspection_date),
    source_document_id:
      row.source_document_id == null ? null : String(row.source_document_id),
  }
}

async function persistTenantNoticeSourceDocument(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    propertyId: string | null
    unitId: string
    storagePath: string
    contentType?: string | null
  },
): Promise<string | null> {
  if (!isStorageMediaPath(input.storagePath) && !input.storagePath.includes("/")) {
    return null
  }
  const fileName = input.storagePath.split("/").pop() || "inspection-notice"
  const { data, error } = await supabase
    .from("inspection_source_documents")
    .insert({
      landlord_id: input.landlordId,
      property_id: input.propertyId,
      unit_id: input.unitId,
      storage_bucket: "maintenance-uploads",
      storage_path: input.storagePath,
      file_name: fileName,
      content_type: input.contentType ?? "image/jpeg",
      source_channel: "sms",
    })
    .select("id")
    .maybeSingle()
  if (error || !data?.id) {
    console.error("[tenant-inspection-notice] source doc insert failed", error?.message)
    return null
  }
  return String(data.id)
}

/**
 * Create or reuse an open tenant_notice inspection_reports row for this unit.
 * Attaches the first inbound media path as source_document when present.
 */
export async function ensureTenantInspectionNoticeReport(
  supabase: SupabaseClient,
  input: EnsureTenantInspectionNoticeInput,
): Promise<EnsureTenantInspectionNoticeResult> {
  const extraction = input.extraction ?? extractTenantInspectionNotice(input.body)
  const inspectionDate =
    input.inspectionDate?.trim() ||
    extraction.inspectionDate ||
    extraction.inspectionDates[0] ||
    null

  const unit = await resolveResidentUnit(supabase, {
    landlordId: input.landlordId,
    residentId: input.residentId,
  })
  if (!unit) return { ok: false, reason: "no_unit" }

  const existing = await findOpenTenantInspectionReport(supabase, {
    landlordId: input.landlordId,
    unitId: unit.unitId,
    inspectionDate,
  })
  if (existing) {
    let sourceDocumentId = existing.source_document_id
    const media = (input.mediaPaths ?? []).map((p) => p.trim()).filter(Boolean)
    if (!sourceDocumentId && media[0]) {
      sourceDocumentId = await persistTenantNoticeSourceDocument(supabase, {
        landlordId: input.landlordId,
        propertyId: unit.propertyId,
        unitId: unit.unitId,
        storagePath: media[0],
      })
      if (sourceDocumentId) {
        await supabase
          .from("inspection_reports")
          .update({ source_document_id: sourceDocumentId })
          .eq("id", existing.id)
      }
    }
    return {
      ok: true,
      inspectionReportId: existing.id,
      created: false,
      sourceDocumentId,
      inspectionDate: existing.inspection_date ?? inspectionDate,
      unitId: unit.unitId,
      propertyId: unit.propertyId,
    }
  }

  const media = (input.mediaPaths ?? []).map((p) => p.trim()).filter(Boolean)
  const sourceDocumentId = media[0]
    ? await persistTenantNoticeSourceDocument(supabase, {
      landlordId: input.landlordId,
      propertyId: unit.propertyId,
      unitId: unit.unitId,
      storagePath: media[0],
    })
    : null

  const dates = inspectionDate
    ? [inspectionDate, ...extraction.inspectionDates.filter((d) => d !== inspectionDate)]
    : extraction.inspectionDates

  const { data: report, error } = await supabase
    .from("inspection_reports")
    .insert({
      landlord_id: input.landlordId,
      property_id: unit.propertyId,
      unit_id: unit.unitId,
      letter_date: null,
      inspection_date: inspectionDate,
      inspection_dates: dates,
      letter_type: TENANT_NOTICE_LETTER_TYPE,
      is_abated: false,
      emergency_item_count: 0,
      standard_item_count: 0,
      source_document_id: sourceDocumentId,
      status: "open",
      conversation_id: input.conversationId ?? null,
    })
    .select("id")
    .maybeSingle()

  if (error || !report?.id) {
    return { ok: false, reason: "insert_failed", detail: error?.message }
  }

  await recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: "inspection.tenant_notice_received",
    source: "sms",
    actorType: "resident",
    propertyId: unit.propertyId,
    unitId: unit.unitId,
    residentId: input.residentId,
    conversationId: input.conversationId ?? null,
    metadata: {
      message: inspectionDate
        ? `Resident shared an inspection notice for ${inspectionDate}.`
        : "Resident shared an upcoming inspection notice.",
      inspection_report_id: report.id,
      inspection_date: inspectionDate,
      letter_type: TENANT_NOTICE_LETTER_TYPE,
      source_document_id: sourceDocumentId,
    },
  }).catch(() => {})

  // PM Compliance row (preventive_maintenance_tasks) — never creates/links WOs.
  await ensureTenantNoticePmComplianceTask(supabase, {
    landlordId: input.landlordId,
    inspectionReportId: String(report.id),
    sourceDocumentId,
    unitId: unit.unitId,
    propertyId: unit.propertyId,
    inspectionDate,
  }).catch(() => {})

  return {
    ok: true,
    inspectionReportId: String(report.id),
    created: true,
    sourceDocumentId,
    inspectionDate,
    unitId: unit.unitId,
    propertyId: unit.propertyId,
  }
}

async function ensureTenantNoticePmComplianceTask(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    inspectionReportId: string
    sourceDocumentId: string | null
    unitId: string
    propertyId: string | null
    inspectionDate: string | null
  },
): Promise<void> {
  const { data: unitRow } = await supabase
    .from("units")
    .select("unit_label, building")
    .eq("id", input.unitId)
    .maybeSingle()

  const plan = planStandaloneInspectionPmComplianceTask({
    inspectionReportId: input.inspectionReportId,
    sourceDocumentId: input.sourceDocumentId,
    unitLabel: unitRow?.unit_label == null ? null : String(unitRow.unit_label),
    building: unitRow?.building == null ? null : String(unitRow.building),
    letterType: TENANT_NOTICE_LETTER_TYPE,
    inspectionDate: input.inspectionDate,
  })

  const { data: existing } = await supabase
    .from("preventive_maintenance_tasks")
    .select("id, metadata")
    .eq("landlord_id", input.landlordId)
    .contains("metadata", { inspection_report_id: input.inspectionReportId })
    .neq("status", "cancelled")
    .limit(5)

  const matching = (existing ?? []).filter((row) => {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {}
    return String(meta.source ?? "") === plan.metadata.source
  })
  if (matching.length > 0) return

  const wrongIds = (existing ?? []).map((row) => String(row.id)).filter(Boolean)
  if (wrongIds.length > 0) {
    await supabase
      .from("preventive_maintenance_tasks")
      .update({ status: "cancelled" })
      .in("id", wrongIds)
  }

  await supabase.from("preventive_maintenance_tasks").insert({
    landlord_id: input.landlordId,
    title: plan.title,
    task_kind: plan.taskKind,
    due_at: plan.dueAtIso,
    status: "scheduled",
    building: plan.building,
    unit_label: plan.unitLabel,
    metadata: plan.metadata,
  })
}

/** Attach a repair ticket as a checklist item under the inspection visit. */
export async function linkTicketToInspectionReport(
  supabase: SupabaseClient,
  input: {
    ticketId: string
    inspectionReportId: string
    inspectionDate?: string | null
    /** When true, set due_at from inspection date (end of day UTC). */
    alignDueAt?: boolean
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    inspection_report_id: input.inspectionReportId,
  }
  if (input.alignDueAt && input.inspectionDate?.trim()) {
    const day = input.inspectionDate.trim()
    // Noon UTC on inspection day — surfaces as the visit deadline without
    // pretending the SLA clock is the source of truth.
    patch.due_at = `${day}T20:00:00.000Z`
  }
  const { error } = await supabase
    .from("maintenance_requests")
    .update(patch)
    .eq("id", input.ticketId)
  if (error) {
    console.error("[tenant-inspection-notice] link ticket failed", error.message)
  }
}

/**
 * Resolve an open tenant_notice inspection for a resident's unit so new
 * repair tickets can attach as checklist items.
 */
export async function resolveOpenTenantInspectionForResident(
  supabase: SupabaseClient,
  input: { landlordId: string; residentId: string },
): Promise<{
  inspectionReportId: string
  inspectionDate: string | null
  unitId: string
  propertyId: string | null
} | null> {
  const unit = await resolveResidentUnit(supabase, input)
  if (!unit) return null
  const existing = await findOpenTenantInspectionReport(supabase, {
    landlordId: input.landlordId,
    unitId: unit.unitId,
  })
  if (!existing) return null
  return {
    inspectionReportId: existing.id,
    inspectionDate: existing.inspection_date,
    unitId: unit.unitId,
    propertyId: unit.propertyId,
  }
}

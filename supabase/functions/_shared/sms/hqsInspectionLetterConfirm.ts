/**
 * Persist a confirmed HQS letter → inspection_reports + owner work orders.
 * Pure planning is in shared/maintenance/hqsInspectionIntakePlan.ts;
 * this module performs the DB writes + activity log.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { HqsLetterExtraction } from "../../../../shared/maintenance/hqsInspectionLetter.ts"
import {
  canCreateHqsInspectionRecords,
  planHqsWorkOrdersFromExtraction,
  shouldSendHqsAbatementAlert,
} from "../../../../shared/maintenance/hqsInspectionIntakePlan.ts"
import {
  planHqsHomeDataGraphIngest,
  planHqsPmComplianceTask,
} from "../../../../shared/maintenance/hqsPropertySurfaces.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { dispatchConfirmedMaintenanceTicket } from "../confirmedMaintenanceDispatch.ts"
import { startMaintenanceRequestWorkflow } from "../engine/startMaintenanceRequestWorkflow.ts"

export type ConfirmHqsInspectionLetterInput = {
  landlordId: string
  unitId: string
  propertyId?: string | null
  extraction: HqsLetterExtraction
  sourceDocumentId?: string | null
  conversationId?: string | null
  landlordConfirmed: boolean
  tradeOverlay?: Record<string, string> | null
}

export type ConfirmHqsInspectionLetterResult =
  | {
    ok: true
    inspectionReportId: string
    workOrderIds: string[]
    abatementAlertSent: boolean
  }
  | { ok: false; reason: "not_confirmed" | "missing_unit" | "insert_failed"; detail?: string }

export async function confirmAndCreateHqsInspectionLetter(
  supabase: SupabaseClient,
  input: ConfirmHqsInspectionLetterInput,
): Promise<ConfirmHqsInspectionLetterResult> {
  if (!canCreateHqsInspectionRecords({
    unitId: input.unitId,
    landlordConfirmed: input.landlordConfirmed,
  })) {
    return {
      ok: false,
      reason: input.landlordConfirmed ? "missing_unit" : "not_confirmed",
    }
  }

  const planned = planHqsWorkOrdersFromExtraction(input.extraction, {
    tradeOverlay: input.tradeOverlay,
  })

  // Resolve unit occupancy before inserts so tickets + workflow runs share the
  // same resident_id (do not leave tickets null while only passing resident to runs).
  const { data: occupancy } = await supabase
    .from("occupancy")
    .select("resident_id")
    .eq("unit_id", input.unitId)
    .eq("landlord_id", input.landlordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const residentId =
    typeof occupancy?.resident_id === "string" && occupancy.resident_id.trim()
      ? occupancy.resident_id.trim()
      : null

  const { data: report, error: reportErr } = await supabase
    .from("inspection_reports")
    .insert({
      landlord_id: input.landlordId,
      property_id: input.propertyId ?? null,
      unit_id: input.unitId,
      owner_id_external: input.extraction.ownerIdExternal,
      tenant_id_external: input.extraction.tenantIdExternal,
      inspection_id_external: input.extraction.inspectionIdExternal,
      letter_date: input.extraction.letterDate,
      inspection_date: input.extraction.inspectionDates[0] ?? null,
      inspection_dates: input.extraction.inspectionDates,
      letter_type: input.extraction.letterType,
      is_abated: input.extraction.isAbated,
      reinspection_date: input.extraction.reinspectionDate,
      reinspection_fee: input.extraction.reinspectionFee,
      emergency_item_count: input.extraction.emergencyItemCount,
      standard_item_count: input.extraction.standardItemCount,
      source_document_id: input.sourceDocumentId ?? null,
      status: "open",
      conversation_id: input.conversationId ?? null,
    })
    .select("id")
    .maybeSingle()

  if (reportErr || !report?.id) {
    return { ok: false, reason: "insert_failed", detail: reportErr?.message }
  }

  const { data: unitRowEarly } = await supabase
    .from("units")
    .select("unit_label, building")
    .eq("id", input.unitId)
    .maybeSingle()
  const unitLabelEarly = unitRowEarly?.unit_label == null
    ? ""
    : String(unitRowEarly.unit_label).trim()
  const buildingEarly = unitRowEarly?.building == null
    ? null
    : String(unitRowEarly.building).trim() || null

  await applyHqsDownstreamSurfaces(supabase, {
    landlordId: input.landlordId,
    propertyId: input.propertyId ?? null,
    unitId: input.unitId,
    unitLabel: unitLabelEarly || null,
    building: buildingEarly,
    inspectionReportId: String(report.id),
    sourceDocumentId: input.sourceDocumentId ?? null,
    extraction: input.extraction,
  })

  const workOrderIds: string[] = []
  for (const row of planned) {
    const dueAt = row.dueAtIsoDate
      ? new Date(`${row.dueAtIsoDate}T17:00:00.000Z`).toISOString()
      : null
    const { data: ticket, error } = await supabase
      .from("maintenance_requests")
      .insert({
        landlord_id: input.landlordId,
        property_id: input.propertyId ?? null,
        unit_id: input.unitId,
        resident_id: residentId,
        description: row.description,
        issue_category: row.issueCategory,
        urgency: row.urgency,
        priority: row.priority,
        status: "open",
        vendor_work_status: "unassigned",
        due_at: dueAt,
        inspection_report_id: report.id,
      })
      .select("id")
      .maybeSingle()
    if (error || !ticket?.id) {
      console.error("[hqs-letter] work order insert failed", error?.message)
      continue
    }
    workOrderIds.push(String(ticket.id))
  }

  await recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: "inspection.letter_ingested",
    source: "sms",
    actorType: "landlord",
    propertyId: input.propertyId ?? null,
    unitId: input.unitId,
    conversationId: input.conversationId ?? null,
    metadata: {
      message: `Inspection letter recorded (${input.extraction.emergencyItemCount} emergency, ${input.extraction.standardItemCount} standard). ${workOrderIds.length} work orders created.`,
      inspection_report_id: report.id,
      letter_type: input.extraction.letterType,
      is_abated: input.extraction.isAbated,
    },
  })

  let abatementAlertSent = false
  if (shouldSendHqsAbatementAlert(input.extraction)) {
    abatementAlertSent = true
    await recordActivityLog(supabase, {
      landlordId: input.landlordId,
      eventType: "inspection.hap_abatement",
      source: "sms",
      actorType: "system",
      propertyId: input.propertyId ?? null,
      unitId: input.unitId,
      conversationId: input.conversationId ?? null,
      metadata: {
        message:
          "HAP abatement flagged on this inspection letter — housing assistance payment is at risk.",
        inspection_report_id: report.id,
      },
    })
    void notifyLandlordNeedsAttention(supabase, {
      landlordId: input.landlordId,
      kind: "workflow_escalated",
      headline: "HAP abatement on inspection letter",
      detail:
        "A housing inspection letter reports payment abatement. Review owner-responsibility repairs immediately.",
      idempotencyKey: `hqs-abatement:${report.id}`,
      propertyId: input.propertyId ?? null,
      unitId: input.unitId,
    })
  }

  // Emergency deficiencies → same immediate-alert tier as gas/fire/flooding.
  if (input.extraction.emergencyItemCount > 0) {
    void notifyLandlordNeedsAttention(supabase, {
      landlordId: input.landlordId,
      kind: "workflow_escalated",
      headline: "Emergency HQS fail items",
      detail: `${input.extraction.emergencyItemCount} 24-hour emergency item(s) from an inspection letter need immediate repair.`,
      idempotencyKey: `hqs-emergency:${report.id}`,
      propertyId: input.propertyId ?? null,
      unitId: input.unitId,
    })
  }

  // Same vendor-matching pipeline as confirmed SMS/web tickets — not an HQS silo.
  const unitLabel = unitLabelEarly

  for (const ticketId of workOrderIds) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select(
        "id, description, issue_category, urgency, priority, due_at, assigned_vendor_id, vendor_work_status, resident_id",
      )
      .eq("id", ticketId)
      .maybeSingle()
    if (!ticket?.id) continue

    let vendorAssigned = false
    let needsVendorEscalation = false
    try {
      const outcome = await dispatchConfirmedMaintenanceTicket(supabase, {
        ticketId: String(ticket.id),
        landlordId: input.landlordId,
        priority: String(ticket.priority ?? ticket.urgency ?? "normal"),
        urgency: String(ticket.urgency ?? ticket.priority ?? "normal"),
        unit: unitLabel || "unit",
        description: String(ticket.description ?? ""),
        issueHeadline: String(ticket.description ?? "").split("\n")[0] ?? null,
        dueAt: ticket.due_at == null ? null : String(ticket.due_at),
        locationLabel: [buildingEarly, unitLabel ? `Unit ${unitLabel}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      })
      vendorAssigned = outcome.vendorAssigned ||
        outcome.kind === "preferred_selection_underway"
      needsVendorEscalation = outcome.kind === "nearby_options_sent" ||
        outcome.kind === "dispatch_error" ||
        outcome.kind === "landlord_manual"
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error("[hqs-letter] vendor dispatch failed", ticketId, error)
      needsVendorEscalation = true
      try {
        await supabase
          .from("maintenance_requests")
          .update({
            vendor_notify_error: `Dispatch failed: ${error}`.slice(0, 500),
          })
          .eq("id", ticketId)
      } catch (updateErr) {
        console.error(
          "[hqs-letter] could not persist vendor_notify_error",
          ticketId,
          updateErr,
        )
      }
      try {
        await recordActivityLog(supabase, {
          landlordId: input.landlordId,
          eventType: "maintenance.dispatch_failed",
          source: "automation",
          actorType: "system",
          propertyId: input.propertyId ?? null,
          unitId: input.unitId,
          maintenanceRequestId: ticketId,
          conversationId: input.conversationId ?? null,
          metadata: {
            message:
              "Vendor dispatch failed for this inspection work order. Ulo kept the ticket open so other jobs from the same letter could continue.",
            error,
            source: "hqs_letter",
          },
        })
      } catch (logErr) {
        console.error("[hqs-letter] dispatch failure activity log", ticketId, logErr)
      }
    }

    // Active Tasks is workflow_runs-backed — same as SMS/web confirm paths.
    try {
      const { data: after } = await supabase
        .from("maintenance_requests")
        .select("assigned_vendor_id, vendor_work_status, due_at, resident_id")
        .eq("id", ticketId)
        .maybeSingle()
      const assignedAfter =
        typeof after?.assigned_vendor_id === "string" &&
        after.assigned_vendor_id.trim().length > 0
      const pendingAccept =
        String(after?.vendor_work_status ?? "").toLowerCase() === "pending_accept"
      await startMaintenanceRequestWorkflow(supabase, {
        landlordId: input.landlordId,
        ticketId: String(ticket.id),
        residentId:
          (typeof after?.resident_id === "string" && after.resident_id.trim()) ||
          (typeof ticket.resident_id === "string" && ticket.resident_id.trim()) ||
          residentId,
        unitId: input.unitId,
        propertyId: input.propertyId ?? null,
        triggerType: "sms_inbound",
        dueAt: (after?.due_at == null ? ticket.due_at : after.due_at) == null
          ? new Date().toISOString()
          : String(after?.due_at ?? ticket.due_at),
        issueCategory: String(ticket.issue_category ?? "general"),
        severity: String(ticket.urgency ?? ticket.priority ?? "normal"),
        unitLabel: unitLabel || null,
        source: "hqs_letter",
        conversationId: input.conversationId ?? null,
        vendorAssigned: vendorAssigned || assignedAfter || pendingAccept,
        needsVendorEscalation,
      })
    } catch (workflowErr) {
      console.error(
        "[hqs-letter] maintenance_request workflow",
        ticketId,
        workflowErr,
      )
    }
  }

  return {
    ok: true,
    inspectionReportId: String(report.id),
    workOrderIds,
    abatementAlertSent,
  }
}

/**
 * Backfill source doc scope + PM compliance task + Home Data Graph ingest audit.
 * Idempotent for PM/HDG; safe to call from confirm or remediation.
 */
export async function applyHqsDownstreamSurfaces(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    propertyId?: string | null
    unitId: string
    unitLabel?: string | null
    building?: string | null
    inspectionReportId: string
    sourceDocumentId?: string | null
    extraction: Pick<
      HqsLetterExtraction,
      | "letterType"
      | "isAbated"
      | "emergencyItemCount"
      | "standardItemCount"
      | "reinspectionDate"
      | "inspectionDates"
    >
  },
): Promise<void> {
  const sourceDocumentId = input.sourceDocumentId?.trim() || null
  if (sourceDocumentId) {
    const patch: Record<string, unknown> = {
      unit_id: input.unitId,
    }
    if (input.propertyId?.trim()) patch.property_id = input.propertyId.trim()
    const { error } = await supabase
      .from("inspection_source_documents")
      .update(patch)
      .eq("id", sourceDocumentId)
      .eq("landlord_id", input.landlordId)
    if (error) {
      console.error("[hqs-letter] source document scope backfill", error.message)
    }
  }

  const pmPlan = planHqsPmComplianceTask({
    inspectionReportId: input.inspectionReportId,
    sourceDocumentId,
    unitLabel: input.unitLabel,
    building: input.building,
    letterType: input.extraction.letterType,
    isAbated: input.extraction.isAbated,
    emergencyItemCount: input.extraction.emergencyItemCount,
    standardItemCount: input.extraction.standardItemCount,
    reinspectionDate: input.extraction.reinspectionDate,
    inspectionDate: input.extraction.inspectionDates[0] ?? null,
  })

  try {
    const { data: existingPm } = await supabase
      .from("preventive_maintenance_tasks")
      .select("id")
      .eq("landlord_id", input.landlordId)
      .contains("metadata", { inspection_report_id: input.inspectionReportId })
      .neq("status", "cancelled")
      .limit(1)
    if (!existingPm?.length) {
      const { error: pmErr } = await supabase
        .from("preventive_maintenance_tasks")
        .insert({
          landlord_id: input.landlordId,
          title: pmPlan.title,
          task_kind: pmPlan.taskKind,
          due_at: pmPlan.dueAtIso,
          status: "scheduled",
          building: pmPlan.building,
          unit_label: pmPlan.unitLabel,
          metadata: pmPlan.metadata,
        })
      if (pmErr) {
        console.error("[hqs-letter] PM compliance task insert", pmErr.message)
      } else {
        await recordActivityLog(supabase, {
          landlordId: input.landlordId,
          eventType: "pm.task_created",
          source: "sms",
          actorType: "system",
          propertyId: input.propertyId ?? null,
          unitId: input.unitId,
          metadata: {
            message: `${pmPlan.title} added to preventive maintenance.`,
            inspection_report_id: input.inspectionReportId,
            source: "hqs_letter",
          },
        })
      }
    }
  } catch (e) {
    console.error("[hqs-letter] PM compliance ingest", e)
  }

  const propertyId = input.propertyId?.trim()
  if (propertyId) {
    let fileName: string | null = null
    let storagePath: string | null = null
    if (sourceDocumentId) {
      const { data: doc } = await supabase
        .from("inspection_source_documents")
        .select("file_name, storage_path")
        .eq("id", sourceDocumentId)
        .maybeSingle()
      fileName = typeof doc?.file_name === "string" ? doc.file_name : null
      storagePath = typeof doc?.storage_path === "string" ? doc.storage_path : null
    }
    const hdgPlan = planHqsHomeDataGraphIngest({
      inspectionReportId: input.inspectionReportId,
      sourceDocumentId,
      unitId: input.unitId,
      unitLabel: input.unitLabel,
      letterType: input.extraction.letterType,
      isAbated: input.extraction.isAbated,
      emergencyItemCount: input.extraction.emergencyItemCount,
      standardItemCount: input.extraction.standardItemCount,
      fileName,
      storagePath,
    })
    try {
      const { data: existingIngest } = await supabase
        .from("home_data_graph_ingest")
        .select("id")
        .eq("property_id", propertyId)
        .eq("provider", hdgPlan.provider)
        .eq("provider_record_id", hdgPlan.providerRecordId)
        .limit(1)
      if (!existingIngest?.length) {
        const { error: hdgErr } = await supabase
          .from("home_data_graph_ingest")
          .insert({
            property_id: propertyId,
            landlord_id: input.landlordId,
            provider: hdgPlan.provider,
            provider_record_id: hdgPlan.providerRecordId,
            raw_payload: hdgPlan.raw,
            fetched_at: new Date().toISOString(),
          })
        if (hdgErr) {
          console.error("[hqs-letter] home data graph ingest", hdgErr.message)
        }
      }
    } catch (e) {
      console.error("[hqs-letter] home data graph ingest", e)
    }
  }
}

export async function upsertHqsOwnerTenantUnitMap(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    ownerIdExternal: string
    tenantIdExternal: string
    unitId: string
    propertyId?: string | null
  },
): Promise<void> {
  await supabase.from("hqs_owner_tenant_unit_map").upsert(
    {
      landlord_id: input.landlordId,
      owner_id_external: input.ownerIdExternal.trim(),
      tenant_id_external: input.tenantIdExternal.trim(),
      unit_id: input.unitId,
      property_id: input.propertyId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "landlord_id,owner_id_external,tenant_id_external" },
  )
}

export async function loadHqsOwnerTenantUnitMap(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    ownerIdExternal: string | null
    tenantIdExternal: string | null
  },
): Promise<{ unitId: string; propertyId: string | null } | null> {
  const owner = input.ownerIdExternal?.trim()
  const tenant = input.tenantIdExternal?.trim()
  if (!owner || !tenant) return null
  const { data } = await supabase
    .from("hqs_owner_tenant_unit_map")
    .select("unit_id, property_id")
    .eq("landlord_id", input.landlordId)
    .eq("owner_id_external", owner)
    .eq("tenant_id_external", tenant)
    .maybeSingle()
  if (!data?.unit_id) return null
  return {
    unitId: String(data.unit_id),
    propertyId: data.property_id == null ? null : String(data.property_id),
  }
}

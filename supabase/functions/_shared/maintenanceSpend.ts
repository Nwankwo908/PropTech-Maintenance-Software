import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  logGraphEvent,
  type GraphEventActorType,
  type GraphEventSource,
} from "./graph/logGraphEvent.ts"
import { logLedgerEvent } from "./engine/ledgerEvents.ts"
import { notifyLandlordNeedsAttention } from "./landlordAttentionNotify.ts"
import { recordMaintenanceInvoicePaidActivity } from "./paymentActivityEvents.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"

/** Canonical maintenance spend graph event types. */
export const MAINTENANCE_GRAPH_EVENTS = {
  invoiceSubmitted: "maintenance.invoice_submitted",
  invoiceApproved: "maintenance.invoice_approved",
  spendRecorded: "maintenance.spend_recorded",
} as const

export type MaintenanceSpendScope = {
  landlordId: string
  maintenanceRequestId: string
  vendorId?: string | null
  unitId?: string | null
  propertyId?: string | null
  residentId?: string | null
}

export type MaintenanceInvoiceInput = {
  laborCost: number
  materialCost: number
  taxAmount: number
  invoiceNumber?: string | null
  documentPath?: string | null
  vendorNotes?: string | null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function billingPeriodFromDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export async function resolveMaintenanceSpendScope(
  supabase: SupabaseClient,
  maintenanceRequestId: string,
): Promise<MaintenanceSpendScope | null> {
  const { data, error } = await supabase
    .from("maintenance_request_enriched")
    .select(
      "id, landlord_id, assigned_vendor_id, unit_id, property_id, resident_id",
    )
    .eq("id", maintenanceRequestId)
    .maybeSingle()

  if (error || !data?.landlord_id) {
    console.error("[maintenance-spend] resolve scope", error?.message)
    return null
  }

  return {
    landlordId: String(data.landlord_id),
    maintenanceRequestId,
    vendorId: data.assigned_vendor_id == null
      ? null
      : String(data.assigned_vendor_id),
    unitId: data.unit_id == null ? null : String(data.unit_id),
    propertyId: data.property_id == null ? null : String(data.property_id),
    residentId: data.resident_id == null ? null : String(data.resident_id),
  }
}

async function logMaintenanceGraphEvent(
  supabase: SupabaseClient,
  scope: MaintenanceSpendScope,
  params: {
    eventType: string
    source: GraphEventSource
    actorType?: GraphEventActorType | null
    actorId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  // Official activity log path (dual-writes property_operations_graph).
  return logGraphEvent(supabase, {
    landlord_id: scope.landlordId,
    event_type: params.eventType,
    source: params.source,
    actor_type: params.actorType ?? "system",
    actor_id: params.actorId ?? null,
    maintenance_request_id: scope.maintenanceRequestId,
    vendor_id: scope.vendorId ?? null,
    unit_id: scope.unitId ?? null,
    property_id: scope.propertyId ?? null,
    resident_id: scope.residentId ?? null,
    metadata: {
      maintenance_request_id: scope.maintenanceRequestId,
      ...(params.metadata ?? {}),
    },
  })
}

/** Vendor uploads invoice after job completion → pending landlord approval. */
export async function submitMaintenanceInvoice(
  supabase: SupabaseClient,
  params: {
    maintenanceRequestId: string
    vendorId: string
    invoice: MaintenanceInvoiceInput
    source?: GraphEventSource
  },
): Promise<{ invoiceId: string; totalCost: number } | { error: string }> {
  const scope = await resolveMaintenanceSpendScope(
    supabase,
    params.maintenanceRequestId,
  )
  if (!scope) return { error: "ticket_not_found" }
  if (scope.vendorId !== params.vendorId) return { error: "forbidden" }

  const { data: ticket, error: ticketErr } = await supabase
    .from("maintenance_requests")
    .select("id, vendor_work_status, spend_status, completion_photo_paths")
    .eq("id", params.maintenanceRequestId)
    .maybeSingle()

  if (ticketErr || !ticket) return { error: "ticket_not_found" }
  const workStatus = String(ticket.vendor_work_status ?? "")
  const photoCount = Array.isArray(ticket.completion_photo_paths)
    ? (ticket.completion_photo_paths as unknown[]).filter(
      (p) => typeof p === "string" && p.trim(),
    ).length
    : 0
  // Allow submit after photos while awaiting resident rating (in_progress),
  // or after the job is fully completed.
  const canInvoice =
    workStatus === "completed" ||
    (workStatus === "in_progress" && photoCount > 0)
  if (!canInvoice) {
    return { error: "job_not_completed" }
  }

  const laborCost = roundMoney(Math.max(0, params.invoice.laborCost))
  const materialCost = roundMoney(Math.max(0, params.invoice.materialCost))
  const taxAmount = roundMoney(Math.max(0, params.invoice.taxAmount))
  const totalCost = roundMoney(laborCost + materialCost + taxAmount)

  if (totalCost <= 0) return { error: "invalid_amount" }

  const now = new Date().toISOString()
  const row = {
    landlord_id: scope.landlordId,
    maintenance_request_id: params.maintenanceRequestId,
    vendor_id: params.vendorId,
    invoice_number: params.invoice.invoiceNumber?.trim() || null,
    labor_cost: laborCost,
    material_cost: materialCost,
    tax_amount: taxAmount,
    status: "submitted",
    document_path: params.invoice.documentPath?.trim() || null,
    vendor_notes: params.invoice.vendorNotes?.trim() || null,
    submitted_at: now,
    updated_at: now,
    rejection_reason: null,
    approved_at: null,
    approved_by: null,
  }

  const { data: invoice, error: invErr } = await supabase
    .from("maintenance_invoices")
    .upsert(row, { onConflict: "maintenance_request_id" })
    .select("id, total_cost")
    .single()

  if (invErr || !invoice) {
    console.error("[maintenance-spend] invoice upsert", invErr?.message)
    return { error: "invoice_save_failed" }
  }

  await supabase
    .from("maintenance_requests")
    .update({ spend_status: "pending_approval" })
    .eq("id", params.maintenanceRequestId)

  await logMaintenanceGraphEvent(supabase, scope, {
    eventType: MAINTENANCE_GRAPH_EVENTS.invoiceSubmitted,
    source: params.source ?? "vendor_portal",
    actorType: "vendor",
    actorId: params.vendorId,
    metadata: {
      invoice_id: invoice.id,
      labor_cost: laborCost,
      material_cost: materialCost,
      tax_amount: taxAmount,
      total_cost: totalCost,
      invoice_number: params.invoice.invoiceNumber ?? null,
    },
  })

  try {
    const [{ data: ticketRow }, { data: vendorRow }] = await Promise.all([
      supabase
        .from("maintenance_requests")
        .select("unit, resident_name")
        .eq("id", params.maintenanceRequestId)
        .maybeSingle(),
      supabase.from("vendors").select("name").eq("id", params.vendorId).maybeSingle(),
    ])
    const unit =
      typeof ticketRow?.unit === "string" && ticketRow.unit.trim()
        ? ticketRow.unit.trim()
        : ""
    const vendorName =
      typeof vendorRow?.name === "string" && vendorRow.name.trim()
        ? vendorRow.name.trim()
        : "Vendor"
    const amount = totalCost.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    })
    const wo = formatWorkOrderRef(params.maintenanceRequestId)
    await notifyLandlordNeedsAttention(supabase, {
      landlordId: scope.landlordId,
      kind: "invoice_ready",
      headline: "Invoice ready to pay",
      detail: `${wo}${unit ? ` · Unit ${unit}` : ""} · ${vendorName} · ${amount}`,
      idempotencyKey: `invoice:${invoice.id}`,
      maintenanceRequestId: params.maintenanceRequestId,
      vendorId: params.vendorId,
      unitId: scope.unitId,
      propertyId: scope.propertyId,
      residentId: scope.residentId,
    })
  } catch (e) {
    console.error("[maintenance-spend] attention notify", e)
  }

  return {
    invoiceId: String(invoice.id),
    totalCost: Number(invoice.total_cost ?? totalCost),
  }
}

/** Landlord approves invoice → ledger + graph spend recognition. */
export async function approveMaintenanceInvoice(
  supabase: SupabaseClient,
  params: {
    invoiceId: string
    landlordId: string
    approvedByUserId?: string | null
    source?: GraphEventSource
  },
): Promise<{ recognizedAmount: number } | { error: string }> {
  const { data: invoice, error: invErr } = await supabase
    .from("maintenance_invoices")
    .select(
      "id, landlord_id, maintenance_request_id, vendor_id, total_cost, labor_cost, material_cost, tax_amount, status, invoice_number, metadata",
    )
    .eq("id", params.invoiceId)
    .maybeSingle()

  if (invErr || !invoice) return { error: "invoice_not_found" }
  if (String(invoice.landlord_id) !== params.landlordId) {
    return { error: "forbidden" }
  }
  if (String(invoice.status) === "approved") {
    return { recognizedAmount: Number(invoice.total_cost ?? 0) }
  }
  if (String(invoice.status) !== "submitted") {
    return { error: "invoice_not_submittable" }
  }

  const totalCost = Number(invoice.total_cost ?? 0)
  if (!Number.isFinite(totalCost) || totalCost <= 0) {
    return { error: "invalid_amount" }
  }

  const scope = await resolveMaintenanceSpendScope(
    supabase,
    String(invoice.maintenance_request_id),
  )
  if (!scope) return { error: "ticket_not_found" }

  const approvedAt = new Date().toISOString()
  const billingPeriod = billingPeriodFromDate(approvedAt)
  const existingMeta =
    invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata)
      ? invoice.metadata as Record<string, unknown>
      : {}

  const { error: approveErr } = await supabase
    .from("maintenance_invoices")
    .update({
      status: "approved",
      approved_at: approvedAt,
      approved_by: params.approvedByUserId ?? null,
      updated_at: approvedAt,
      metadata: {
        ...existingMeta,
        billing_event: "paid",
        billing_logged_at: approvedAt,
      },
    })
    .eq("id", params.invoiceId)

  if (approveErr) {
    console.error("[maintenance-spend] approve update", approveErr.message)
    return { error: "approve_failed" }
  }

  const ledgerId = await logLedgerEvent(supabase, {
    landlordId: scope.landlordId,
    workflowType: "maintenance",
    residentId: scope.residentId,
    unitId: scope.unitId,
    propertyId: scope.propertyId,
    eventType: "maintenance_expense",
    direction: "debit",
    amount: totalCost,
    billingPeriod,
    description: `Maintenance invoice approved${invoice.invoice_number ? ` (${invoice.invoice_number})` : ""}`,
    metadata: {
      invoice_id: params.invoiceId,
      maintenance_request_id: scope.maintenanceRequestId,
      vendor_id: scope.vendorId,
      labor_cost: invoice.labor_cost,
      material_cost: invoice.material_cost,
      tax_amount: invoice.tax_amount,
    },
  })

  await recordMaintenanceInvoicePaidActivity(supabase, {
    landlordId: scope.landlordId,
    invoiceId: params.invoiceId,
    invoiceNumber:
      typeof invoice.invoice_number === "string" ? invoice.invoice_number : null,
    maintenanceRequestId: scope.maintenanceRequestId,
    vendorId: scope.vendorId ?? null,
    unitId: scope.unitId ?? null,
    propertyId: scope.propertyId ?? null,
    residentId: scope.residentId ?? null,
    source: params.source === "dashboard" ? "dashboard" : "automation",
  })

  await logMaintenanceGraphEvent(supabase, scope, {
    eventType: MAINTENANCE_GRAPH_EVENTS.spendRecorded,
    source: params.source ?? "dashboard",
    actorType: "landlord",
    actorId: params.approvedByUserId ?? null,
    metadata: {
      invoice_id: params.invoiceId,
      ledger_event_id: ledgerId,
      total_cost: totalCost,
      billing_period: billingPeriod,
      labor_cost: invoice.labor_cost,
      material_cost: invoice.material_cost,
      tax_amount: invoice.tax_amount,
    },
  })

  await supabase
    .from("maintenance_requests")
    .update({
      spend_status: "recognized",
      recognized_spend_at: approvedAt,
      recognized_spend_amount: totalCost,
    })
    .eq("id", scope.maintenanceRequestId)

  return { recognizedAmount: totalCost }
}

/** Mark job completed (sets completed_at + awaiting_invoice when no invoice yet). */
export async function markMaintenanceJobCompleted(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      completed_at: now,
      spend_status: "awaiting_invoice",
    })
    .eq("id", ticketId)
    .is("completed_at", null)

  await supabase
    .from("maintenance_requests")
    .update({ spend_status: "awaiting_invoice" })
    .eq("id", ticketId)
    .eq("spend_status", "none")
}

/** Load public invoice form context for `/invoice/:token`. */
export async function loadInvoiceContextForJobToken(
  supabase: SupabaseClient,
  jobToken: string,
): Promise<
  | {
      ok: true
      ticketId: string
      vendorId: string
      workOrderRef: string
      unit: string
      description: string
      vendorWorkStatus: string
      completionPhotoCount: number
      canSubmit: boolean
      approvedEstimate: {
        partsCost: number
        laborCost: number
        totalCost: number
      } | null
      existingInvoice: {
        id: string
        laborCost: number
        materialCost: number
        taxAmount: number
        totalCost: number
        status: string
      } | null
    }
  | { ok: false; error: string; status: number }
> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, description, assigned_vendor_id, vendor_action_token, vendor_work_status, completion_photo_paths",
    )
    .eq("vendor_action_token", jobToken)
    .maybeSingle()

  if (error || !ticket?.id) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (typeof ticket.assigned_vendor_id !== "string" || !ticket.assigned_vendor_id) {
    return { ok: false, error: "No vendor assigned to this job", status: 400 }
  }

  const workStatus = String(ticket.vendor_work_status ?? "")
  const photoCount = Array.isArray(ticket.completion_photo_paths)
    ? (ticket.completion_photo_paths as unknown[]).filter(
      (p) => typeof p === "string" && p.trim(),
    ).length
    : 0
  const canSubmit =
    workStatus === "completed" ||
    (workStatus === "in_progress" && photoCount > 0)

  const { data: approved } = await supabase
    .from("maintenance_estimates")
    .select("parts_cost, labor_cost, total_cost")
    .eq("maintenance_request_id", ticket.id)
    .eq("status", "approved")
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: existing } = await supabase
    .from("maintenance_invoices")
    .select(
      "id, labor_cost, material_cost, tax_amount, total_cost, status",
    )
    .eq("maintenance_request_id", ticket.id)
    .maybeSingle()

  return {
    ok: true,
    ticketId: ticket.id as string,
    vendorId: ticket.assigned_vendor_id,
    workOrderRef: formatWorkOrderRef(ticket.id as string),
    unit: typeof ticket.unit === "string" ? ticket.unit : "",
    description: typeof ticket.description === "string" ? ticket.description : "",
    vendorWorkStatus: workStatus,
    completionPhotoCount: photoCount,
    canSubmit,
    approvedEstimate: approved
      ? {
          partsCost: Number(approved.parts_cost) || 0,
          laborCost: Number(approved.labor_cost) || 0,
          totalCost: Number(approved.total_cost) || 0,
        }
      : null,
    existingInvoice: existing
      ? {
          id: String(existing.id),
          laborCost: Number(existing.labor_cost) || 0,
          materialCost: Number(existing.material_cost) || 0,
          taxAmount: Number(existing.tax_amount) || 0,
          totalCost: Number(existing.total_cost) || 0,
          status: String(existing.status),
        }
      : null,
  }
}

/**
 * If the vendor never submitted an invoice but an approved estimate exists,
 * create a submitted invoice from that estimate (for admin pay attention).
 */
export async function ensureInvoiceFromApprovedEstimate(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    source?: GraphEventSource
  },
): Promise<{ invoiceId: string; totalCost: number } | { skipped: string } | { error: string }> {
  const { data: existing } = await supabase
    .from("maintenance_invoices")
    .select("id, total_cost, status")
    .eq("maintenance_request_id", params.ticketId)
    .maybeSingle()

  if (existing?.id) {
    return {
      invoiceId: String(existing.id),
      totalCost: Number(existing.total_cost) || 0,
    }
  }

  const { data: approved } = await supabase
    .from("maintenance_estimates")
    .select("parts_cost, labor_cost, total_cost")
    .eq("maintenance_request_id", params.ticketId)
    .eq("status", "approved")
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!approved) {
    return { skipped: "no_approved_estimate" }
  }

  const laborCost = Number(approved.labor_cost) || 0
  const materialCost = Number(approved.parts_cost) || 0
  const total = laborCost + materialCost
  if (total <= 0) {
    return { skipped: "estimate_zero" }
  }

  return await submitMaintenanceInvoice(supabase, {
    maintenanceRequestId: params.ticketId,
    vendorId: params.vendorId,
    invoice: {
      laborCost,
      materialCost,
      taxAmount: 0,
      vendorNotes: "Created from approved estimate",
    },
    source: params.source ?? "edge_function",
  })
}

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  logGraphEvent,
  type GraphEventActorType,
  type GraphEventSource,
} from "./graph/logGraphEvent.ts"
import { logPropertyOperationsGraph } from "./graph/logPropertyOperationsGraph.ts"
import { logLedgerEvent } from "./engine/ledgerEvents.ts"

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
  const graphEventId = await logGraphEvent(supabase, {
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
    metadata: params.metadata ?? {},
  })

  await logPropertyOperationsGraph(supabase, {
    landlord_id: scope.landlordId,
    property_id: scope.propertyId ?? null,
    unit_id: scope.unitId ?? null,
    resident_id: scope.residentId ?? null,
    vendor_id: scope.vendorId ?? null,
    event_type: params.eventType,
    event_source: params.source,
    event_payload: {
      maintenance_request_id: scope.maintenanceRequestId,
      operations_graph_event_id: graphEventId,
      ...(params.metadata ?? {}),
    },
  })

  return graphEventId
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
    .select("id, vendor_work_status, spend_status")
    .eq("id", params.maintenanceRequestId)
    .maybeSingle()

  if (ticketErr || !ticket) return { error: "ticket_not_found" }
  if (String(ticket.vendor_work_status) !== "completed") {
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
      "id, landlord_id, maintenance_request_id, vendor_id, total_cost, labor_cost, material_cost, tax_amount, status, invoice_number",
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

  const { error: approveErr } = await supabase
    .from("maintenance_invoices")
    .update({
      status: "approved",
      approved_at: approvedAt,
      approved_by: params.approvedByUserId ?? null,
      updated_at: approvedAt,
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

  await logMaintenanceGraphEvent(supabase, scope, {
    eventType: MAINTENANCE_GRAPH_EVENTS.invoiceApproved,
    source: params.source ?? "dashboard",
    actorType: "landlord",
    actorId: params.approvedByUserId ?? null,
    metadata: {
      invoice_id: params.invoiceId,
      total_cost: totalCost,
      approved_at: approvedAt,
    },
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

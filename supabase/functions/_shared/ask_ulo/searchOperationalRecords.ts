/**
 * Structured operational retrieval for Ask Ulo.
 * Same source of truth as the Active Tasks work-order detail drawer:
 * workflow_runs → maintenance_requests → maintenance_invoices → vendors.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  textMatchesOpsTerms,
  type OpsCategoryId,
} from "./deepOperationalInvestigation.ts"
import { sanitizeBuildingFilter } from "./buildingFilter.ts"
import { loadVendorNameById } from "./vendorNames.ts"

export type OperationalCostSource =
  | "invoice"
  | "recognized_spend"
  | "workflow_metadata"
  | "minutes_proxy"

export type OperationalWorkOrder = {
  workOrderId: string
  maintenanceRequestId: string
  workflowRunId: string | null
  propertyName: string
  unitLabel: string | null
  category: string
  title: string
  description: string
  priority: string | null
  estimatedCost: number | null
  estimatedCostSource: OperationalCostSource | null
  repairScope: string
  laborEstimate: string
  workflowStage: string | null
  workflowStatus: string | null
  vendorName: string | null
  vendorWorkStatus: string | null
  slaExpired: boolean
  approvalStatus: "review_required" | "not_required"
  dueAt: string | null
  expectedCompletion: string | null
  createdAt: string
  daysOpen: number
  estimatedMinutes: number | null
}

export type SearchOperationalRecordsInput = {
  organizationId: string
  propertyId?: string | null
  unitId?: string | null
  /** Building / property name filter (substring). */
  buildingFilter?: string | null
  unitLabel?: string | null
  category?: OpsCategoryId | string | null
  /** Extra synonym / free-text terms beyond category expansion. */
  searchTerms?: string[]
  status?: string | null
  query?: string | null
  dateRangeDays?: number
  limit?: number
}

export type SearchOperationalRecordsResult = {
  available: boolean
  workOrders: OperationalWorkOrder[]
  tablesQueried: string[]
  filters: Record<string, unknown>
  error: string | null
  /** Structured log payload for every Ask Ulo ops retrieval. */
  log: OperationalRetrievalLog
}

export type OperationalRetrievalLog = {
  intentHint: string | null
  category: string | null
  searchFilters: Record<string, unknown>
  tablesOrRpcs: string[]
  recordCount: number
  matchingWorkOrderIds: string[]
  estimatedCostFound: boolean
  estimatedCosts: Array<{ workOrderId: string; estimatedCost: number | null; source: string | null }>
  evidencePayloadBytes: number
  fallbackReason: string | null
}

const OPEN_VENDOR_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
]

const OPEN_WORKFLOW_STATUSES = ["active", "escalated"]

const DEFAULT_REPAIR_SCOPE = "Standard Diagnostic + Repair"
const COST_PER_MINUTE = 1.25
const DEFAULT_ESTIMATED_MINUTES = 240

export function formatWorkOrderId(ticketId: string): string {
  const compact = ticketId.replace(/-/g, "").slice(0, 4).toUpperCase()
  return `WO-${compact || "0000"}`
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function invoiceTotalFromRow(raw: Record<string, unknown>): number | null {
  const total = asFiniteNumber(raw.total_cost ?? raw.invoice_total ?? raw.amount)
  if (total != null) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor == null && material == null && tax == null) return null
  return (labor ?? 0) + (material ?? 0) + (tax ?? 0)
}

/** Same cost resolution as WorkflowPipelineDetailPanel / resolveEstimatedCost. */
export function resolveOperationalEstimatedCost(input: {
  ticket: Record<string, unknown> | null
  invoice: Record<string, unknown> | null
  metadata: Record<string, unknown>
}): { amount: number | null; source: OperationalCostSource | null } {
  const { ticket, invoice, metadata } = input
  const invoiceTotal = invoice ? invoiceTotalFromRow(invoice) : null
  if (invoiceTotal != null && invoiceTotal > 0) {
    return { amount: invoiceTotal, source: "invoice" }
  }

  const recognized = ticket ? asFiniteNumber(ticket.recognized_spend_amount) : null
  if (recognized != null && recognized > 0) {
    return { amount: recognized, source: "recognized_spend" }
  }

  const metadataCost = asFiniteNumber(metadata.estimated_cost)
  if (metadataCost != null && metadataCost > 0) {
    return { amount: metadataCost, source: "workflow_metadata" }
  }

  if (!ticket) return { amount: null, source: null }

  const ticketInvoiceTotal = invoiceTotalFromRow(ticket)
  if (ticketInvoiceTotal != null && ticketInvoiceTotal > 0) {
    return { amount: ticketInvoiceTotal, source: "invoice" }
  }

  const minutes = asFiniteNumber(ticket.estimated_minutes)
  return {
    amount: (minutes ?? DEFAULT_ESTIMATED_MINUTES) * COST_PER_MINUTE,
    source: "minutes_proxy",
  }
}

export function formatLaborEstimate(estimatedMinutes: number | null): string {
  if (estimatedMinutes == null || !Number.isFinite(estimatedMinutes)) {
    return "1–2 hours"
  }
  const hours = Math.max(1, Math.round(estimatedMinutes / 60))
  return hours === 1 ? "1 hour" : `${hours} hours`
}

export function parseBuildingAndUnit(
  unitField: string | null | undefined,
  metadata: Record<string, unknown>,
  buildingHint?: string | null,
): { propertyName: string; unitLabel: string | null } {
  const metaBuilding =
    typeof metadata.building === "string" && metadata.building.trim()
      ? metadata.building.trim()
      : null
  const metaUnit =
    typeof metadata.unit_label === "string" && metadata.unit_label.trim()
      ? metadata.unit_label.trim()
      : null

  const raw = (unitField ?? "").trim()
  if (raw.includes("·")) {
    const [left, right] = raw.split("·").map((s) => s.trim())
    return {
      propertyName: metaBuilding || left || buildingHint || "Property",
      unitLabel: metaUnit || right || null,
    }
  }
  if (/^\d+[A-Za-z]?$/.test(raw) || /^[A-Za-z]?\d{1,5}[A-Za-z]?$/.test(raw)) {
    return {
      propertyName: metaBuilding || buildingHint || "Property",
      unitLabel: metaUnit || raw || null,
    }
  }
  return {
    propertyName: metaBuilding || buildingHint || (raw || "Property"),
    unitLabel: metaUnit,
  }
}

function daysSince(iso: string, nowMs: number): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000))
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return {}
}

function buildingMatch(building: string | null | undefined, filter: string | null): boolean {
  if (!filter?.trim()) return true
  if (!building?.trim()) return false
  return building.toLowerCase().includes(filter.trim().toLowerCase())
}

function unitMatch(unit: string | null | undefined, filter: string | null): boolean {
  if (!filter?.trim()) return true
  if (!unit?.trim()) return false
  return unit.toLowerCase() === filter.trim().toLowerCase() ||
    unit.toLowerCase().includes(filter.trim().toLowerCase())
}

function workflowStageLabel(input: {
  workflowStatus: string | null
  currentStep: string | null
  vendorWorkStatus: string | null
}): string {
  const status = (input.workflowStatus ?? "").toLowerCase()
  const step = (input.currentStep ?? "").toLowerCase()
  const vendor = (input.vendorWorkStatus ?? "").toLowerCase()
  if (status === "escalated" || step.includes("needs_admin")) return "escalated_review"
  if (vendor === "completed" || status === "completed") return "completed"
  if (vendor === "in_progress") return "in_progress"
  if (vendor === "accepted" || vendor === "pending_accept") return "vendor_assigned"
  if (vendor === "unassigned") return "new_intake"
  if (status === "active") return "in_progress"
  return status || vendor || "unknown"
}

/**
 * Search operational work orders using the same tables as the workflow detail UI.
 */
export async function searchOperationalRecords(
  supabase: SupabaseClient,
  input: SearchOperationalRecordsInput,
): Promise<SearchOperationalRecordsResult> {
  const organizationId = input.organizationId.trim()
  const dateRangeDays = input.dateRangeDays ?? 120
  const limit = input.limit ?? 40
  // Never treat HVAC / plumbing / etc. as a property name filter.
  const buildingFilter = sanitizeBuildingFilter(input.buildingFilter)
  const unitLabelFilter = input.unitLabel?.trim() || null
  const searchTerms = [
    ...(input.searchTerms ?? []),
    ...(input.query?.trim() ? [input.query.trim()] : []),
  ].map((t) => t.toLowerCase())

  // Prefer structured category equality before free-text title matching.
  const structuredCategory = input.category
    ? String(input.category).toLowerCase().trim()
    : null

  const filters: Record<string, unknown> = {
    organizationId,
    propertyId: input.propertyId ?? null,
    unitId: input.unitId ?? null,
    buildingFilter,
    buildingFilterRaw: input.buildingFilter ?? null,
    unitLabel: unitLabelFilter,
    category: structuredCategory,
    status: input.status ?? null,
    searchTerms,
    dateRangeDays,
    includeWorkflowMetadata: true,
  }

  const emptyLog = (fallbackReason: string | null): OperationalRetrievalLog => ({
    intentHint: null,
    category: input.category ? String(input.category) : null,
    searchFilters: filters,
    tablesOrRpcs: [],
    recordCount: 0,
    matchingWorkOrderIds: [],
    estimatedCostFound: false,
    estimatedCosts: [],
    evidencePayloadBytes: 0,
    fallbackReason,
  })

  if (!organizationId) {
    return {
      available: false,
      workOrders: [],
      tablesQueried: [],
      filters,
      error: "missing_organization_id",
      log: emptyLog("missing_organization_id"),
    }
  }

  const now = Date.now()
  const sinceIso = new Date(now - dateRangeDays * 86_400_000).toISOString()
  const tablesQueried: string[] = []

  // 1) Work-order pipeline: workflow_runs (same list source as Active Tasks)
  tablesQueried.push("workflow_runs")
  let runQuery = supabase
    .from("workflow_runs")
    .select(
      "id, status, entity_type, entity_id, property_id, unit_id, current_step, started_at, metadata, landlord_id",
    )
    .eq("landlord_id", organizationId)
    .in("status", OPEN_WORKFLOW_STATUSES)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(80)

  if (input.propertyId) runQuery = runQuery.eq("property_id", input.propertyId)
  if (input.unitId) runQuery = runQuery.eq("unit_id", input.unitId)

  const { data: runs, error: runError } = await runQuery
  if (runError) {
    console.error("[ask_ulo/searchOperationalRecords] workflow_runs", runError.message)
    return {
      available: false,
      workOrders: [],
      tablesQueried,
      filters,
      error: runError.message,
      log: { ...emptyLog(`workflow_runs_error:${runError.message}`), tablesOrRpcs: tablesQueried },
    }
  }

  type RunRow = {
    id: string
    status: string | null
    entity_type: string | null
    entity_id: string | null
    property_id: string | null
    unit_id: string | null
    current_step: string | null
    started_at: string | null
    metadata: unknown
  }

  const maintenanceRuns = ((runs ?? []) as RunRow[]).filter(
    (r) =>
      (r.entity_type === "maintenance_request" || r.entity_type === "maintenance") &&
      typeof r.entity_id === "string" &&
      r.entity_id.length > 0,
  )

  const ticketIdsFromRuns = Array.from(
    new Set(maintenanceRuns.map((r) => String(r.entity_id))),
  )

  // 2) Maintenance requests (detail SoT) — by run entity ids + recent open tickets
  tablesQueried.push("maintenance_requests")
  const { data: recentTickets, error: recentErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, created_at, priority, urgency, severity, resident_name, unit, description, vendor_work_status, issue_category, assigned_vendor_id, assigned_at, due_at, estimated_minutes, recognized_spend_amount, spend_status",
    )
    .eq("landlord_id", organizationId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(120)

  if (recentErr) {
    console.error("[ask_ulo/searchOperationalRecords] maintenance_requests", recentErr.message)
    return {
      available: false,
      workOrders: [],
      tablesQueried,
      filters,
      error: recentErr.message,
      log: {
        ...emptyLog(`maintenance_requests_error:${recentErr.message}`),
        tablesOrRpcs: tablesQueried,
      },
    }
  }

  type TicketRow = Record<string, unknown> & { id: string }
  const ticketById = new Map<string, TicketRow>()
  for (const row of (recentTickets ?? []) as TicketRow[]) {
    if (typeof row.id === "string") ticketById.set(row.id, row)
  }

  // Ensure tickets referenced by active runs are loaded even if outside recent window quirks
  const missingRunTicketIds = ticketIdsFromRuns.filter((id) => !ticketById.has(id))
  if (missingRunTicketIds.length > 0) {
    const { data: extraTickets, error: extraErr } = await supabase
      .from("maintenance_requests")
      .select(
        "id, landlord_id, created_at, priority, urgency, severity, resident_name, unit, description, vendor_work_status, issue_category, assigned_vendor_id, assigned_at, due_at, estimated_minutes, recognized_spend_amount, spend_status",
      )
      .in("id", missingRunTicketIds)
    if (extraErr) {
      console.error("[ask_ulo/searchOperationalRecords] maintenance_requests:extra", extraErr.message)
    } else {
      for (const row of (extraTickets ?? []) as TicketRow[]) {
        if (typeof row.id === "string") ticketById.set(row.id, row)
      }
    }
  }

  const allTicketIds = Array.from(ticketById.keys())

  // 3) Invoices (estimated cost priority #1)
  tablesQueried.push("maintenance_invoices")
  const invoiceByTicket = new Map<string, Record<string, unknown>>()
  if (allTicketIds.length > 0) {
    const { data: invoices, error: invErr } = await supabase
      .from("maintenance_invoices")
      .select(
        "maintenance_request_id, total_cost, labor_cost, material_cost, tax_amount, status, created_at",
      )
      .in("maintenance_request_id", allTicketIds)
      .order("created_at", { ascending: false })
    if (invErr) {
      console.error("[ask_ulo/searchOperationalRecords] maintenance_invoices", invErr.message)
    } else {
      for (const inv of invoices ?? []) {
        const tid =
          typeof inv.maintenance_request_id === "string" ? inv.maintenance_request_id : null
        if (tid && !invoiceByTicket.has(tid)) {
          invoiceByTicket.set(tid, inv as Record<string, unknown>)
        }
      }
    }
  }

  // 4) Vendors
  tablesQueried.push("vendors")
  const vendorIds = Array.from(
    new Set(
      Array.from(ticketById.values())
        .map((t) => (typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null))
        .filter(Boolean) as string[],
    ),
  )
  const vendorNameById = await loadVendorNameById(supabase, { vendorIds })

  // 5) Units for labels when metadata is thin
  tablesQueried.push("units")
  const unitIds = Array.from(
    new Set(
      maintenanceRuns
        .map((r) => (typeof r.unit_id === "string" ? r.unit_id : null))
        .filter(Boolean) as string[],
    ),
  )
  const unitById = new Map<string, { building: string | null; unit_label: string | null }>()
  if (unitIds.length > 0) {
    const { data: units } = await supabase
      .from("units")
      .select("id, building, unit_label")
      .in("id", unitIds)
    for (const u of units ?? []) {
      if (typeof u.id === "string") {
        unitById.set(u.id, {
          building: typeof u.building === "string" ? u.building : null,
          unit_label: typeof u.unit_label === "string" ? u.unit_label : null,
        })
      }
    }
  }

  const runByTicket = new Map<string, RunRow>()
  for (const run of maintenanceRuns) {
    const tid = String(run.entity_id)
    const existing = runByTicket.get(tid)
    if (!existing) {
      runByTicket.set(tid, run)
      continue
    }
    // Prefer escalated, then most recently started
    const preferEscalated =
      run.status === "escalated" && existing.status !== "escalated"
    const newer =
      new Date(String(run.started_at ?? 0)).getTime() >
      new Date(String(existing.started_at ?? 0)).getTime()
    if (preferEscalated || newer) runByTicket.set(tid, run)
  }

  let workOrders: OperationalWorkOrder[] = []

  for (const [ticketId, ticket] of ticketById) {
    const run = runByTicket.get(ticketId) ?? null
    const metadata = asRecord(run?.metadata)
    const unitRow = run?.unit_id ? unitById.get(run.unit_id) : null
    const parsed = parseBuildingAndUnit(
      typeof ticket.unit === "string" ? ticket.unit : null,
      {
        ...metadata,
        building: metadata.building ?? unitRow?.building ?? null,
        unit_label: metadata.unit_label ?? unitRow?.unit_label ?? null,
      },
    )

    if (!buildingMatch(parsed.propertyName, buildingFilter)) continue
    if (!unitMatch(parsed.unitLabel, unitLabelFilter)) continue
    if (input.propertyId && run?.property_id && run.property_id !== input.propertyId) continue
    if (input.unitId && run?.unit_id && run.unit_id !== input.unitId) continue

    const category =
      (typeof ticket.issue_category === "string" && ticket.issue_category) ||
      (typeof metadata.issue_category === "string" && metadata.issue_category) ||
      "general"
    const description =
      (typeof ticket.description === "string" && ticket.description.trim()) || ""
    const hay = `${category} ${description} ${parsed.propertyName} ${parsed.unitLabel ?? ""}`

    // Structural category match first (issue_category = hvac). Do not require "HVAC" in the title.
    const categoryNorm = category.toLowerCase()
    const structuredHit =
      structuredCategory != null &&
      (categoryNorm === structuredCategory ||
        categoryNorm.includes(structuredCategory) ||
        categoryNorm.replace(/_/g, " ").includes(structuredCategory.replace(/_/g, " ")))

    if (structuredCategory) {
      if (!structuredHit && !(searchTerms.length > 0 && textMatchesOpsTerms(hay, searchTerms))) {
        continue
      }
    } else if (searchTerms.length > 0 && !textMatchesOpsTerms(hay, searchTerms)) {
      continue
    }

    const vendorStatus =
      typeof ticket.vendor_work_status === "string" ? ticket.vendor_work_status : null
    if (input.status) {
      const want = input.status.toLowerCase()
      const wf = (run?.status ?? "").toLowerCase()
      if (want === "open") {
        // Include unfinished pipeline records even with null vendor / escalated / overdue.
        if (!OPEN_VENDOR_STATUSES.includes(vendorStatus ?? "") && wf !== "escalated") continue
      } else if (wf !== want && (vendorStatus ?? "") !== want) {
        continue
      }
    }

    const invoice = invoiceByTicket.get(ticketId) ?? null
    const cost = resolveOperationalEstimatedCost({ ticket, invoice, metadata })
    const dueAt =
      (typeof ticket.due_at === "string" && ticket.due_at) ||
      (typeof metadata.due_at === "string" && metadata.due_at) ||
      null
    const slaExpired =
      Boolean(metadata.sla_breached) ||
      (dueAt != null && !Number.isNaN(new Date(dueAt).getTime()) && new Date(dueAt).getTime() < now)
    const estimatedMinutes = asFiniteNumber(ticket.estimated_minutes)
    const vendorId =
      typeof ticket.assigned_vendor_id === "string" ? ticket.assigned_vendor_id : null
    const workflowStatus = run?.status ?? null
    const createdAt =
      (typeof ticket.created_at === "string" && ticket.created_at) ||
      (typeof run?.started_at === "string" && run.started_at) ||
      new Date(now).toISOString()

    workOrders.push({
      workOrderId: formatWorkOrderId(ticketId),
      maintenanceRequestId: ticketId,
      workflowRunId: run?.id ?? null,
      propertyName: parsed.propertyName,
      unitLabel: parsed.unitLabel,
      category,
      title: description.slice(0, 120) || category.replace(/_/g, " "),
      description: description || category.replace(/_/g, " "),
      priority:
        (typeof ticket.priority === "string" && ticket.priority) ||
        (typeof ticket.urgency === "string" && ticket.urgency) ||
        (typeof metadata.urgency === "string" && metadata.urgency) ||
        null,
      estimatedCost: cost.amount,
      estimatedCostSource: cost.source,
      repairScope: DEFAULT_REPAIR_SCOPE,
      laborEstimate: formatLaborEstimate(estimatedMinutes),
      workflowStage: workflowStageLabel({
        workflowStatus,
        currentStep: run?.current_step ?? null,
        vendorWorkStatus: vendorStatus,
      }),
      workflowStatus,
      vendorName: vendorId ? vendorNameById.get(vendorId) ?? null : null,
      vendorWorkStatus: vendorStatus,
      slaExpired,
      approvalStatus: workflowStatus === "escalated" ? "review_required" : "not_required",
      dueAt,
      expectedCompletion: dueAt,
      createdAt,
      daysOpen: daysSince(createdAt, now),
      estimatedMinutes,
    })
  }

  // Prefer structured category hits, then escalated / open, then newest.
  workOrders.sort((a, b) => {
    const aCat =
      structuredCategory != null &&
      a.category.toLowerCase().includes(structuredCategory)
        ? 0
        : 1
    const bCat =
      structuredCategory != null &&
      b.category.toLowerCase().includes(structuredCategory)
        ? 0
        : 1
    if (aCat !== bCat) return aCat - bCat
    const aOpen =
      a.workflowStatus === "escalated" ||
      OPEN_VENDOR_STATUSES.includes(a.vendorWorkStatus ?? "")
        ? 0
        : 1
    const bOpen =
      b.workflowStatus === "escalated" ||
      OPEN_VENDOR_STATUSES.includes(b.vendorWorkStatus ?? "")
        ? 0
        : 1
    if (a.workflowStatus === "escalated" && b.workflowStatus !== "escalated") return -1
    if (b.workflowStatus === "escalated" && a.workflowStatus !== "escalated") return 1
    if (aOpen !== bOpen) return aOpen - bOpen
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  workOrders = workOrders.slice(0, limit)

  const evidence = { workOrders }
  const evidencePayloadBytes = JSON.stringify(evidence).length
  const log: OperationalRetrievalLog = {
    intentHint: null,
    category: input.category ? String(input.category) : null,
    searchFilters: filters,
    tablesOrRpcs: tablesQueried,
    recordCount: workOrders.length,
    matchingWorkOrderIds: workOrders.map((w) => w.workOrderId),
    estimatedCostFound: workOrders.some((w) => w.estimatedCost != null),
    estimatedCosts: workOrders.map((w) => ({
      workOrderId: w.workOrderId,
      estimatedCost: w.estimatedCost,
      source: w.estimatedCostSource,
    })),
    evidencePayloadBytes,
    fallbackReason: workOrders.length === 0 ? "no_matching_records" : null,
  }

  console.log(
    "ASK_ULO_TABLES_QUERIED",
    JSON.stringify(tablesQueried),
  )
  console.log(
    "ASK_ULO_OPERATIONAL_FILTERS",
    JSON.stringify(filters),
  )
  console.log(
    "ASK_ULO_WORK_ORDER_COUNT",
    workOrders.length,
  )
  console.log(
    "ASK_ULO_WORK_ORDER_IDS",
    JSON.stringify(workOrders.map((w) => w.workOrderId)),
  )
  console.log(
    "ASK_ULO_HVAC_MATCHES",
    workOrders.filter((w) => /hvac|ac|cool|heat|compress/i.test(`${w.category} ${w.description}`))
      .length,
  )
  console.log(
    "[ask_ulo/searchOperationalRecords]",
    JSON.stringify({
      ...log,
      sample: workOrders[0]
        ? {
            workOrderId: workOrders[0].workOrderId,
            propertyName: workOrders[0].propertyName,
            unitLabel: workOrders[0].unitLabel,
            category: workOrders[0].category,
            estimatedCost: workOrders[0].estimatedCost,
          }
        : null,
    }),
  )

  return {
    available: true,
    workOrders,
    tablesQueried,
    filters,
    error: null,
    log,
  }
}

/**
 * Alias used by repair-cost / ops retrieval callers.
 * Same source of truth as the Workflow Pipeline detail drawer.
 */
export async function getOperationalWorkOrders(
  supabase: SupabaseClient,
  input: SearchOperationalRecordsInput,
): Promise<SearchOperationalRecordsResult> {
  return searchOperationalRecords(supabase, input)
}

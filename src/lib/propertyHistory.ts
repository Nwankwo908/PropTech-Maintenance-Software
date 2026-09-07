/**
 * Property History (Home Data Graph read model).
 *
 * Canonical sources: maintenance_requests, maintenance_invoices, vendors, units,
 * users, workflow_runs (rent_collection), operations_graph_events.
 * Does not query sms_conversations or sms_messages.
 */

import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  isMaintenanceInvoicePaidFromRow,
  isRentChargePaidFromRun,
} from '@/lib/paymentSettlement'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { resolvePropertyUnitOccupancyStatus } from '@/lib/propertyUnitRows'
import { supabase } from '@/lib/supabase'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'

export const PROPERTY_HISTORY_SOURCE_TABLES = [
  'maintenance_requests',
  'maintenance_request_enriched',
  'maintenance_invoices',
  'vendors',
  'units',
  'users',
  'workflow_runs',
  'operations_graph_events',
] as const

export type PropertyHistoryDomain =
  | 'maintenance'
  | 'rent'
  | 'vendor'
  | 'invoice'
  | 'media'
  | 'inspection'
  | 'move_in'
  | 'move_out'
  | 'lease'
  | 'other'

export type PropertyHistoryOccupancy = 'occupied' | 'vacant'

export type PropertyHistoryPaymentStatus = 'paid' | 'not_paid'

export type PropertyHistoryRow = {
  id: string
  activityId: string
  domain: PropertyHistoryDomain
  unitLabel: string
  unitId: string | null
  residentName: string
  contactType: 'vendor' | 'tenant'
  contactName: string
  occupancy: PropertyHistoryOccupancy
  occupancyLabel: 'OCCUPIED' | 'VACANT'
  paymentStatus: PropertyHistoryPaymentStatus
  paymentStatusLabel: 'PAID' | 'NOT PAID'
  event: string
  vendorInvoice: string
  amount: number
  timestampMs: number
  sequence: number
  dateLabel: string
  mediaCount: number
  mediaLabel: string
  mediaPaths: string[]
  propertyId: string | null
  sourceEntityType: string
  sourceEntityId: string
  workflowRunId: string | null
  vendorId: string | null
  vendorName: string | null
  invoiceId: string | null
  maintenanceRequestId: string | null
  rentBillingPeriod: string | null
  status: string | null
  actorSource: string
}

export type AssemblePropertyHistoryInput = {
  propertyId: string | null
  building: string
  unitFilter?: string | null
  units: Array<{
    id: string
    unitLabel: string
    building: string | null
    status: string
    propertyId: string | null
  }>
  residents: Array<{
    id: string
    fullName: string
    unit: string
    building: string | null
  }>
  tickets: Array<{
    id: string
    createdAt: string
    assignedAt: string | null
    completedAt: string | null
    unit: string
    unitId: string | null
    building: string | null
    issueCategory: string | null
    description: string | null
    vendorWorkStatus: string
    assignedVendorId: string | null
    photoPaths: string[]
    completionPhotoPaths: string[]
    spendStatus: string | null
  }>
  invoices: Array<{
    id: string
    maintenanceRequestId: string
    vendorId: string | null
    invoiceNumber: string | null
    totalCost: number
    status: string
    submittedAt: string
    approvedAt: string | null
    metadata?: Record<string, unknown> | null
  }>
  vendors: Array<{ id: string; name: string }>
  rentRuns: Array<{
    id: string
    propertyId: string | null
    unitId: string | null
    residentId: string | null
    status: string
    startedAt: string
    completedAt: string | null
    metadata: Record<string, unknown>
  }>
  graphEvents: Array<{
    id: string
    eventType: string
    createdAt: string
    unitId: string | null
    residentId: string | null
    vendorId: string | null
    propertyId: string | null
    maintenanceRequestId: string | null
    workflowRunId: string | null
    metadata: Record<string, unknown>
  }>
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function parseMs(value: string | null | undefined): number {
  if (!value?.trim()) return 0
  const dayOnly = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dayOnly) {
    const year = Number(dayOnly[1])
    const month = Number(dayOnly[2])
    const day = Number(dayOnly[3])
    return new Date(year, month - 1, day).getTime()
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

export function formatPropertyHistoryAmount(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatPropertyHistoryDate(timestampMs: number): string {
  if (!timestampMs) return '—'
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) return '—'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${month}/${day}/${year}`
}

function occupancyFromUnitStatus(status: string | null | undefined): PropertyHistoryOccupancy {
  return resolvePropertyUnitOccupancyStatus(status) === 'vacant' ? 'vacant' : 'occupied'
}

function occupancyLabel(occupancy: PropertyHistoryOccupancy): 'OCCUPIED' | 'VACANT' {
  return occupancy === 'vacant' ? 'VACANT' : 'OCCUPIED'
}

export function paymentStatusLabel(
  status: PropertyHistoryPaymentStatus,
): 'PAID' | 'NOT PAID' {
  return status === 'paid' ? 'PAID' : 'NOT PAID'
}

function mediaLabel(count: number): string {
  if (count <= 0) return 'No Media'
  if (count === 1) return '1 file'
  return `${count} files`
}

function firstSentence(text: string | null | undefined): string {
  const raw = (text ?? '').trim()
  if (!raw) return ''
  return raw.split(/[\n.!?]/)[0]?.trim() || raw
}

function isCompletedWorkStatus(status: string | null | undefined): boolean {
  return ['completed', 'resolved', 'closed'].includes((status ?? '').toLowerCase())
}

function rentPaymentStatusLabel(paid: boolean): string {
  return paid ? 'Paid' : 'Not paid'
}

const RENT_RECEIPT_METHOD_LABELS: Record<string, string> = {
  zelle: 'Zelle',
  venmo: 'Venmo',
  ach: 'ACH',
  bank: 'ACH',
  wire: 'ACH',
  check: 'Check',
  cheque: 'Check',
  cash: 'Cash',
  card: 'Card',
  stripe: 'Card',
  other: 'Other',
}

export function formatMaintenanceHistoryInvoiceLabel(
  invoice: { invoiceNumber?: string | null } | null,
): string {
  if (!invoice) return 'Pending'
  const number = invoice.invoiceNumber?.trim()
  return number || 'Invoice'
}

export function formatRentHistoryReceiptLabel(params: {
  paid: boolean
  paymentMethod?: string | null
  stripePaid?: boolean
}): string {
  if (!params.paid) return '—'
  const raw = (params.paymentMethod ?? '').trim()
  const method = raw ? RENT_RECEIPT_METHOD_LABELS[raw.toLowerCase()] || raw : ''
  if (method) return `Receipt · ${method}`
  if (params.stripePaid) return 'Receipt · Card'
  return 'Receipt'
}

function unitMatchesFilter(unitLabel: string, unitFilter: string | null | undefined): boolean {
  if (!unitFilter?.trim()) return true
  return normalizeUnitLabel(unitLabel) === normalizeUnitLabel(unitFilter)
}

function findUnitContext(
  input: AssemblePropertyHistoryInput,
  unitId: string | null,
  unitLabel: string,
): {
  unitId: string | null
  unitLabel: string
  occupancy: PropertyHistoryOccupancy
  residentName: string
} {
  const byId = unitId ? input.units.find((unit) => unit.id === unitId) : null
  const byLabel =
    byId ??
    input.units.find(
      (unit) => normalizeUnitLabel(unit.unitLabel) === normalizeUnitLabel(unitLabel),
    )
  const label = (byLabel?.unitLabel || unitLabel || '').trim() || '—'
  const occupancy = occupancyFromUnitStatus(byLabel?.status)
  const resident =
    input.residents.find((row) => {
      if (byLabel && normalizeUnitLabel(row.unit) === normalizeUnitLabel(byLabel.unitLabel)) {
        return true
      }
      return unitLabel ? normalizeUnitLabel(row.unit) === normalizeUnitLabel(unitLabel) : false
    }) ?? null
  return {
    unitId: byLabel?.id ?? unitId,
    unitLabel: label,
    occupancy,
    residentName: resident?.fullName || '—',
  }
}

function pushRow(
  rows: PropertyHistoryRow[],
  partial: Omit<
    PropertyHistoryRow,
    'dateLabel' | 'occupancyLabel' | 'paymentStatusLabel' | 'mediaLabel' | 'mediaCount'
  > & {
    mediaPaths?: string[]
    paymentTimestampMs?: number
  },
) {
  const { mediaPaths: incomingMedia = [], paymentTimestampMs = 0, ...rest } = partial
  const mediaPaths = incomingMedia
  const paidDateMs = rest.paymentStatus === 'paid' ? paymentTimestampMs : 0
  rows.push({
    ...rest,
    occupancyLabel: occupancyLabel(rest.occupancy),
    paymentStatusLabel: paymentStatusLabel(rest.paymentStatus),
    dateLabel: formatPropertyHistoryDate(paidDateMs),
    mediaPaths,
    mediaCount: mediaPaths.length,
    mediaLabel: mediaLabel(mediaPaths.length),
  })
}

export function assemblePropertyHistory(input: AssemblePropertyHistoryInput): PropertyHistoryRow[] {
  const rows: PropertyHistoryRow[] = []
  const buildingKey = normalizeBuildingKey(input.building)
  const scopedUnits = input.units.filter((unit) => {
    if (input.propertyId && unit.propertyId === input.propertyId) return true
    return normalizeBuildingKey(unit.building ?? '') === buildingKey
  })
  const scoped = { ...input, units: scopedUnits }
  const scopedUnitIds = new Set(scopedUnits.map((unit) => unit.id))
  const scopedUnitLabels = new Set(scopedUnits.map((unit) => normalizeUnitLabel(unit.unitLabel)))
  const vendorById = new Map(input.vendors.map((vendor) => [vendor.id, vendor.name]))
  const invoiceByTicket = new Map(input.invoices.map((invoice) => [invoice.maintenanceRequestId, invoice]))

  function ticketInScope(ticket: AssemblePropertyHistoryInput['tickets'][number]): boolean {
    if (ticket.unitId && scopedUnitIds.has(ticket.unitId)) return true
    if (normalizeBuildingKey(ticket.building ?? '') === buildingKey) return true
    return scopedUnitLabels.has(normalizeUnitLabel(ticket.unit))
  }

  for (const ticket of input.tickets) {
    const completed =
      isCompletedWorkStatus(ticket.vendorWorkStatus) || Boolean(ticket.completedAt)
    if (!completed) continue
    if (!ticketInScope(ticket)) continue
    const ctx = findUnitContext(scoped, ticket.unitId, ticket.unit)
    if (!unitMatchesFilter(ctx.unitLabel, input.unitFilter)) continue
    const activityId = `maintenance:${ticket.id}`
    const invoice = invoiceByTicket.get(ticket.id) ?? null
    const vendorId = ticket.assignedVendorId || invoice?.vendorId || null
    const vendorName = vendorId ? vendorById.get(vendorId) ?? 'Vendor' : null
    const invoicePaid = isMaintenanceInvoicePaidFromRow(
      invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            metadata: invoice.metadata ?? null,
          }
        : null,
    ).paid
    const paymentStatus: PropertyHistoryPaymentStatus = invoicePaid ? 'paid' : 'not_paid'
    const trade = formatVendorTradeLabel(ticket.issueCategory ?? '', { emptyLabel: '' })
    const issue = firstSentence(ticket.description) || (trade ? `${trade} issue` : 'Maintenance issue')
    const workOrder = formatWorkOrderRefFromTicketId(ticket.id)
    const completedMs = parseMs(ticket.completedAt) || parseMs(ticket.createdAt)
    const paymentMs = invoicePaid
      ? parseMs(invoice?.approvedAt) ||
        parseMs(asString(invoice?.metadata?.stripe_payment_completed_at))
      : 0

    pushRow(rows, {
      id: activityId,
      activityId,
      domain: 'maintenance',
      unitLabel: ctx.unitLabel,
      unitId: ctx.unitId,
      residentName: ctx.residentName,
      contactType: 'vendor',
      contactName: vendorName || '—',
      occupancy: ctx.occupancy,
      paymentStatus,
      event: `${issue} · ${workOrder}`,
      vendorInvoice: formatMaintenanceHistoryInvoiceLabel(invoice),
      amount: invoice?.totalCost ?? 0,
      timestampMs: paymentMs || completedMs,
      paymentTimestampMs: paymentMs,
      sequence: 0,
      propertyId: input.propertyId,
      sourceEntityType: 'maintenance_request',
      sourceEntityId: ticket.id,
      workflowRunId: null,
      vendorId,
      vendorName,
      invoiceId: invoice?.id ?? null,
      maintenanceRequestId: ticket.id,
      rentBillingPeriod: null,
      status: paymentStatus,
      actorSource: 'maintenance',
      mediaPaths: ticket.completionPhotoPaths.length
        ? ticket.completionPhotoPaths
        : ticket.photoPaths,
    })
  }

  for (const run of input.rentRuns) {
    const meta = run.metadata ?? {}
    const rentStatus = asString(meta.rent_status).toLowerCase()
    const completed = run.status === "completed" || rentStatus === "paid"
    if (!completed) continue

    const unitLabel = asString(meta.unit_label) || asString(meta.unit)
    const ctx = findUnitContext(scoped, run.unitId, unitLabel)
    const resident = input.residents.find((row) => row.id === run.residentId)
    const residentName = resident?.fullName || ctx.residentName
    if (run.unitId && !scopedUnitIds.has(run.unitId) && !scopedUnitLabels.has(normalizeUnitLabel(unitLabel))) {
      continue
    }
    if (
      !run.unitId &&
      unitLabel &&
      !scopedUnitLabels.has(normalizeUnitLabel(unitLabel)) &&
      !(resident && scopedUnitLabels.has(normalizeUnitLabel(resident.unit)))
    ) {
      continue
    }
    if (!unitMatchesFilter(ctx.unitLabel, input.unitFilter)) continue

    const amountDue = asNumber(meta.original_amount_due) || asNumber(meta.amount_due)
    const rentPaid =
      rentStatus === 'paid' ||
      isRentChargePaidFromRun({
        id: run.id,
        template_id: 'rent_collection',
        status: run.status,
        metadata: meta,
      }).paid
    const paymentMs =
      parseMs(asString(meta.paid_date)) ||
      parseMs(asString(meta.admin_payment_received_at)) ||
      parseMs(asString(meta.stripe_payment_completed_at)) ||
      (rentPaid ? parseMs(run.completedAt) : 0)
    const activityMs = paymentMs || parseMs(run.completedAt) || parseMs(run.startedAt)
    const billingPeriod = asString(meta.billing_period)
    const paymentStatus: PropertyHistoryPaymentStatus = rentPaid ? 'paid' : 'not_paid'
    const stepState =
      meta.step_state && typeof meta.step_state === 'object' && !Array.isArray(meta.step_state)
        ? (meta.step_state as Record<string, unknown>)
        : {}
    const stripePaid = Boolean(
      asString(meta.stripe_payment_completed_at) ||
        asString(meta.stripe_checkout_session_id) ||
        asString(stepState.stripe_checkout_session_id),
    )

    pushRow(rows, {
      id: `rent:${run.id}`,
      activityId: `rent:${run.id}`,
      domain: "rent",
      unitLabel: ctx.unitLabel,
      unitId: ctx.unitId,
      residentName,
      contactType: 'tenant',
      contactName: residentName && residentName !== '—' ? residentName : '—',
      occupancy: ctx.occupancy,
      paymentStatus,
      event: `Rent · ${rentPaymentStatusLabel(rentPaid)}`,
      vendorInvoice: formatRentHistoryReceiptLabel({
        paid: rentPaid,
        paymentMethod: asString(meta.payment_method) || asString(stepState.payment_method) || null,
        stripePaid,
      }),
      amount: amountDue,
      timestampMs: activityMs,
      paymentTimestampMs: rentPaid ? paymentMs : 0,
      sequence: 0,
      propertyId: run.propertyId ?? input.propertyId,
      sourceEntityType: "workflow_run",
      sourceEntityId: run.id,
      workflowRunId: run.id,
      vendorId: null,
      vendorName: null,
      invoiceId: null,
      maintenanceRequestId: null,
      rentBillingPeriod: billingPeriod || null,
      status: paymentStatus,
      actorSource: "rent",
    })
  }

  return rows.sort((a, b) => {
    if (b.timestampMs !== a.timestampMs) return b.timestampMs - a.timestampMs
    if (a.activityId !== b.activityId) return a.activityId.localeCompare(b.activityId)
    return a.sequence - b.sequence
  })
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => asString(entry)).filter(Boolean)
}

export async function fetchPropertyHistory(params: {
  building: string
  propertyId: string | null
  unitIds: string[]
  unitFilter?: string | null
}): Promise<{ rows: PropertyHistoryRow[]; error: string | null }> {
  if (!supabase) {
    return { rows: [], error: 'Supabase is not configured.' }
  }

  const landlordId = getActiveLandlordId()
  const buildingKey = normalizeBuildingKey(params.building)
  const unitIds = params.unitIds.filter(Boolean)

  const [unitsResult, residentsResult, enrichedTickets, mrTickets, vendorsResult] = await Promise.all([
    supabase
      .from('units')
      .select('id, unit_label, building, status, property_id')
      .eq('landlord_id', landlordId)
      .limit(500),
    supabase
      .from('users')
      .select('id, full_name, unit, building')
      .eq('landlord_id', landlordId)
      .limit(2000),
    supabase
      .from('maintenance_request_enriched')
      .select(
        'id, created_at, unit, unit_id, building, issue_category, description, vendor_work_status, assigned_vendor_id',
      )
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(400),
    supabase
      .from('maintenance_requests')
      .select(
        'id, created_at, assigned_at, completed_at, photo_paths, completion_photo_paths, spend_status, vendor_work_status, assigned_vendor_id, issue_category, description, unit',
      )
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(400),
    supabase.from('vendors').select('id, name').eq('landlord_id', landlordId).limit(500),
  ])

  if (unitsResult.error) {
    return { rows: [], error: unitsResult.error.message }
  }
  if (enrichedTickets.error && mrTickets.error) {
    return { rows: [], error: enrichedTickets.error.message }
  }

  const units = ((unitsResult.data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: asString(row.id),
      unitLabel: asString(row.unit_label),
      building: asString(row.building) || null,
      status: asString(row.status),
      propertyId: asString(row.property_id) || null,
    }))
    .filter((unit) => {
      if (params.propertyId && unit.propertyId === params.propertyId) return true
      if (unitIds.includes(unit.id)) return true
      return normalizeBuildingKey(unit.building ?? '') === buildingKey
    })

  const scopedUnitIds = new Set(units.map((unit) => unit.id))
  const scopedUnitLabels = new Set(units.map((unit) => normalizeUnitLabel(unit.unitLabel)))

  const residents = ((residentsResult.data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: asString(row.id),
      fullName: asString(row.full_name) || 'Unnamed resident',
      unit: asString(row.unit),
      building: asString(row.building) || null,
    }))
    .filter((resident) => {
      if (normalizeBuildingKey(resident.building ?? '') === buildingKey) return true
      return scopedUnitLabels.has(normalizeUnitLabel(resident.unit))
    })

  const extraById = new Map<string, Record<string, unknown>>()
  for (const row of (mrTickets.data ?? []) as Record<string, unknown>[]) {
    const id = asString(row.id)
    if (id) extraById.set(id, row)
  }
  const ticketSource =
    !enrichedTickets.error && (enrichedTickets.data?.length ?? 0) > 0
      ? ((enrichedTickets.data ?? []) as Record<string, unknown>[])
      : ((mrTickets.data ?? []) as Record<string, unknown>[])

  const tickets = ticketSource
    .map((row) => {
      const extra = extraById.get(asString(row.id)) ?? {}
      const merged = { ...row, ...extra }
      return {
        id: asString(merged.id),
        createdAt: asString(merged.created_at),
        assignedAt: asString(merged.assigned_at) || null,
        completedAt: asString(merged.completed_at) || null,
        unit: asString(merged.unit),
        unitId: asString(merged.unit_id) || null,
        building: asString(merged.building) || null,
        issueCategory: asString(merged.issue_category) || null,
        description: asString(merged.description) || null,
        vendorWorkStatus: asString(merged.vendor_work_status),
        assignedVendorId: asString(merged.assigned_vendor_id) || null,
        photoPaths: stringList(merged.photo_paths),
        completionPhotoPaths: stringList(merged.completion_photo_paths),
        spendStatus: asString(merged.spend_status) || null,
      }
    })
    .filter((ticket) => {
      if (ticket.unitId && scopedUnitIds.has(ticket.unitId)) return true
      if (normalizeBuildingKey(ticket.building ?? '') === buildingKey) return true
      return scopedUnitLabels.has(normalizeUnitLabel(ticket.unit))
    })

  const ticketIds = tickets.map((ticket) => ticket.id)
  const residentIds = residents.map((resident) => resident.id)

  const [invoicesResult, rentRunsResult, graphResult] = await Promise.all([
    ticketIds.length
      ? supabase
          .from('maintenance_invoices')
          .select(
            'id, maintenance_request_id, vendor_id, invoice_number, total_cost, status, submitted_at, approved_at, metadata',
          )
          .eq('landlord_id', landlordId)
          .in('maintenance_request_id', ticketIds)
      : Promise.resolve({ data: [], error: null }),
    residentIds.length || scopedUnitIds.size
      ? supabase
          .from('workflow_runs')
          .select('id, property_id, unit_id, resident_id, status, started_at, completed_at, metadata')
          .eq('landlord_id', landlordId)
          .eq('template_id', 'rent_collection')
          .order('started_at', { ascending: false })
          .limit(400)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('operations_graph_events')
      .select(
        'id, event_type, created_at, unit_id, resident_id, vendor_id, property_id, maintenance_request_id, workflow_run_id, metadata',
      )
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(400),
  ])

  if (invoicesResult.error) {
    return { rows: [], error: invoicesResult.error.message }
  }
  if (rentRunsResult.error) {
    return { rows: [], error: rentRunsResult.error.message }
  }

  const invoices = ((invoicesResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: asString(row.id),
    maintenanceRequestId: asString(row.maintenance_request_id),
    vendorId: asString(row.vendor_id) || null,
    invoiceNumber: asString(row.invoice_number) || null,
    totalCost: asNumber(row.total_cost),
    status: asString(row.status),
    submittedAt: asString(row.submitted_at),
    approvedAt: asString(row.approved_at) || null,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  }))

  const rentRuns = ((rentRunsResult.data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: asString(row.id),
      propertyId: asString(row.property_id) || null,
      unitId: asString(row.unit_id) || null,
      residentId: asString(row.resident_id) || null,
      status: asString(row.status),
      startedAt: asString(row.started_at),
      completedAt: asString(row.completed_at) || null,
      metadata:
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
    }))
    .filter((run) => {
      if (params.propertyId && run.propertyId === params.propertyId) return true
      if (run.unitId && scopedUnitIds.has(run.unitId)) return true
      if (run.residentId && residentIds.includes(run.residentId)) return true
      return false
    })

  const graphEvents = ((graphResult.data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: asString(row.id),
      eventType: asString(row.event_type),
      createdAt: asString(row.created_at),
      unitId: asString(row.unit_id) || null,
      residentId: asString(row.resident_id) || null,
      vendorId: asString(row.vendor_id) || null,
      propertyId: asString(row.property_id) || null,
      maintenanceRequestId: asString(row.maintenance_request_id) || null,
      workflowRunId: asString(row.workflow_run_id) || null,
      metadata:
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
    }))
    .filter((event) => {
      if (params.propertyId && event.propertyId === params.propertyId) return true
      if (event.unitId && scopedUnitIds.has(event.unitId)) return true
      if (event.residentId && residentIds.includes(event.residentId)) return true
      if (event.maintenanceRequestId && ticketIds.includes(event.maintenanceRequestId)) return true
      return false
    })

  const vendors = ((vendorsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: asString(row.id),
    name: asString(row.name) || 'Vendor',
  }))

  return {
    rows: assemblePropertyHistory({
      propertyId: params.propertyId,
      building: params.building,
      unitFilter: params.unitFilter,
      units,
      residents,
      tickets,
      invoices,
      vendors,
      rentRuns,
      graphEvents,
    }),
    error: graphResult.error?.message ?? null,
  }
}

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  postAdminReassignVendor,
  resolveAdminReassignUrl,
} from '@/api/adminReassignVendor'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLandlordFacingMaintenanceRequest } from '@/lib/landlordWorkOrders'
import { adminNavPath } from '@/lib/adminNavigation'
import { fetchLandlordAccountProfile } from '@/lib/landlordAccountProfile'
import { supabase } from '@/lib/supabase'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { formatVendorLocationLabel } from '@/lib/vendorLocation'
import {
  VENDOR_SOURCE_SETTINGS_HINT,
  vendorBlockedFromAutoAssignBySettings,
  vendorSourceLabel,
} from '@/lib/vendorSource'
import { parseVendorId } from '@/lib/vendorRoutes'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'
import {
  canRetryVendorOnboarding,
  canShowStartVendorOnboarding,
  vendorCapacityChipVisualClasses,
  type VendorCapacityChipStatus,
} from '@/lib/vendorStatusChip'
import {
  buildVendorComplianceProfile,
  type VendorComplianceItem,
  type VendorComplianceProfile,
} from '@/lib/vendorComplianceProfile'
import {
  computeVendorProfileVerificationChecklist,
  type VerificationChecklist,
  type VerificationChecklistItem,
  type VerificationItemStatus,
  type VerificationRecord,
} from '@/lib/vendorVerificationChecklist'
import {
  buildVendorProfileAttention,
  type VendorAttentionEstimate,
  type VendorAttentionNoShow,
  type VendorAttentionReopen,
  type VendorAttentionTicket,
} from '@/lib/vendorProfileAttention'
import { ADMIN_ATTENTION_ACTION_CLASS } from '@/lib/adminRightRail'
import { getErrorMessage } from '@/lib/errorMessage'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { fetchVendorScoresForLandlord } from '@/lib/vendorScores'
import {
  dispatchUnassignedJobsAfterVendorOverride,
  notifyVendorOnboardingOverrideActivated,
  sendVendorInvite,
  type VendorInviteChannel,
} from '@/api/vendorVerification'
import { OverrideOnboardingModal } from '@/components/OverrideOnboardingModal'
import { SetupOutreachAckModal } from '@/components/SetupOutreachAckModal'
import { inviteChannelFromContact } from '@/lib/inviteMessagePreview'
import { SendInviteInfoTip } from '@/components/onboarding/OnboardingSendSwitch'
import {
  VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_VERSION,
  vendorOnboardingOverrideDisclaimerText,
} from '@/lib/vendorOnboardingOverrideAck'
import {
  VendorFormModal,
  type VendorManagementRow,
  type VendorNotificationChannel,
} from '@/components/VendorFormModal'

type VendorRecord = {
  id: string
  name: string
  category: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  country: string | null
  active: boolean
  preferredEmergency: boolean
  rosterStatus: string | null
  performanceReview: string | null
  rosterStatusReason: string | null
  notificationChannel: VendorNotificationChannel
  portalApiKey: string | null
  createdAt: string | null
  onboardingOverriddenAt: string | null
  onboardedFromExternal: boolean
}

function performanceReviewLabel(value: string | null): string | null {
  switch ((value ?? '').trim()) {
    case 'coaching':
      return 'Performance coaching'
    case 'profile_review':
      return 'Profile review'
    case 'suspension_review':
      return 'Suspension review'
    default:
      return null
  }
}

type VendorMetrics = {
  rating: number | null
  reviewCount: number
  completedJobs: number
  avgResponseMinutes: number | null
  residentSatisfaction: number | null
  completionRate: number | null
}

function formatVendorSinceYear(createdAt: string | null): number | null {
  if (!createdAt) return null
  const year = new Date(createdAt).getFullYear()
  return Number.isFinite(year) ? year : null
}

function formatVendorSourceSinceLabel(
  onboardedFromExternal: boolean,
  createdAt: string | null,
): string {
  const source = vendorSourceLabel(onboardedFromExternal)
  const year = formatVendorSinceYear(createdAt)
  if (year != null) return `${source} vendor since ${year}`
  return `${source} vendor`
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const CONTACT_CHIP_CLASS =
  'inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[13px] font-medium leading-5 text-[#364153]'

function PhoneIcon() {
  return (
    <svg
      className="size-3.5 shrink-0 text-[#6a7282]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg
      className="size-3.5 shrink-0 text-[#6a7282]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M4 6h16v12H4V6z" strokeLinejoin="round" />
      <path d="M4 6l8 6 8-6" strokeLinejoin="round" />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg
      className="size-3.5 shrink-0 text-[#6a7282]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function formatResponse(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`
  return `${Math.round(hours / 24)} d`
}

function VendorKpiCard({
  label,
  value,
  title,
}: {
  label: string
  value: ReactNode
  title?: string
}) {
  return (
    <div
      className="sa-enter-scale flex min-w-0 items-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:gap-3 sm:px-5 sm:py-4"
      title={title}
    >
      <p className="min-w-0 truncate whitespace-nowrap text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {label}
      </p>
      <div className="ml-auto flex min-w-0 max-w-[70%] shrink-0 justify-end">
        {typeof value === 'string' || typeof value === 'number' ? (
          <p className="truncate text-right text-[22px] font-medium leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums sm:text-[28px]">
            {value}
          </p>
        ) : (
          value
        )}
      </div>
    </div>
  )
}

function formatJobDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatJobCost(amount: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount)
}

function invoiceTotalFromRow(raw: Record<string, unknown>): number | null {
  const recognized = asFiniteNumber(raw.recognized_spend_amount)
  if (recognized != null) return recognized
  const total = asFiniteNumber(raw.total_cost ?? raw.invoice_total ?? raw.amount)
  if (total != null) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor == null && material == null && tax == null) return null
  return (labor ?? 0) + (material ?? 0) + (tax ?? 0)
}

function jobIssueTitle(description: string, category: string | null): string {
  const firstLine = description.split('\n')[0]?.trim() ?? ''
  if (firstLine) return firstLine
  return formatVendorTradeLabel(category) || 'Work order'
}

function jobLocationLabel(unit: string, building: string | null): string {
  const parts = [asString(building), asString(unit)].filter(Boolean)
  return parts.join(' · ') || '—'
}

async function loadTicketsByIds(ids: string[]): Promise<Record<string, unknown>[]> {
  if (!supabase || ids.length === 0) return []
  const rows: Record<string, unknown>[] = []
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const { data, error } = await supabase
      .from('maintenance_requests')
      .select('*')
      .in('id', chunk)
      .limit(50)
    if (error) {
      console.warn('[AdminVendorDetailDashboard] tickets by id', error.message)
      continue
    }
    rows.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return rows
}

async function loadVendorJobHistory(input: {
  landlordId: string
  vendorId: string
}): Promise<{ rows: VendorJobRow[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }

  const ticketsById = new Map<string, Record<string, unknown>>()
  const addTickets = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      if (!isLandlordFacingMaintenanceRequest(row)) continue
      const id = asString(row.id)
      if (id) ticketsById.set(id, row)
    }
  }

  const assigned = await supabase
    .from('maintenance_requests')
    .select('*')
    .eq('landlord_id', input.landlordId)
    .eq('assigned_vendor_id', input.vendorId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (assigned.error) {
    console.warn('[AdminVendorDetailDashboard] assigned tickets', assigned.error.message)
    const unscoped = await supabase
      .from('maintenance_requests')
      .select('*')
      .eq('assigned_vendor_id', input.vendorId)
      .limit(200)
    if (unscoped.error) {
      console.warn('[AdminVendorDetailDashboard] unscoped tickets', unscoped.error.message)
    } else {
      addTickets((unscoped.data ?? []) as Record<string, unknown>[])
    }
  } else {
    addTickets((assigned.data ?? []) as Record<string, unknown>[])
  }

  const jobEvents: { ticketId: string; toStatus: string }[] = []
  const events = await supabase
    .from('vendor_status_events')
    .select('ticket_id, to_status')
    .eq('vendor_id', input.vendorId)
    .limit(500)

  if (events.error) {
    console.warn('[AdminVendorDetailDashboard] vendor job events', events.error.message)
  } else {
    for (const raw of (events.data ?? []) as Record<string, unknown>[]) {
      const ticketId = asString(raw.ticket_id)
      const toStatus = asString(raw.to_status)
      if (!ticketId || !toStatus) continue
      jobEvents.push({ ticketId, toStatus })
    }
  }

  const extraIds = [...new Set(jobEvents.map((event) => event.ticketId))].filter(
    (id) => !ticketsById.has(id),
  )
  addTickets(await loadTicketsByIds(extraIds))

  const ticketIds = [...ticketsById.keys()]
  if (ticketIds.length > 0) {
    const invoices = await supabase
      .from('maintenance_invoices')
      .select('maintenance_request_id, total_cost, labor_cost, material_cost, tax_amount')
      .eq('landlord_id', input.landlordId)
      .in('maintenance_request_id', ticketIds.slice(0, 200))
    if (invoices.error) {
      console.warn('[AdminVendorDetailDashboard] job invoices', invoices.error.message)
    } else {
      for (const raw of (invoices.data ?? []) as Record<string, unknown>[]) {
        const ticketId = asString(raw.maintenance_request_id)
        const ticket = ticketId ? ticketsById.get(ticketId) : undefined
        if (!ticket) continue
        const total = asFiniteNumber(raw.total_cost)
        if (total != null) ticket.invoice_total = total
        else {
          ticket.labor_cost = raw.labor_cost
          ticket.material_cost = raw.material_cost
          ticket.tax_amount = raw.tax_amount
        }
      }
    }
  }

  const rows = [...ticketsById.values()]
    .map((row) => mapVendorJobRow(row, input.vendorId, jobEvents))
    .sort((left, right) => {
      const leftAt = left.completedAt || left.createdAt || ''
      const rightAt = right.completedAt || right.createdAt || ''
      return rightAt.localeCompare(leftAt)
    })

  return { rows, error: null }
}

async function loadVendorAttentionInputs(input: {
  landlordId: string
  vendorId: string
}): Promise<{
  tickets: VendorAttentionTicket[]
  estimates: VendorAttentionEstimate[]
  noShows: VendorAttentionNoShow[]
  reopens: VendorAttentionReopen[]
}> {
  const empty = {
    tickets: [] as VendorAttentionTicket[],
    estimates: [] as VendorAttentionEstimate[],
    noShows: [] as VendorAttentionNoShow[],
    reopens: [] as VendorAttentionReopen[],
  }
  if (!supabase) return empty

  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const ticketsResult = await supabase
    .from('maintenance_requests')
    .select(
      'id, vendor_work_status, auto_reassign_last_outcome, scheduled_at, stall_follow_up_sent_at, stall_follow_up_kind',
    )
    .eq('landlord_id', input.landlordId)
    .eq('assigned_vendor_id', input.vendorId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (ticketsResult.error) {
    console.warn('[AdminVendorDetailDashboard] attention tickets', ticketsResult.error.message)
  }

  const tickets: VendorAttentionTicket[] = ((ticketsResult.data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const id = asString(row.id)
      if (!id) return null
      return {
        id,
        vendorWorkStatus: asString(row.vendor_work_status) || null,
        autoReassignLastOutcome: asString(row.auto_reassign_last_outcome) || null,
        scheduledAt: asString(row.scheduled_at) || null,
        stallFollowUpSentAt: asString(row.stall_follow_up_sent_at) || null,
        stallFollowUpKind: asString(row.stall_follow_up_kind) || null,
      }
    })
    .filter((row): row is VendorAttentionTicket => row != null)

  const ticketIds = tickets.map((row) => row.id)
  let estimates: VendorAttentionEstimate[] = []
  if (ticketIds.length > 0) {
    const estimatesResult = await supabase
      .from('maintenance_estimates')
      .select('id, maintenance_request_id, status, total_cost')
      .eq('landlord_id', input.landlordId)
      .in('maintenance_request_id', ticketIds.slice(0, 100))
      .eq('status', 'pending_approval')
      .limit(100)
    if (estimatesResult.error) {
      console.warn('[AdminVendorDetailDashboard] attention estimates', estimatesResult.error.message)
    } else {
      estimates = ((estimatesResult.data ?? []) as Record<string, unknown>[])
        .map((row) => {
          const id = asString(row.id)
          const maintenanceRequestId = asString(row.maintenance_request_id)
          if (!id || !maintenanceRequestId) return null
          return {
            id,
            maintenanceRequestId,
            status: asString(row.status) || null,
            totalAmount: asFiniteNumber(row.total_cost),
          }
        })
        .filter((row): row is VendorAttentionEstimate => row != null)
    }
  }

  const noShowsResult = await supabase
    .from('vendor_job_no_shows')
    .select('id, maintenance_request_id, recorded_at')
    .eq('landlord_id', input.landlordId)
    .eq('vendor_id', input.vendorId)
    .gte('recorded_at', sinceIso)
    .order('recorded_at', { ascending: false })
    .limit(50)
  if (noShowsResult.error) {
    console.warn('[AdminVendorDetailDashboard] attention no-shows', noShowsResult.error.message)
  }
  const noShows: VendorAttentionNoShow[] = ((noShowsResult.data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const id = asString(row.id)
      const maintenanceRequestId = asString(row.maintenance_request_id)
      const recordedAt = asString(row.recorded_at)
      if (!id || !maintenanceRequestId || !recordedAt) return null
      return { id, maintenanceRequestId, recordedAt }
    })
    .filter((row): row is VendorAttentionNoShow => row != null)

  const reopensResult = await supabase
    .from('maintenance_work_order_reopens')
    .select('id, maintenance_request_id, reopened_at, previous_status, new_status')
    .eq('landlord_id', input.landlordId)
    .eq('vendor_id', input.vendorId)
    .eq('previous_status', 'completed')
    .gte('reopened_at', sinceIso)
    .order('reopened_at', { ascending: false })
    .limit(50)
  if (reopensResult.error) {
    console.warn('[AdminVendorDetailDashboard] attention reopens', reopensResult.error.message)
  }
  const reopens: VendorAttentionReopen[] = ((reopensResult.data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const id = asString(row.id)
      const maintenanceRequestId = asString(row.maintenance_request_id)
      const reopenedAt = asString(row.reopened_at)
      const previousStatus = asString(row.previous_status)
      const newStatus = asString(row.new_status)
      if (!id || !maintenanceRequestId || !reopenedAt || !previousStatus || !newStatus) return null
      return { id, maintenanceRequestId, reopenedAt, previousStatus, newStatus }
    })
    .filter((row): row is VendorAttentionReopen => row != null)

  return { tickets, estimates, noShows, reopens }
}

async function loadVendorThreadId(input: {
  landlordId: string
  vendorId: string
}): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('sms_conversations')
    .select('id, conversation_type, updated_at')
    .eq('landlord_id', input.landlordId)
    .eq('vendor_id', input.vendorId)
    .order('updated_at', { ascending: false })
    .limit(10)
  if (error) {
    console.warn('[AdminVendorDetailDashboard] vendor thread', error.message)
    return null
  }
  const rows = (data ?? []) as Array<{ id?: unknown; conversation_type?: unknown }>
  const preferred =
    rows.find((row) => asString(row.conversation_type).toLowerCase() === 'vendor_alert') ??
    rows[0]
  const id = asString(preferred?.id)
  return id || null
}

type AssignableJobOption = {
  id: string
  title: string
  detail: string
}

async function loadAssignableJobs(landlordId: string): Promise<AssignableJobOption[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(
      'id, description, issue_category, unit, building, vendor_work_status, assigned_vendor_id, created_at',
    )
    .eq('landlord_id', landlordId)
    .is('assigned_vendor_id', null)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) {
    console.warn('[AdminVendorDetailDashboard] assignable jobs', error.message)
    return []
  }
  return ((data ?? []) as Record<string, unknown>[])
    .filter((row) => isLandlordFacingMaintenanceRequest(row))
    .filter((row) => {
      const status = asString(row.vendor_work_status).toLowerCase()
      return status !== 'completed' && status !== 'cancelled'
    })
    .map((row) => {
      const id = asString(row.id)
      const place = [asString(row.building), asString(row.unit)].filter(Boolean).join(' · ')
      return {
        id,
        title: jobIssueTitle(
          asString(row.description),
          asString(row.issue_category) || null,
        ),
        detail: [formatWorkOrderRefFromTicketId(id), place].filter(Boolean).join(' · '),
      }
    })
    .filter((row) => Boolean(row.id))
}

function vendorOutcomeForTicket(
  ticketId: string,
  assignedVendorId: string | null,
  vendorId: string,
  ticketStatus: string | null,
  events: { ticketId: string; toStatus: string }[],
): string | null {
  if (assignedVendorId === vendorId) return ticketStatus
  const forTicket = events.filter((event) => event.ticketId === ticketId)
  if (forTicket.some((event) => event.toStatus === 'declined')) return 'declined'
  if (forTicket.some((event) => event.toStatus === 'completed')) return 'completed'
  return forTicket[0]?.toStatus ?? ticketStatus
}

function mapVendorJobRow(
  row: Record<string, unknown>,
  vendorId: string,
  events: { ticketId: string; toStatus: string }[],
): VendorJobRow {
  const id = asString(row.id)
  const createdAt = asString(row.created_at)
  const assignedAt = asString(row.assigned_at) || createdAt
  const completedAt =
    asString(row.completed_at) ||
    asString(row.resolved_at) ||
    asString(row.closed_at) ||
    null
  const status = vendorOutcomeForTicket(
    id,
    asString(row.assigned_vendor_id) || null,
    vendorId,
    asString(row.vendor_work_status) || null,
    events,
  )
  const startMs = assignedAt ? new Date(assignedAt).getTime() : NaN
  const endMs = completedAt ? new Date(completedAt).getTime() : NaN
  const durationMinutes =
    status === 'completed' &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs >= startMs
      ? Math.round((endMs - startMs) / 60000)
      : null
  return {
    id,
    workOrderRef: formatWorkOrderRefFromTicketId(id),
    issue: jobIssueTitle(asString(row.description), asString(row.issue_category) || null),
    location: jobLocationLabel(asString(row.unit), asString(row.building) || null),
    status,
    createdAt: createdAt || null,
    completedAt: status === 'completed' ? completedAt : null,
    durationMinutes,
    cost: invoiceTotalFromRow(row),
  }
}

function vendorJobStatusLabel(status: string | null): string {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'pending_accept':
      return 'Waiting to accept'
    case 'accepted':
      return 'Accepted'
    case 'in_progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'declined':
      return 'Declined'
    case 'cancelled':
      return 'Cancelled'
    case 'unassigned':
      return 'Unassigned'
    default:
      return status?.replace(/_/g, ' ') || '—'
  }
}

type VendorJobRow = {
  id: string
  workOrderRef: string
  issue: string
  location: string
  status: string | null
  createdAt: string | null
  completedAt: string | null
  durationMinutes: number | null
  cost: number | null
}

const STAR_PATH =
  'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z'

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="flex h-6 shrink-0 items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.min(1, Math.max(0, rating - i))
        return (
          <span key={i} className="relative block size-5 shrink-0">
            <svg className="absolute inset-0 block size-full text-[#e5e7eb]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d={STAR_PATH} />
            </svg>
            {fill > 0 ? (
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <svg className="block size-5 text-[#f0b100]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d={STAR_PATH} />
                </svg>
              </span>
            ) : null}
          </span>
        )
      })}
    </span>
  )
}

function ComplianceCard({ item }: { item: VendorComplianceItem }) {
  return (
    <div className="sa-enter-scale sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">
          {item.label}
          {item.optional ? (
            <span className="ml-1.5 font-medium normal-case tracking-normal">Optional</span>
          ) : null}
        </p>
        <span
          className={[
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
            item.collected
              ? 'bg-[#dbfce7] text-[#008236]'
              : item.optional
                ? 'bg-[#f3f4f6] text-[#6a7282]'
                : 'bg-[#f3f4f6] text-[#6a7282]',
          ].join(' ')}
        >
          {item.collected ? 'On file' : item.optional ? 'Optional' : 'Not collected'}
        </span>
      </div>
      {item.collected ? (
        <div className="mt-3 flex items-start gap-2">
          <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-[#00a63e]" aria-hidden />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{item.headline}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-[#364153]">{item.detail}</p>
            {item.meta ? (
              <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{item.meta}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2">
          <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full border border-[#d1d5dc]" aria-hidden />
          <p className="text-[13px] leading-5 text-[#6a7282]">{item.emptyHint}</p>
        </div>
      )}
    </div>
  )
}

function checklistStatusStyle(status: VerificationItemStatus): { dot: string; pill: string; label: string } {
  switch (status) {
    case 'complete':
      return { dot: 'bg-[#00a63e]', pill: 'bg-[#dbfce7] text-[#008236]', label: 'Verified' }
    case 'action_needed':
      return { dot: 'bg-[#dc2626]', pill: 'bg-[#fee2e2] text-[#b91c1c]', label: 'Action needed' }
    case 'pending':
      return { dot: 'bg-[#d97706]', pill: 'bg-[#fef9c3] text-[#92400e]', label: 'Pending' }
    default:
      return { dot: 'bg-[#d1d5dc]', pill: 'bg-[#f3f4f6] text-[#6a7282]', label: 'Not collected' }
  }
}

function ChecklistRow({ item }: { item: VerificationChecklistItem }) {
  const style = checklistStatusStyle(item.status)
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <div className="min-w-0">
        <p className="text-[14px] font-medium text-[#0a0a0a]">
          {item.label}
          {!item.required ? (
            <span className="ml-1.5 text-[12px] font-medium text-[#6a7282]">Optional</span>
          ) : null}
        </p>
          <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{item.detail}</p>
        </div>
      </div>
      <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${style.pill}`}>
        {style.label}
      </span>
    </li>
  )
}

export function AdminVendorDetailDashboard() {
  const { vendorId: vendorSlug } = useParams<{ vendorId: string }>()
  const vendorId = parseVendorId(vendorSlug)
  const navigate = useNavigate()

  const [vendor, setVendor] = useState<VendorRecord | null>(null)
  const [metrics, setMetrics] = useState<VendorMetrics | null>(null)
  const [verification, setVerification] = useState<VerificationRecord | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const [inviteNoticeError, setInviteNoticeError] = useState(false)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  const [setupOutreachAckOpen, setSetupOutreachAckOpen] = useState(false)
  const [overrideActivationSmsSent, setOverrideActivationSmsSent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completedJobs, setCompletedJobs] = useState<VendorJobRow[]>([])
  const [attentionTickets, setAttentionTickets] = useState<VendorAttentionTicket[]>([])
  const [attentionEstimates, setAttentionEstimates] = useState<VendorAttentionEstimate[]>([])
  const [attentionNoShows, setAttentionNoShows] = useState<VendorAttentionNoShow[]>([])
  const [attentionReopens, setAttentionReopens] = useState<VendorAttentionReopen[]>([])
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [marketplacePreference, setMarketplacePreference] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [assignJobOpen, setAssignJobOpen] = useState(false)
  const [assignableJobs, setAssignableJobs] = useState<AssignableJobOption[]>([])
  const [assignJobsLoading, setAssignJobsLoading] = useState(false)
  const [assignJobsError, setAssignJobsError] = useState<string | null>(null)
  const [assignSavingTicketId, setAssignSavingTicketId] = useState<string | null>(null)

  const loadVendor = useCallback(async () => {
    if (!supabase || !vendorId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const landlordId = getActiveLandlordId()
    const [vendorResult, scores, verificationResult, overrideSmsResult, accountProfile] =
      await Promise.allSettled([
      supabase
        .from('vendors')
        .select(
          'id, name, category, active, roster_status, roster_status_reason, performance_review, email, phone, city, state, country, contact_name, notification_channel, portal_api_key, created_at, onboarding_overridden_at, onboarded_from_external',
        )
        .eq('landlord_id', landlordId)
        .eq('id', vendorId)
        .maybeSingle(),
      fetchVendorScoresForLandlord(landlordId),
      supabase
        .from('vendor_verifications')
        .select(
          'license_status, license_number, license_state, license_expiration, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, w9_received, tax_entity_type, tin_type, tin_last4, tin_fingerprint, w9_variant, tax_1099_treatment, trade_categories, service_area, availability, status',
        )
        .eq('landlord_id', landlordId)
        .eq('vendor_id', vendorId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('operations_graph_events')
        .select('id')
        .eq('landlord_id', landlordId)
        .eq('vendor_id', vendorId)
        .eq('event_type', 'vendor.onboarding_override_sms_sent')
        .limit(1)
        .maybeSingle(),
      fetchLandlordAccountProfile(landlordId),
    ])

    if (vendorResult.status !== 'fulfilled' || vendorResult.value.error) {
      const message =
        vendorResult.status === 'fulfilled'
          ? vendorResult.value.error?.message
          : String(vendorResult.reason)
      setError(message ?? 'Failed to load vendor.')
      setVendor(null)
      setOverrideActivationSmsSent(false)
      setCompletedJobs([])
      setAttentionTickets([])
      setAttentionEstimates([])
      setAttentionNoShows([])
      setAttentionReopens([])
      setJobsError(null)
      setLoading(false)
      return
    }

    const raw = vendorResult.value.data as Record<string, unknown> | null
    if (!raw) {
      setVendor(null)
      setOverrideActivationSmsSent(false)
      setCompletedJobs([])
      setAttentionTickets([])
      setAttentionEstimates([])
      setAttentionNoShows([])
      setAttentionReopens([])
      setJobsError(null)
      setLoading(false)
      return
    }

    const notificationRaw = asString(raw.notification_channel)
    const notificationChannel: VendorNotificationChannel =
      notificationRaw === 'sms' || notificationRaw === 'both' ? notificationRaw : 'email'

    setVendor({
      id: asString(raw.id),
      name: asString(raw.name) || 'Unnamed vendor',
      category: asString(raw.category) || null,
      contactName: asString(raw.contact_name) || null,
      email: asString(raw.email) || null,
      phone: asString(raw.phone) || null,
      city: asString(raw.city) || null,
      state: asString(raw.state) || null,
      country: asString(raw.country) || null,
      active: raw.active !== false,
      preferredEmergency: raw.preferred_emergency === true,
      rosterStatus: asString(raw.roster_status) || null,
      rosterStatusReason: asString(raw.roster_status_reason) || null,
      performanceReview: asString(raw.performance_review) || null,
      notificationChannel,
      portalApiKey: asString(raw.portal_api_key) || null,
      createdAt: asString(raw.created_at) || null,
      onboardingOverriddenAt: asString(raw.onboarding_overridden_at) || null,
      onboardedFromExternal: raw.onboarded_from_external === true,
    })

    setMarketplacePreference(
      accountProfile.status === 'fulfilled' ? accountProfile.value.marketplacePreference : null,
    )

    setOverrideActivationSmsSent(
      overrideSmsResult.status === 'fulfilled' &&
        !overrideSmsResult.value.error &&
        Boolean(overrideSmsResult.value.data),
    )

    if (scores.status === 'fulfilled' && !scores.value.errorMessage) {
      const match = scores.value.data.find((row) => asString(row.vendor_id) === vendorId)
      if (match) {
        setMetrics({
          rating: asFiniteNumber(match.vendor_score),
          reviewCount: asFiniteNumber(match.review_count) ?? 0,
          completedJobs: asFiniteNumber(match.completed_jobs) ?? 0,
          avgResponseMinutes: asFiniteNumber(match.avg_response_time),
          residentSatisfaction: asFiniteNumber(match.resident_satisfaction),
          completionRate: asFiniteNumber(match.completion_rate),
        })
      } else {
        setMetrics(null)
      }
    } else {
      setMetrics(null)
    }

    if (verificationResult.status === 'fulfilled' && !verificationResult.value.error) {
      const vRaw = verificationResult.value.data as Record<string, unknown> | null
      setVerification(vRaw ? (vRaw as unknown as VerificationRecord) : null)
    } else {
      setVerification(null)
    }

    setLoading(false)
    setJobsError(null)

    const overriddenAt = asString(raw.onboarding_overridden_at)
    if (overriddenAt) {
      void dispatchUnassignedJobsAfterVendorOverride({
        landlordId,
        vendorId,
      }).then((result) => {
        if (result.assignedCount <= 0) return
        const name = asString(raw.name) || 'This vendor'
        const jobs =
          result.assignedCount === 1
            ? 'We assigned 1 open work order.'
            : `We assigned ${result.assignedCount} open work orders.`
        setInviteNoticeError(false)
        setInviteNotice(`${name} is accepting new work. ${jobs}`)
      })
    }

    try {
      const [jobHistory, threadResult, attention] = await Promise.all([
        loadVendorJobHistory({
          landlordId,
          vendorId,
        }),
        loadVendorThreadId({ landlordId, vendorId }),
        loadVendorAttentionInputs({ landlordId, vendorId }),
      ])
      setCompletedJobs(jobHistory.rows)
      setAttentionTickets(attention.tickets)
      setAttentionEstimates(attention.estimates)
      setAttentionNoShows(attention.noShows)
      setAttentionReopens(attention.reopens)
      setJobsError(jobHistory.error)
      setThreadId(threadResult)
    } catch (jobLoadError) {
      console.warn('[AdminVendorDetailDashboard] vendor jobs', jobLoadError)
      setCompletedJobs([])
      setAttentionTickets([])
      setAttentionEstimates([])
      setAttentionNoShows([])
      setAttentionReopens([])
      setThreadId(null)
      const detail =
        jobLoadError instanceof Error
          ? jobLoadError.message
          : typeof jobLoadError === 'object' &&
              jobLoadError &&
              'message' in jobLoadError &&
              typeof (jobLoadError as { message: unknown }).message === 'string'
            ? (jobLoadError as { message: string }).message
            : ''
      setJobsError(
        detail
          ? `Could not load work orders for this vendor. ${detail}`
          : 'Could not load work orders for this vendor.',
      )
    }
  }, [vendorId])

  useEffect(() => {
    void loadVendor()
  }, [loadVendor])

  useEffect(() => {
    if (!actionsOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (!actionsMenuRef.current?.contains(event.target as Node)) setActionsOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActionsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionsOpen])

  const assignJobTitleId = useId()

  const openAssignJobModal = useCallback(async () => {
    setAssignJobOpen(true)
    setAssignJobsError(null)
    setAssignableJobs([])
    setAssignJobsLoading(true)
    try {
      const jobs = await loadAssignableJobs(getActiveLandlordId())
      setAssignableJobs(jobs)
      if (jobs.length === 0) {
        setAssignJobsError('No unassigned open work orders right now.')
      }
    } catch (assignLoadError) {
      setAssignJobsError(
        getErrorMessage(assignLoadError, 'Could not load open work orders. Please try again.'),
      )
    } finally {
      setAssignJobsLoading(false)
    }
  }, [])

  const handleAssignToJob = useCallback(
    async (ticketId: string) => {
      if (!vendor) return
      const url = resolveAdminReassignUrl()
      if (!url) {
        setAssignJobsError('Assign to job is not configured.')
        return
      }
      setAssignSavingTicketId(ticketId)
      setAssignJobsError(null)
      try {
        await postAdminReassignVendor({
          url,
          ticketId,
          vendorId: vendor.id,
          vendorName: vendor.name,
        })
        void recordActivityLog({
          landlordId: getActiveLandlordId(),
          eventType: 'vendor.assigned_to_job',
          source: 'dashboard',
          actorType: 'landlord',
          vendorId: vendor.id,
          maintenanceRequestId: ticketId,
          metadata: {
            message: `${vendor.name} was assigned to ${formatWorkOrderRefFromTicketId(ticketId)}.`,
          },
        }).catch(() => {})
        setAssignJobOpen(false)
        setInviteNoticeError(false)
        setInviteNotice(
          `${vendor.name} was assigned to ${formatWorkOrderRefFromTicketId(ticketId)}.`,
        )
        void loadVendor()
      } catch (assignError) {
        setAssignJobsError(
          getErrorMessage(assignError, 'Could not assign this vendor. Please try again.'),
        )
      } finally {
        setAssignSavingTicketId(null)
      }
    },
    [vendor, loadVendor],
  )

  const compliance: VendorComplianceProfile | null = useMemo(() => {
    if (!vendor) return null
    return buildVendorComplianceProfile(
      {
        id: vendor.id,
        name: vendor.name,
        phone: vendor.phone,
        category: vendor.category,
        active: vendor.active,
        rosterStatus: vendor.rosterStatus,
        onboardingOverriddenAt: vendor.onboardingOverriddenAt,
      },
      verification,
    )
  }, [vendor, verification])

  const checklist: VerificationChecklist | null = useMemo(() => {
    if (!verification) return null
    return computeVendorProfileVerificationChecklist(verification)
  }, [verification])

  const attentionItems = useMemo(
    () =>
      buildVendorProfileAttention({
        checklist,
        verification,
        onboardingOverriddenAt: vendor?.onboardingOverriddenAt,
        tickets: attentionTickets,
        estimates: attentionEstimates,
        noShows: attentionNoShows,
        reopens: attentionReopens,
      }),
    [
      checklist,
      verification,
      vendor?.onboardingOverriddenAt,
      attentionTickets,
      attentionEstimates,
      attentionNoShows,
      attentionReopens,
    ],
  )

  const editVendorRow = useMemo((): VendorManagementRow | null => {
    if (!vendor) return null
    return {
      id: vendor.id,
      name: vendor.name,
      category: vendor.category,
      contactName: vendor.contactName,
      email: vendor.email,
      phone: vendor.phone,
      city: vendor.city,
      state: vendor.state,
      country: vendor.country,
      notification_channel: vendor.notificationChannel,
      active: vendor.active,
      preferredEmergency: vendor.preferredEmergency,
      portal_api_key: vendor.portalApiKey,
    }
  }, [vendor])

  const onboardingAlreadyActivated = Boolean(
    vendor?.onboardingOverriddenAt || overrideActivationSmsSent,
  )

  const canSendVerificationInvite = Boolean(
    vendor &&
      !onboardingAlreadyActivated &&
      canShowStartVendorOnboarding({
        hasContact: Boolean(vendor.phone?.trim() || vendor.email?.trim()),
        verificationStatus: verification?.status,
        vendorActive: vendor.active,
        availability: verification?.availability,
        rosterStatus: vendor.rosterStatus,
        onboardingOverriddenAt: vendor.onboardingOverriddenAt,
      }),
  )

  const canRetryVerificationInvite = Boolean(
    vendor &&
      !onboardingAlreadyActivated &&
      canRetryVendorOnboarding({
        hasContact: Boolean(vendor.phone?.trim() || vendor.email?.trim()),
        verificationStatus: verification?.status,
        vendorActive: vendor.active,
        availability: verification?.availability,
        rosterStatus: vendor.rosterStatus,
        onboardingOverriddenAt: vendor.onboardingOverriddenAt,
      }),
  )

  const canOverrideOnboarding = Boolean(
    vendor &&
      !onboardingAlreadyActivated &&
      (compliance?.capacity.status === 'not_started' ||
        compliance?.capacity.status === 'pending' ||
        compliance?.capacity.status === 'docs_submitted'),
  )

  const canSendOverrideActivationSms = Boolean(
    vendor?.onboardingOverriddenAt &&
      vendor.phone?.trim() &&
      !overrideActivationSmsSent,
  )

  async function handleStartOnboarding() {
    if (!vendor || inviteSaving) return

    const phone = vendor.phone?.trim() ?? ''
    const email = vendor.email?.trim() ?? ''
    if (!phone && !email) {
      setInviteNoticeError(true)
      setInviteNotice(
        'Add a phone number or email on this vendor before starting onboarding.',
      )
      return
    }

    const landlordId = getActiveLandlordId()
    if (!landlordId) {
      setInviteNoticeError(true)
      setInviteNotice('No active landlord. Sign in again and try once more.')
      return
    }

    const channel: VendorInviteChannel =
      phone && email ? 'both' : phone ? 'sms' : 'email'

    setInviteSaving(true)
    setInviteNotice(null)
    setInviteNoticeError(false)
    try {
      const result = await sendVendorInvite({
        landlordId,
        vendorId: vendor.id,
        businessName: vendor.name,
        contactName: vendor.contactName ?? undefined,
        email: email || undefined,
        phone: phone || undefined,
        channel,
        tradeCategories: vendor.category ? [vendor.category] : undefined,
      })
      const anySent =
        result.delivery.sms === 'sent' || result.delivery.email === 'sent'
      if (!anySent) {
        setInviteNoticeError(true)
        setInviteNotice(
          'Verification invite could not be delivered. Check the vendor\'s contact info and try again.',
        )
        return
      }
      setInviteNoticeError(false)
      setInviteNotice(
        'Onboarding started. The vendor can complete their profile from the link we sent.',
      )
      void loadVendor()
    } catch (err) {
      setInviteNoticeError(true)
      setInviteNotice(
        getErrorMessage(err, 'Could not start onboarding. Please try again.'),
      )
    } finally {
      setInviteSaving(false)
    }
  }

  async function handleOverrideOnboarding() {
    if (!supabase || !vendor || overrideSaving) return

    setOverrideSaving(true)
    setOverrideError(null)
    const landlordId = getActiveLandlordId()
    const now = new Date().toISOString()
    const disclaimerText = vendorOnboardingOverrideDisclaimerText(vendor.name)

    const { data: authSession } = await supabase.auth.getSession()
    const session = authSession.session
    const sessionToken = session?.access_token?.trim() ?? ''
    if (!session || !sessionToken) {
      setOverrideError('Sign in again to activate this vendor.')
      setOverrideSaving(false)
      return
    }

    const { error: ackError } = await supabase.from('vendor_onboarding_override_acks').insert({
      landlord_id: landlordId,
      vendor_id: vendor.id,
      auth_user_id: session.user?.id ?? null,
      session_token: sessionToken,
      disclaimer_version: VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_VERSION,
      disclaimer_text: disclaimerText,
      acknowledged_at: now,
    })

    if (ackError) {
      setOverrideError(getErrorMessage(ackError, 'Could not save the acknowledgement.'))
      setOverrideSaving(false)
      return
    }

    const { error: updateError } = await supabase
      .from('vendors')
      .update({ onboarding_overridden_at: now, active: true })
      .eq('id', vendor.id)
      .eq('landlord_id', landlordId)

    if (updateError) {
      setOverrideError(getErrorMessage(updateError, 'Could not activate this vendor.'))
      setOverrideSaving(false)
      return
    }

    void recordActivityLog({
      landlordId,
      eventType: 'vendor.onboarding_overridden',
      source: 'dashboard',
      actorType: 'landlord',
      actorId: session.user?.id ?? null,
      vendorId: vendor.id,
      metadata: {
        message: `${vendor.name} was activated without verification documents.`,
        disclaimer_version: VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_VERSION,
        acknowledged_at: now,
      },
    })

    setVendor({
      ...vendor,
      active: true,
      onboardingOverriddenAt: now,
    })
    setOverrideModalOpen(false)

    const sms = await notifyVendorOnboardingOverrideActivated({
      landlordId,
      vendorId: vendor.id,
    })
    applyOverrideActivationSmsNotice(vendor.name, sms.sms, {
      afterActivate: true,
      assignedCount: sms.assignedCount,
    })
    setOverrideSaving(false)
  }

  function applyOverrideActivationSmsNotice(
    vendorName: string,
    sms: 'sent' | 'skipped' | 'failed',
    opts?: { afterActivate?: boolean; assignedCount?: number },
  ) {
    setInviteNoticeError(sms === 'failed' && !opts?.afterActivate)
    const assignedCount = opts?.assignedCount ?? 0
    const jobs =
      assignedCount === 1
        ? ' We assigned 1 open work order.'
        : assignedCount > 1
          ? ` We assigned ${assignedCount} open work orders.`
          : ''
    const prefix = opts?.afterActivate
      ? `${vendorName} is now Active and eligible for work orders.`
      : ''
    if (sms === 'sent') {
      setOverrideActivationSmsSent(true)
      setInviteNotice(
        opts?.afterActivate
          ? `${prefix}${jobs} We texted them that their profile is active.`
          : `We texted ${vendorName} that their profile is active.${jobs}`,
      )
      return
    }
    if (sms === 'skipped') {
      setInviteNotice(
        opts?.afterActivate
          ? `${prefix}${jobs} We couldn't text them because there's no phone number on file.`
          : `We couldn't text ${vendorName} because there's no phone number on file.${jobs}`,
      )
      return
    }
    setInviteNotice(
      opts?.afterActivate
        ? `${prefix}${jobs} We couldn't send the activation text.`
        : `We couldn't send the activation text.${jobs}`,
    )
  }

  async function handleSendOverrideActivationSms() {
    if (!vendor || overrideSaving) return
    setOverrideSaving(true)
    const sms = await notifyVendorOnboardingOverrideActivated({
      landlordId: getActiveLandlordId(),
      vendorId: vendor.id,
    })
    applyOverrideActivationSmsNotice(vendor.name, sms.sms, {
      assignedCount: sms.assignedCount,
    })
    setOverrideSaving(false)
  }

  if (!loading && !vendor) {
    return (
      <main className="px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">
          {error ? `Could not load vendor: ${error}` : 'Vendor not found.'}
        </p>
        <Link to="/admin/vendors" className="sa-link mt-3 text-[14px] font-medium text-[#186179]">
          ← All vendors
        </Link>
      </main>
    )
  }

  const tradeLabel = vendor ? formatVendorTradeLabel(vendor.category) : ''
  const sourceSinceLabel = vendor
    ? formatVendorSourceSinceLabel(vendor.onboardedFromExternal, vendor.createdAt)
    : null
  const locationLabel = vendor ? formatVendorLocationLabel(vendor) : null

  return (
    <main className="px-8 pb-12">
      <div className="py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              {loading ? 'Loading vendor…' : vendor?.name}
            </h1>
            {loading || sourceSinceLabel ? (
              <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                {loading ? ' ' : sourceSinceLabel}
                {!loading &&
                vendor &&
                vendorBlockedFromAutoAssignBySettings({
                  onboardedFromExternal: vendor.onboardedFromExternal,
                  marketplacePreference,
                }) ? (
                  <>
                    {' '}
                    · Cannot assign.{' '}
                    <Link
                      to={adminNavPath('settings_organization')}
                      className="sa-link font-medium text-[#186179] hover:underline"
                      title={VENDOR_SOURCE_SETTINGS_HINT}
                    >
                      Change vendor pool in Settings
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            {!loading &&
            (tradeLabel || vendor?.phone || vendor?.email || vendor?.contactName || locationLabel) ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {tradeLabel ? <span className={CONTACT_CHIP_CLASS}>{tradeLabel}</span> : null}
                {vendor?.contactName ? (
                  <span className={CONTACT_CHIP_CLASS}>
                    {vendor.contactName}
                  </span>
                ) : null}
                {vendor?.phone ? (
                  <span className={CONTACT_CHIP_CLASS}>
                    <PhoneIcon />
                    {vendor.phone}
                  </span>
                ) : null}
                {vendor?.email ? (
                  <span className={CONTACT_CHIP_CLASS}>
                    <MailIcon />
                    {vendor.email}
                  </span>
                ) : null}
                {locationLabel ? (
                  <span className={CONTACT_CHIP_CLASS}>
                    <LocationIcon />
                    <span className="min-w-0 truncate">{locationLabel}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
            {!loading && metrics && (metrics.rating != null || metrics.reviewCount > 0) ? (
              <div className="mt-3 flex h-6 items-center gap-2">
                {metrics.rating != null ? (
                  <>
                    <span className="flex h-6 items-center text-[24px] font-bold leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums">
                      {metrics.rating.toFixed(1)}
                    </span>
                    <RatingStars rating={metrics.rating} />
                  </>
                ) : null}
                <span className="flex h-6 items-center text-[12px] leading-none text-[#6a7282]">
                  {metrics.reviewCount.toLocaleString()} reviews
                </span>
              </div>
            ) : null}
            {!loading &&
            (performanceReviewLabel(vendor?.performanceReview ?? null) ||
              canSendVerificationInvite ||
              canRetryVerificationInvite ||
              canOverrideOnboarding ||
              canSendOverrideActivationSms) ? (
              <div className="mt-3 flex flex-col gap-2">
                {performanceReviewLabel(vendor?.performanceReview ?? null) ? (
                  <span className="inline-flex w-fit items-center rounded-full bg-[#fff7ed] px-3 py-1 text-[12px] font-medium text-[#9a3412]">
                    {performanceReviewLabel(vendor?.performanceReview ?? null)}
                  </span>
                ) : null}
                {canSendVerificationInvite ||
                canRetryVerificationInvite ||
                canOverrideOnboarding ||
                canSendOverrideActivationSms ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {canSendVerificationInvite || canRetryVerificationInvite ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={inviteSaving}
                          onClick={() => setSetupOutreachAckOpen(true)}
                          className="sa-press inline-flex h-9 w-fit items-center rounded-[10px] bg-[#187960] px-4 text-[13px] font-medium leading-5 text-white hover:bg-[#146b52] disabled:pointer-events-none disabled:opacity-60"
                        >
                          {inviteSaving
                            ? 'Sending…'
                            : canRetryVerificationInvite
                              ? 'Retry invite'
                              : 'Send invite'}
                        </button>
                        <SendInviteInfoTip variant="vendor" />
                      </div>
                    ) : null}
                    {canOverrideOnboarding ? (
                      <button
                        type="button"
                        disabled={overrideSaving}
                        onClick={() => {
                          setOverrideError(null)
                          setOverrideModalOpen(true)
                        }}
                        className="sa-press inline-flex h-9 w-fit items-center rounded-[10px] border border-[#187960] bg-white px-4 text-[13px] font-medium leading-5 text-[#364153] hover:bg-[#f9fafb] disabled:opacity-60"
                      >
                        Skip setup
                      </button>
                    ) : null}
                    {canSendOverrideActivationSms ? (
                      <button
                        type="button"
                        disabled={overrideSaving}
                        onClick={() => void handleSendOverrideActivationSms()}
                        className="sa-press inline-flex h-9 w-fit items-center rounded-[10px] border border-[#d1d5dc] bg-white px-4 text-[13px] font-medium leading-5 text-[#364153] hover:bg-[#f9fafb] disabled:opacity-60"
                      >
                        {overrideSaving ? 'Sending…' : 'Send activation text'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {!loading && vendor ? (
            <div className="flex shrink-0 items-center gap-2">
              <div ref={actionsMenuRef} className="relative">
                <button
                  type="button"
                  aria-label="Vendor actions"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  onClick={() => setActionsOpen((open) => !open)}
                  className="sa-press inline-flex size-9 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white text-[#364153] hover:bg-[#f9fafb]"
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="12" cy="5" r="1.75" />
                    <circle cx="12" cy="12" r="1.75" />
                    <circle cx="12" cy="19" r="1.75" />
                  </svg>
                </button>
                {actionsOpen ? (
                  <div
                    role="menu"
                    className="sa-enter absolute right-0 z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.12)]"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f3f4f6]"
                      onClick={() => {
                        setActionsOpen(false)
                        setEditOpen(true)
                      }}
                    >
                      Edit profile
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f3f4f6]"
                      onClick={() => {
                        setActionsOpen(false)
                        void openAssignJobModal()
                      }}
                    >
                      Assign to job
                    </button>
                    {threadId ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f3f4f6]"
                        onClick={() => {
                          setActionsOpen(false)
                          navigate(
                            `/admin/communication?thread=${encodeURIComponent(threadId)}`,
                          )
                        }}
                      >
                        See thread
                      </button>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        disabled
                        title="No message thread for this vendor yet"
                        className="block w-full cursor-not-allowed px-3 py-2 text-left text-[13px] font-medium text-[#9ca3af]"
                      >
                        See thread
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {inviteNotice ? (
          <p
            className={
              inviteNoticeError
                ? 'mt-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] leading-5 text-[#b91c1c]'
                : 'mt-3 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[13px] leading-5 text-[#166534]'
            }
          >
            {inviteNotice}
          </p>
        ) : null}
        {vendor?.performanceReview === 'suspension_review' ||
        (vendor?.rosterStatusReason ?? '').startsWith('misconduct') ? (
          <p className="mt-3 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[13px] leading-5 text-[#9a3412]">
            {(vendor?.rosterStatusReason ?? '').startsWith('misconduct')
              ? 'Immediate hold after a Class A/B misconduct report. Review within 1–2 hours; contact safety@ulohome.com as needed.'
              : 'Open suspension review from performance standards (ratings or no-shows). Decide whether to restore or keep the hold.'}
          </p>
        ) : null}

        {!loading && vendor ? (
          <section className="mt-4 min-w-0 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[15px] font-semibold leading-none text-[#0a0a0a]">
                Needs your attention
              </h2>
              {attentionItems.length > 0 ? (
                <span className="inline-flex items-center rounded-[4px] bg-[#fee2e2] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-[#b91c1c] tabular-nums">
                  {attentionItems.length}{' '}
                  {attentionItems.length === 1 ? 'action needed' : 'actions needed'}
                </span>
              ) : null}
            </div>
            {attentionItems.length === 0 ? (
              <p className="mt-4 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                Nothing needs your attention
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {attentionItems.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-[8px] border border-[#f3f4f6] bg-[#fafafa] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span
                        className={
                          item.badgeLabel === 'HIGH'
                            ? 'inline-flex shrink-0 rounded-[4px] bg-[#7f1d1d] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-white'
                            : 'inline-flex shrink-0 rounded-[4px] bg-[#fee2e2] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-[#b91c1c]'
                        }
                      >
                        {item.badgeLabel}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                          {item.title}
                        </p>
                        <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{item.detail}</p>
                      </div>
                      {item.href ? (
                        <Link
                          to={item.href}
                          className={`${ADMIN_ATTENTION_ACTION_CLASS} ml-auto bg-transparent px-0`}
                        >
                          {item.actionLabel}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className={`${ADMIN_ATTENTION_ACTION_CLASS} ml-auto bg-transparent px-0`}
                          onClick={() => {
                            if (item.scrollToCompliance) {
                              document
                                .getElementById('vendor-compliance')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            }
                          }}
                        >
                          {item.actionLabel}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {!loading && vendor ? (
          <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <VendorKpiCard
              label="Availability"
              title={compliance?.capacity.detail || compliance?.capacity.label || 'Vendor availability'}
              value={
                compliance ? (
                  <span
                    title={compliance.capacity.detail}
                    className={[
                      'inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                      vendorCapacityChipVisualClasses(
                        compliance.capacity.status as VendorCapacityChipStatus,
                      ).pill,
                    ].join(' ')}
                  >
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        vendorCapacityChipVisualClasses(
                          compliance.capacity.status as VendorCapacityChipStatus,
                        ).dot
                      }`}
                      aria-hidden
                    />
                    <span className="truncate">{compliance.capacity.label}</span>
                  </span>
                ) : (
                  '—'
                )
              }
            />
            <VendorKpiCard
              label="Completed jobs"
              value={(
                metrics?.completedJobs ??
                completedJobs.filter((job) => job.status === 'completed').length
              ).toLocaleString()}
              title="Completed work orders for this vendor."
            />
            <VendorKpiCard
              label="Average response"
              value={formatResponse(metrics?.avgResponseMinutes ?? null)}
              title="Average time from job dispatch SMS to the vendor’s YES or NO reply."
            />
            <VendorKpiCard
              label="Reviews"
              value={
                metrics?.rating != null
                  ? `${metrics.rating.toFixed(1)}${
                      metrics.reviewCount > 0 ? ` · ${metrics.reviewCount.toLocaleString()}` : ''
                    }`
                  : metrics && metrics.reviewCount > 0
                    ? metrics.reviewCount.toLocaleString()
                    : '—'
              }
              title={
                metrics?.reviewCount
                  ? `${metrics.reviewCount.toLocaleString()} resident review${
                      metrics.reviewCount === 1 ? '' : 's'
                    }`
                  : 'Resident reviews for this vendor.'
              }
            />
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-center text-[13px] text-[#6a7282]">Loading vendor profile…</p>
        </div>
      ) : compliance && vendor ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
          <div className="min-w-0">
          <section className="flex flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#f3f4f6] px-5 py-4">
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">Jobs</h2>
            </div>
            <div className="flex min-h-[16rem] flex-col">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#f3f4f6] px-5 py-3 text-[13px] leading-5 text-[#6a7282]">
                <span>
                  <span className="font-medium tabular-nums text-[#0a0a0a]">
                    {completedJobs.length}
                  </span>{' '}
                  {completedJobs.length === 1 ? 'work order' : 'work orders'}
                </span>
                <span>
                  Avg. response{' '}
                  <span className="font-medium tabular-nums text-[#0a0a0a]">
                    {formatResponse(metrics?.avgResponseMinutes ?? null)}
                  </span>
                </span>
              </div>
              {jobsError ? (
                <p className="px-5 py-3 text-[13px] leading-5 text-[#991b1b]">{jobsError}</p>
              ) : null}
              <div className="overflow-x-auto overflow-y-clip">
                <table className="min-w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-[#e5e7eb]">
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Work order</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Status</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Issue</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Location</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Completed</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Time to complete</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#6a7282]">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedJobs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-10 text-center text-[14px] text-[#6a7282]">
                          No work orders for this vendor yet.
                        </td>
                      </tr>
                    ) : (
                      completedJobs.map((job) => (
                        <tr key={job.id} className="border-b border-[#f3f4f6] last:border-b-0">
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] font-medium tabular-nums text-[#0a0a0a]">
                            <Link
                              to={`/admin/requests?q=${encodeURIComponent(job.workOrderRef)}`}
                              className="sa-link rounded-[4px] text-[#186179] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                            >
                              {job.workOrderRef}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] text-[#364153]">
                            {vendorJobStatusLabel(job.status)}
                          </td>
                          <td className="max-w-[16rem] px-5 py-3">
                            <p className="truncate text-[13px] font-medium text-[#0a0a0a]" title={job.issue}>
                              {job.issue}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] text-[#364153]">
                            {job.location}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] tabular-nums text-[#364153]">
                            {formatJobDate(job.completedAt)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] tabular-nums text-[#364153]">
                            {formatResponse(job.durationMinutes)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-[13px] tabular-nums text-[#0a0a0a]">
                            {formatJobCost(job.cost)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          </div>

          <aside>
            <section
              id="vendor-compliance"
              className="flex flex-col scroll-mt-6 rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#f3f4f6] px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                    Compliance & verification
                  </h2>
                  {checklist && !vendor?.onboardingOverriddenAt ? (
                    <span
                      className={[
                        'mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                        checklist.overall === 'verified'
                          ? 'bg-[#dbfce7] text-[#008236]'
                          : 'bg-[#fef9c3] text-[#92400e]',
                      ].join(' ')}
                    >
                      {checklist.overall === 'verified' ? 'Verified' : 'Needs review'}
                    </span>
                  ) : null}
                  {vendor?.onboardingOverriddenAt ? (
                    <>
                      <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#dbfce7] px-3 py-1 text-[12px] font-medium text-[#008236]">
                        Activated by your team
                      </span>
                      <p className="mt-2 text-[13px] leading-5 text-[#6a7282]">
                        Remaining documents are optional. This vendor can receive work orders.
                      </p>
                    </>
                  ) : null}
                </div>
                <p
                  className="shrink-0 text-[16px] font-semibold leading-6 tabular-nums text-[#0a0a0a]"
                  aria-label={`${compliance.collectedCount} of ${compliance.totalRequirements} documents uploaded`}
                >
                  {compliance.collectedCount}/{compliance.totalRequirements}
                </p>
              </div>
              {checklist ? (
                <>
                  <ul className="divide-y divide-[#f3f4f6]">
                    {checklist.items.map((item) => (
                      <ChecklistRow key={item.id} item={item} />
                    ))}
                  </ul>
                </>
              ) : (
                <div className="flex flex-col gap-0 divide-y divide-[#f3f4f6]">
                  <div className="p-5">
                    <ComplianceCard item={compliance.stateLicense} />
                  </div>
                  <div className="p-5">
                    <ComplianceCard item={compliance.generalLiabilityCoi} />
                  </div>
                  <div className="p-5">
                    <ComplianceCard item={compliance.w9} />
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      ) : null}

      <OverrideOnboardingModal
        open={overrideModalOpen}
        vendorName={vendor?.name ?? ''}
        saving={overrideSaving}
        error={overrideError}
        onClose={() => {
          if (overrideSaving) return
          setOverrideModalOpen(false)
          setOverrideError(null)
        }}
        onActivate={() => void handleOverrideOnboarding()}
      />
      <SetupOutreachAckModal
        open={setupOutreachAckOpen}
        kind="vendor"
        retry={canRetryVerificationInvite}
        saving={inviteSaving}
        recipientName={vendor?.name || vendor?.contactName}
        channel={inviteChannelFromContact(vendor?.phone, vendor?.email)}
        onClose={() => {
          if (inviteSaving) return
          setSetupOutreachAckOpen(false)
        }}
        onConfirm={() => {
          void (async () => {
            await handleStartOnboarding()
            setSetupOutreachAckOpen(false)
          })()
        }}
      />
      <VendorFormModal
        open={editOpen}
        mode="edit"
        initial={editVendorRow}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false)
          void loadVendor()
        }}
      />

      {assignJobOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="presentation"
            className="absolute inset-0"
            aria-hidden
            onClick={() => {
              if (!assignSavingTicketId) setAssignJobOpen(false)
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={assignJobTitleId}
            className="relative flex max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1)]"
          >
            <div className="border-b border-[#f3f4f6] px-5 py-4">
              <h2
                id={assignJobTitleId}
                className="text-[18px] font-semibold leading-7 text-[#0a0a0a]"
              >
                Assign to job
              </h2>
              <p className="mt-1 text-[14px] leading-5 text-[#6a7282]">
                Choose an unassigned work order for {vendor?.name ?? 'this vendor'}.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {assignJobsLoading ? (
                <p className="px-3 py-6 text-center text-[13px] text-[#6a7282]">
                  Loading open work orders…
                </p>
              ) : assignableJobs.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-[#6a7282]">
                  {assignJobsError || 'No unassigned open work orders right now.'}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {assignableJobs.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        disabled={Boolean(assignSavingTicketId)}
                        onClick={() => void handleAssignToJob(job.id)}
                        className="sa-press flex w-full flex-col gap-0.5 rounded-[8px] px-3 py-2.5 text-left hover:bg-[#f9fafb] disabled:opacity-60"
                      >
                        <span className="text-[14px] font-medium leading-5 text-[#0a0a0a]">
                          {assignSavingTicketId === job.id ? 'Assigning…' : job.title}
                        </span>
                        <span className="text-[12px] leading-4 text-[#6a7282]">{job.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {assignJobsError && assignableJobs.length > 0 ? (
              <p className="border-t border-[#fecaca] bg-[#fef2f2] px-5 py-2 text-[13px] text-[#b91c1c]">
                {assignJobsError}
              </p>
            ) : null}
            <div className="flex justify-end border-t border-[#f3f4f6] px-5 py-3">
              <button
                type="button"
                disabled={Boolean(assignSavingTicketId)}
                onClick={() => setAssignJobOpen(false)}
                className="sa-press rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-[#364153] hover:bg-[#f3f4f6] disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default AdminVendorDetailDashboard

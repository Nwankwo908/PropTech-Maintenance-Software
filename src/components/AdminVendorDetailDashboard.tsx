import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { formatVendorLocationLabel } from '@/lib/vendorLocation'
import { parseVendorId } from '@/lib/vendorRoutes'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'
import {
  canShowStartVendorOnboarding,
  vendorCapacityChipVisualClasses,
  type VendorCapacityChipStatus,
} from '@/lib/vendorStatusChip'
import {
  buildVendorComplianceProfile,
  mapQueriesForVendorServiceArea,
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
import { getErrorMessage } from '@/lib/errorMessage'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { fetchVendorScoresForLandlord } from '@/lib/vendorScores'
import {
  dispatchUnassignedJobsAfterVendorOverride,
  notifyVendorOnboardingOverrideActivated,
  sendVendorInvite,
  type VendorInviteChannel,
} from '@/api/vendorVerification'
import { VendorServiceAreaMap } from '@/components/VendorServiceAreaMap'
import { OverrideOnboardingModal } from '@/components/OverrideOnboardingModal'
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
  rosterStatus: string | null
  performanceReview: string | null
  rosterStatusReason: string | null
  notificationChannel: VendorNotificationChannel
  portalApiKey: string | null
  createdAt: string | null
  onboardingOverriddenAt: string | null
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

function formatVendorTenure(createdAt: string | null): string | null {
  if (!createdAt) return null
  const year = new Date(createdAt).getFullYear()
  if (!Number.isFinite(year)) return null
  return `${year} – present`
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

type VendorProfilePanel = 'service_area' | 'jobs'

export function AdminVendorDetailDashboard() {
  const { vendorId: vendorSlug } = useParams<{ vendorId: string }>()
  const vendorId = parseVendorId(vendorSlug)

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
  const [overrideActivationSmsSent, setOverrideActivationSmsSent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profilePanel, setProfilePanel] = useState<VendorProfilePanel>('service_area')
  const [completedJobs, setCompletedJobs] = useState<VendorJobRow[]>([])
  const [jobsError, setJobsError] = useState<string | null>(null)

  const loadVendor = useCallback(async () => {
    if (!supabase || !vendorId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const landlordId = getActiveLandlordId()
    const [vendorResult, scores, verificationResult, overrideSmsResult] = await Promise.allSettled([
      supabase
        .from('vendors')
        .select(
          'id, name, category, active, roster_status, roster_status_reason, performance_review, email, phone, city, state, country, contact_name, notification_channel, portal_api_key, created_at, onboarding_overridden_at',
        )
        .eq('landlord_id', landlordId)
        .eq('id', vendorId)
        .maybeSingle(),
      fetchVendorScoresForLandlord(landlordId),
      supabase
        .from('vendor_verifications')
        .select(
          'license_status, license_number, license_state, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, w9_received, tax_entity_type, tin_type, tin_last4, tin_fingerprint, w9_variant, tax_1099_treatment, trade_categories, service_area, availability, status',
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
      setJobsError(null)
      setLoading(false)
      return
    }

    const raw = vendorResult.value.data as Record<string, unknown> | null
    if (!raw) {
      setVendor(null)
      setOverrideActivationSmsSent(false)
      setCompletedJobs([])
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
      rosterStatus: asString(raw.roster_status) || null,
      rosterStatusReason: asString(raw.roster_status_reason) || null,
      performanceReview: asString(raw.performance_review) || null,
      notificationChannel,
      portalApiKey: asString(raw.portal_api_key) || null,
      createdAt: asString(raw.created_at) || null,
      onboardingOverriddenAt: asString(raw.onboarding_overridden_at) || null,
    })

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
        setInviteNotice(`${name} is Active. ${jobs}`)
      })
    }

    try {
      const jobHistory = await loadVendorJobHistory({
        landlordId,
        vendorId,
      })
      setCompletedJobs(jobHistory.rows)
      setJobsError(jobHistory.error)
    } catch (jobLoadError) {
      console.warn('[AdminVendorDetailDashboard] vendor jobs', jobLoadError)
      setCompletedJobs([])
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
    if (!sessionToken) {
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
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
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
  const tenureLabel = vendor ? formatVendorTenure(vendor.createdAt) : null
  const categoryLine = [tradeLabel, tenureLabel].filter(Boolean).join(' · ')
  const locationLabel = vendor ? formatVendorLocationLabel(vendor) : null

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="py-6">
        <Link
          to="/admin/vendors"
          className="sa-link inline-flex items-center gap-1 text-[13px] font-medium text-[#6a7282] hover:text-[#101828]"
        >
          <span aria-hidden>←</span> All vendors
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              {loading ? 'Loading vendor…' : vendor?.name}
            </h1>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              {loading ? ' ' : categoryLine}
            </p>
            {!loading && (vendor?.phone || vendor?.email || vendor?.contactName || locationLabel) ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
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
              canOverrideOnboarding ||
              canSendOverrideActivationSms) ? (
              <div className="mt-3 flex flex-col gap-2">
                {performanceReviewLabel(vendor?.performanceReview ?? null) ? (
                  <span className="inline-flex w-fit items-center rounded-full bg-[#fff7ed] px-3 py-1 text-[12px] font-medium text-[#9a3412]">
                    {performanceReviewLabel(vendor?.performanceReview ?? null)}
                  </span>
                ) : null}
                {canSendVerificationInvite ||
                canOverrideOnboarding ||
                canSendOverrideActivationSms ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {canSendVerificationInvite ? (
                      <button
                        type="button"
                        disabled={inviteSaving}
                        onClick={() => void handleStartOnboarding()}
                        className="sa-press inline-flex h-9 w-fit items-center rounded-[10px] bg-[#187960] px-4 text-[13px] font-medium leading-5 text-white hover:bg-[#146b52] disabled:pointer-events-none disabled:opacity-60"
                      >
                        {inviteSaving ? 'Starting…' : 'Start onboarding'}
                      </button>
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
                        Skip Onboarding
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
              {compliance ? (
                <span
                  title={compliance.capacity.detail}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                    vendorCapacityChipVisualClasses(
                      compliance.capacity.status as VendorCapacityChipStatus,
                    ).pill,
                  ].join(' ')}
                >
                  <span
                    className={`inline-block size-2 rounded-full ${
                      vendorCapacityChipVisualClasses(
                        compliance.capacity.status as VendorCapacityChipStatus,
                      ).dot
                    }`}
                    aria-hidden
                  />
                  {compliance.capacity.label}
                </span>
              ) : null}
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
                    className="sa-enter absolute right-0 z-20 mt-1.5 min-w-[160px] overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.12)]"
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
      </div>

      {loading ? (
        <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-center text-[13px] text-[#6a7282]">Loading vendor profile…</p>
        </div>
      ) : compliance && vendor ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-stretch">
          <div className="flex min-h-0 min-w-0 h-full flex-col">
          <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div
              className="flex items-end justify-start gap-5 border-b border-[#f3f4f6] px-5"
              role="tablist"
              aria-label="Vendor profile sections"
            >
              {(
                [
                  { id: 'service_area' as const, label: 'Service area' },
                  { id: 'jobs' as const, label: 'Jobs' },
                ] as const
              ).map((tab) => {
                const selected = profilePanel === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setProfilePanel(tab.id)}
                    className={[
                      'sa-press -mb-px border-b-2 px-0 pb-2.5 pt-3 text-[13px] font-medium leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2',
                      selected
                        ? 'border-[#186179] text-[#186179]'
                        : 'border-transparent text-[#6a7282] hover:text-[#186179]',
                    ].join(' ')}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {profilePanel === 'service_area' ? (
            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
              {compliance.serviceArea.radiusMiles != null ? (
                <p className="shrink-0 px-4 pt-4 text-[13px] leading-5 text-[#6a7282]">
                  {compliance.serviceArea.radiusMiles} mi service radius
                </p>
              ) : null}
              <div
                className={[
                  'min-h-0 flex-1 px-4 pb-4',
                  compliance.serviceArea.radiusMiles != null ? 'pt-3' : 'pt-4',
                ].join(' ')}
              >
                <VendorServiceAreaMap
                  className="h-full min-h-[280px] overflow-hidden rounded-[10px]"
                  queries={mapQueriesForVendorServiceArea(
                    compliance.serviceArea,
                    locationLabel,
                  )}
                  radiusMiles={compliance.serviceArea.radiusMiles}
                  emptyHint={compliance.serviceArea.emptyHint}
                />
              </div>
              {(compliance.serviceArea.cities ?? []).length > 0 ||
              Boolean(compliance.serviceArea.stateCode) ||
              (compliance.serviceArea.zipCodes ?? []).length > 0 ? (
                <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-4">
                  {(compliance.serviceArea.cities ?? []).map((city) => (
                    <span
                      key={`city-${city}`}
                      className="inline-flex rounded-[4px] bg-[#f3f4f6] px-2 py-0.5 text-[12px] font-medium text-[#364153]"
                    >
                      {city}
                    </span>
                  ))}
                  {compliance.serviceArea.stateCode ? (
                    <span className="inline-flex rounded-[4px] bg-[#f3f4f6] px-2 py-0.5 text-[12px] font-medium text-[#364153]">
                      {compliance.serviceArea.stateCode}
                    </span>
                  ) : null}
                  {(compliance.serviceArea.zipCodes ?? []).map((zip) => (
                    <span
                      key={zip}
                      className="inline-flex rounded-[4px] bg-[#f3f4f6] px-2 py-0.5 text-[12px] font-medium tabular-nums text-[#364153]"
                    >
                      {zip}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            ) : (
            <div role="tabpanel" className="flex min-h-[16rem] flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#f3f4f6] px-5 py-3 text-[13px] leading-5 text-[#6a7282]">
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
              <div className="min-h-0 flex-1 overflow-auto">
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
            )}
          </section>
          </div>

          <aside className="h-full lg:sticky lg:top-6">
            <section className="flex h-full flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
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
    </main>
  )
}

export default AdminVendorDetailDashboard

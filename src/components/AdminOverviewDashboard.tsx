import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  postDiscoverExternalVendors,
  resolveDiscoverExternalVendorsUrl,
  type ExternalVendorSuggestionDto,
} from '@/api/discoverExternalVendors'
import {
  postReassignExternalVendor,
  resolveReassignExternalVendorUrl,
} from '@/api/reassignExternalVendor'
import { postSlaAutoReassign, resolveSlaAutoReassignUrl } from '@/api/slaAutoReassign'
import insightWarningIcon from '@/assets/noun-warning-recurring.png'
import feedInfoIcon from '@/assets/noun-information.png'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { AwaitingDecisionListRail } from '@/components/AwaitingDecisionListRail'
import { AwaitingDecisionOutcomeModal } from '@/components/AwaitingDecisionOutcomeModal'
import { LateRentAccountReviewRail } from '@/components/LateRentAccountReviewRail'
import { LateRentAccountMessageRail } from '@/components/LateRentAccountMessageRail'
import { LeaseRenewalEscalatedRail } from '@/components/LeaseRenewalEscalatedRail'
import { LeaseRenewalIncentiveMessageRail } from '@/components/LeaseRenewalIncentiveMessageRail'
import { InvoicePaymentRail, type InvoicePaymentReview, type InvoicePaymentSuccessDetails } from '@/components/InvoicePaymentRail'
import { SlaOverdueActionRail } from '@/components/SlaOverdueActionRail'
import { FindExternalVendorRail } from '@/components/FindExternalVendorRail'
import { VendorCallFlowModal } from '@/components/VendorCallFlowModal'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { landlordHasPayments } from '@shared/landlordCapabilities'
import { cityStateZipForBuildingName, listPropertiesForLandlord, type PropertyRecord } from '@/lib/properties'
import {
  ensureOnboardingDashboardMatchesPortfolio,
} from '@/lib/onboarding'
import { useSidebarAdminProfile } from '@/hooks/useSidebarAdminProfile'
import {
  isMaintenanceAdminVendorEscalationReason,
  maintenanceAdminVendorAttentionMeta,
  maintenanceAdminVendorAttentionTitle,
} from '@/lib/maintenanceAdminVendor'
import {
  emptyAdminWorkflowDashboardData,
  fetchAdminWorkflowDashboard,
  formatLocationContextLabel,
  maintenanceTicketIdFromWorkflowRun,
  type AdminWorkflowDashboardData,
} from '@/lib/adminWorkflows'
import {
  collectCompletedWorkOrderTicketIds,
  shouldOmitEscalatedRunFromNeedsAttention,
} from '@/lib/needsAttentionWorkOrder'
import {
  snapshotActiveOperations,
  workflowOperationsPath,
} from '@/lib/adminWorkflowKanban'
import { fetchVendorYtdPaidTotal } from '@/lib/workflowPipelineDetail'
import {
  ADMIN_ATTENTION_ACTION_CLASS,
  ADMIN_RIGHT_RAIL_SCRIM,
  ADMIN_RIGHT_RAIL_STACK_HOST,
} from '@/lib/adminRightRail'
import { buildPropertyIdByBuilding, propertyDetailPathForBuilding, propertyResidentDetailPathForBuilding } from '@/lib/propertyRoutes'
import {
  buildActivityFeedTooltipCopy,
  splitEmphasizedText,
  type FeedTooltipDestination,
} from '@/lib/activityFeedTooltip'
import { PORTFOLIO_RECOMMENDATION_EVENT } from '@/lib/conversationMonitoring'
import {
  buildLeaseRenewalCallReasonLine,
  type VendorCallContext,
} from '@/lib/vendorCallFlow'
import {
  fetchRecentPropertyOperationsEvents,
  formatTimelineCategoryLabel,
  formatTimelineContextLine,
  type PropertyOperationsTimelineEvent,
} from '@/lib/propertyOperationsGraph'
import {
  buildPropertyHealthReport,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  countDistinctPortfolioUnits,
  propertyHealthFactorBreakdownLines,
  propertyHealthKpiDelta,
  resolvePropertyHealthKpiCaption,
  resolvePropertyHealthKpiValue,
  shouldShowPropertyHealthScore,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthFeedback,
  type PropertyHealthPmTask,
  type PropertyHealthResident,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import { buildEscalatedWorkflowReview } from '@/lib/escalatedWorkflowReview'
import {
  applyLateRentAccountAction,
  buildLateRentAccountReview,
  collectLateRentReviewRuns,
  type LateRentAccountAction,
  type LateRentAccountReview,
} from '@/lib/lateRentAccountReview'
import {
  appendLateRentSentMessage,
  buildLateRentPaymentPlanBrief,
  buildLateRentWaiveLateFeeBrief,
  sendLateRentAccountMessage,
  type LateRentAccountMessageBrief,
} from '@/lib/lateRentAccountMessaging'
import {
  applyLeaseRenewalEscalatedAction,
  buildLeaseRenewalEscalatedReview,
  isLeaseRenewalEscalatedRun,
  type LeaseRenewalEscalatedAction,
  type LeaseRenewalEscalatedReview,
} from '@/lib/leaseRenewalEscalatedReview'
import {
  buildExternalVendorFallbackReview,
  buildSlaOverdueActionReview,
  isSlaOverdueOpenTicket,
  pickAlternativeVendors,
  type SlaOverdueActionReview,
  type SlaOverdueTicketInput,
} from '@/lib/slaOverdueActionReview'
import {
  approveMaintenanceInvoice,
  rejectMaintenanceInvoice,
} from '@/api/maintenanceInvoice'
import { completeInvoicePaymentCheckout } from '@/api/invoicePaymentCheckout'
import {
  buildAttentionDeletedOutcome,
  buildAutoRemovedAttentionOutcome,
  buildLateRentActionOutcome,
  buildLeaseRenewalActionOutcome,
  buildVendorAssignedOutcome,
  type AwaitingDecisionOutcome,
} from '@/lib/awaitingDecisionOutcome'
import {
  appendLeaseRenewalIncentiveSentMessage,
  buildLeaseRenewalIncentiveBrief,
  sendLeaseRenewalIncentiveMessage,
  type LeaseRenewalIncentiveBrief,
} from '@/lib/leaseRenewalIncentiveMessaging'
import { enrichExternalVendorSuggestions, sanitizeExternalVendorDiscoveryForAccount } from '@/lib/externalVendorDisplay'
import { loadLeaseInfoMissingAttention, type LeaseInfoMissingAttention } from '@/lib/leaseInfoMissingAttention'
import {
  dismissNeedsAttentionItem,
  isNeedsAttentionDismissed,
  loadDismissedAttentionIds,
  type DismissedAttentionIds,
} from '@/lib/dismissNeedsAttention'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  computePortfolioInsights,
  type PortfolioInsightFinding,
} from '@shared/portfolioIntelligence'

type OverviewTicket = {
  id: string
  createdAt: string
  urgency: string
  dueAt: string | null
  vendorWorkStatus: string
  unit: string
  building: string | null
  email: string | null
  description: string | null
  issueCategory: string | null
  assignedVendorId: string | null
  assignedVendorName: string | null
  assignedAt: string | null
  residentName: string | null
  estimatedMinutes: number | null
  /** Actual total from an extracted vendor invoice (labor + materials + tax), when available. */
  totalCost: number | null
  /** When the job was marked complete, when the schema records it. */
  completedAt: string | null
}

type OverviewVendor = {
  id: string
  name: string
  category: string | null
  active: boolean
}

type OverviewUnit = {
  id: string
  unitLabel: string
  building: string | null
  status: string
}

type SmartInsight = PortfolioInsightFinding

type AttentionItem = {
  key: string
  title: string
  badge: 'critical' | 'warning'
  context: string
  meta: string
  actionLabel: string
  actionTo?: string
  onAction?: () => void
  actionStyle?: 'alert'
}

type EscalatedRailTarget =
  | { kind: 'ticket'; ticketId: string; preferExternalVendor?: boolean }
  | { kind: 'workflow'; runId: string; preferExternalVendor?: boolean }

type OverviewResident = {
  id: string
  fullName: string
  unit: string
  building: string | null
  status: string
  moveInDate: string | null
  leaseEndDate: string | null
  monthlyRent: number
  balanceDue: number
  phone: string | null
}

function overviewTicketToInput(
  ticket: OverviewTicket,
  units: OverviewUnit[],
): SlaOverdueTicketInput {
  const building =
    ticket.building ??
    units.find((u) => normalizeUnitLabel(u.unitLabel) === normalizeUnitLabel(ticket.unit))
      ?.building ??
    null
  return {
    id: ticket.id,
    createdAt: ticket.createdAt,
    dueAt: ticket.dueAt,
    urgency: ticket.urgency,
    unit: ticket.unit,
    building,
    description: ticket.description,
    issueCategory: ticket.issueCategory,
    assignedVendorId: ticket.assignedVendorId,
    assignedVendorName: ticket.assignedVendorName,
    vendorWorkStatus: ticket.vendorWorkStatus,
    residentName: ticket.residentName,
    assignedAt: ticket.assignedAt,
  }
}

function ticketHasRosterAlternative(
  ticket: OverviewTicket,
  vendors: OverviewVendor[],
  units: OverviewUnit[],
): boolean {
  return pickAlternativeVendors(overviewTicketToInput(ticket, units), vendors).length > 0
}

const CRITICAL_LEVELS = new Set(['urgent', 'emergency', 'critical', 'high'])
const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function normalizeTicketRow(
  raw: Record<string, unknown>,
  vendorNameById: Record<string, string> = {},
): OverviewTicket {
  const assignedVendorId = asString(raw.assigned_vendor_id) || null
  const embeddedVendor =
    asString(raw.assigned_vendor_name) ||
    asString(raw.vendor_name) ||
    (assignedVendorId ? vendorNameById[assignedVendorId] : '') ||
    asString(raw.vendor) ||
    null
  return {
    id: asString(raw.id),
    createdAt: asString(raw.created_at),
    urgency: (
      asString(raw.urgency) ||
      asString(raw.severity) ||
      asString(raw.priority)
    ).toLowerCase(),
    dueAt: asString(raw.due_at) || null,
    vendorWorkStatus: asString(raw.vendor_work_status).toLowerCase(),
    unit: asString(raw.unit),
    building: asString(raw.building) || null,
    email: asString(raw.email) || null,
    description: asString(raw.description) || null,
    issueCategory: asString(raw.issue_category) || null,
    assignedVendorId,
    assignedVendorName: embeddedVendor?.trim() || null,
    assignedAt: asString(raw.assigned_at) || null,
    residentName: asString(raw.resident_name) || null,
    estimatedMinutes:
      typeof raw.estimated_minutes === 'number' && Number.isFinite(raw.estimated_minutes)
        ? raw.estimated_minutes
        : null,
    totalCost: invoiceTotalFromRow(raw),
    completedAt:
      asString(raw.completed_at) ||
      asString(raw.resolved_at) ||
      asString(raw.closed_at) ||
      null,
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Total cost recorded from an extracted vendor invoice. Prefers an explicit
 * total column; otherwise sums labor + materials + tax when those are present.
 * Returns null when no invoice cost exists yet (job not invoiced).
 */
function invoiceTotalFromRow(raw: Record<string, unknown>): number | null {
  const total = asFiniteNumber(raw.total_cost ?? raw.invoice_total ?? raw.amount)
  if (total != null) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor == null && material == null && tax == null) return null
  return (labor ?? 0) + (material ?? 0) + (tax ?? 0)
}

/**
 * Cost proxy shared with unit_maintenance_cost_view:
 * estimated_minutes × $1.25/min, defaulting to 240 minutes per ticket.
 */
function ticketCostEstimate(ticket: OverviewTicket): number {
  return (ticket.estimatedMinutes ?? 240) * 1.25
}

/**
 * Spend for a single ticket: the real extracted invoice total when available,
 * otherwise the estimate proxy so the figure stays populated pre-invoicing.
 */
function ticketSpend(ticket: OverviewTicket): number {
  return ticket.totalCost ?? ticketCostEstimate(ticket)
}

/** Date a job's spend should be attributed to (completion date, else created). */
function ticketSpendDate(ticket: OverviewTicket): number {
  const completed = ticket.completedAt ? new Date(ticket.completedAt).getTime() : NaN
  if (!Number.isNaN(completed)) return completed
  return new Date(ticket.createdAt).getTime()
}

function isCompletedJob(ticket: OverviewTicket): boolean {
  return ticket.vendorWorkStatus === 'completed'
}

/** Abbreviated currency, e.g. "$1k", "$48.2k", "$1.2M". */
function formatSpendCompact(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(amount)
    .replace('K', 'k')
}

/** Signed abbreviated currency for a delta pill, e.g. "+$1.2k" / "-$340" / "$0". */
function formatSignedSpend(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  return `${sign}${formatSpendCompact(Math.abs(amount))}`
}

function isTicketOpen(ticket: OverviewTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus)
}

function isTicketCritical(ticket: OverviewTicket): boolean {
  return CRITICAL_LEVELS.has(ticket.urgency)
}

function normalizeUnitLabel(label: string): string {
  return label.toLowerCase().replace(/^unit\s+/, '').trim()
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** "Updated 11:17 AM" same-day, "Updated yesterday", or "Updated Jun 11" for older. */
function formatUpdatedAt(date: Date): string {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (date >= startOfToday) {
    return `Updated ${date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  }
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  if (date >= startOfYesterday) return 'Updated yesterday'
  return `Updated ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

function formatCategoryName(slug: string): string {
  return slug
    .split(/[_-]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/** Human label for awaiting-decision maintenance type (never a vague "General"). */
function resolveMaintenanceTypeLabel(
  issueCategory: string | null | undefined,
  ticket?: Pick<OverviewTicket, 'issueCategory' | 'description'> | null,
): string {
  const raw = (issueCategory ?? ticket?.issueCategory ?? '').trim().toLowerCase()
  if (raw && raw !== 'general' && raw !== 'other' && raw !== 'maintenance') {
    return `${formatCategoryName(raw)} maintenance`
  }

  const desc = (ticket?.description ?? '').toLowerCase()
  if (/plumb|leak|water|drain|sewage|pipe|disposal/.test(desc)) return 'Plumbing maintenance'
  if (/electric|breaker|outlet|wiring|panel|gfci/.test(desc)) return 'Electrical maintenance'
  if (/hvac|heat|ac\b|air condition|furnace|thermostat|compressor/.test(desc)) {
    return 'HVAC maintenance'
  }
  if (/appliance|refrigerat|dishwasher|washer|dryer|stove|oven|fridge/.test(desc)) {
    return 'Appliance maintenance'
  }
  if (/pest|roach|rodent|insect|infestation|bug/.test(desc)) return 'Pest control maintenance'
  if (/clean|carpet|deep clean/.test(desc)) return 'Cleaning maintenance'
  if (/door|window|lock|latch|screen/.test(desc)) return 'Door & window maintenance'
  if (/gas smell|gas leak/.test(desc)) return 'Gas safety maintenance'
  if (/noise/.test(desc)) return 'Noise complaint maintenance'

  const summary = ticket?.description?.trim()
  if (summary) {
    const short = summary.length > 48 ? `${summary.slice(0, 48).trim()}…` : summary
    return short
  }
  return 'Uncategorized maintenance'
}

function countCreatedBetween(
  tickets: OverviewTicket[],
  fromMs: number,
  toMs: number,
  predicate?: (t: OverviewTicket) => boolean,
): number {
  return tickets.filter((t) => {
    const ts = new Date(t.createdAt).getTime()
    if (Number.isNaN(ts) || ts < fromMs || ts >= toMs) return false
    return predicate ? predicate(t) : true
  }).length
}

function TrendingUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrendingDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M3 7l6 6 4-4 8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 17h6v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function isUnitRegisteredFeedEvent(event: PropertyOperationsTimelineEvent): boolean {
  return event.eventType === 'unit.registered'
}

function feedEventOpenTarget(
  event: PropertyOperationsTimelineEvent,
  propertyIdByBuilding: Map<string, string>,
): FeedTooltipDestination | null {
  if (event.eventType === PORTFOLIO_RECOMMENDATION_EVENT) {
    return { kind: 'property', path: '/admin' }
  }
  if (isUnitRegisteredFeedEvent(event)) {
    const building = event.building?.trim()
    return {
      kind: 'property',
      path: building
        ? propertyDetailPathForBuilding(building, propertyIdByBuilding)
        : '/admin/properties',
    }
  }
  const runId = event.workflowRunId?.trim()
  if (!runId) return null
  return { kind: 'workflow', runId }
}

function FeedEventInfo({
  event,
  propertyIdByBuilding,
  onOpen,
}: {
  event: PropertyOperationsTimelineEvent
  propertyIdByBuilding: Map<string, string>
  onOpen: (target: FeedTooltipDestination) => void
}) {
  const target = feedEventOpenTarget(event, propertyIdByBuilding)
  const copy = buildActivityFeedTooltipCopy(event, target)
  const summaryParts = splitEmphasizedText(copy.summary)

  const openTarget = () => {
    if (target) onOpen(target)
  }

  return (
    <span className="group/feed-info relative inline-flex shrink-0 self-start pt-3.5">
      <button
        type="button"
        tabIndex={0}
        disabled={!target}
        onClick={openTarget}
        className={[
          'sa-press inline-flex rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
          target ? 'cursor-pointer hover:opacity-70' : 'cursor-default opacity-40',
        ].join(' ')}
        aria-label={
          copy.actionLabel
            ? `${copy.actionLabel}: ${copy.title}`
            : `More information about ${copy.title}`
        }
      >
        <img
          src={feedInfoIcon}
          alt=""
          aria-hidden
          className="size-5 opacity-55"
        />
      </button>
      <div
        role="tooltip"
        className={[
          'absolute right-0 top-full z-50 mt-1.5 w-[min(280px,calc(100vw-2rem))] rounded-[10px] border border-[#e5e7eb] bg-white p-3 opacity-0 shadow-[0px_8px_24px_rgba(0,0,0,0.12)] transition-opacity duration-150 group-hover/feed-info:opacity-100 group-focus-within/feed-info:opacity-100',
          target ? 'cursor-pointer' : 'pointer-events-none',
        ].join(' ')}
        onClick={(e) => {
          if (!target) return
          e.preventDefault()
          e.stopPropagation()
          openTarget()
        }}
        onKeyDown={(e) => {
          if (!target) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            openTarget()
          }
        }}
      >
        <p className="text-[12px] font-semibold leading-4 text-[#0a0a0a]">{copy.title}</p>
        <p className="mt-1.5 text-[12px] leading-[17px] text-[#374151]">
          {summaryParts.map((part, index) =>
            part.bold ? (
              <strong key={`${part.text}-${index}`} className="font-semibold text-[#0a0a0a]">
                {part.text}
              </strong>
            ) : (
              <span key={`${part.text}-${index}`}>{part.text}</span>
            ),
          )}
        </p>
        {copy.fields.length ? (
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {copy.fields.map((field) => (
              <li key={field.label} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium leading-4 text-[#6a7282]">
                  {field.label}
                </span>
                <span className="text-[12px] leading-4 text-[#0a0a0a]">{field.value}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {copy.actionLabel ? (
          <p className="mt-2.5 text-[12px] font-semibold leading-4 text-[#0030b5]">
            {copy.actionLabel}
          </p>
        ) : null}
      </div>
    </span>
  )
}

function KpiBreakdownInfo({
  title,
  description,
  lines,
}: {
  title: string
  description?: string
  lines: Array<{ label: string; count?: number; value?: string; detail?: string }>
}) {
  if (!lines.length) return null

  return (
    <span className="group/kpi-info relative inline-flex shrink-0">
      <button
        type="button"
        tabIndex={0}
        className="sa-press inline-flex rounded p-0.5 outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
        aria-label={`${title} breakdown`}
      >
        <img
          src={feedInfoIcon}
          alt=""
          aria-hidden
          className="size-4 opacity-55"
        />
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-[min(280px,calc(100vw-2rem))] rounded-[10px] border border-[#e5e7eb] bg-white p-3 opacity-0 shadow-[0px_8px_24px_rgba(0,0,0,0.12)] transition-opacity duration-150 group-hover/kpi-info:opacity-100 group-focus-within/kpi-info:opacity-100"
      >
        <p className="text-[11px] font-semibold leading-4 text-[#0a0a0a]">{title}</p>
        {description ? (
          <p className="mt-1 text-[10px] leading-[14px] text-[#6a7282]">{description}</p>
        ) : null}
        <ul className="mt-2 flex flex-col gap-1.5">
          {lines.map((line) => {
            const displayValue =
              line.value ?? (line.count != null ? String(line.count) : null)
            return (
              <li key={line.label} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
                  <span className="text-[#364153]">{line.label}</span>
                  {displayValue != null ? (
                    <span className="shrink-0 font-semibold tabular-nums text-[#0a0a0a]">
                      {displayValue}
                    </span>
                  ) : null}
                </div>
                {line.detail ? (
                  <p className="text-[10px] leading-[13px] text-[#9ca3af]">{line.detail}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </span>
  )
}

function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = '',
  deltaFormatter,
  goodWhenUp = false,
  caption,
  infoTitle,
  infoDescription,
  infoLines,
}: {
  label: string
  value: string
  delta: number | null
  /** Appended to the delta, e.g. '%' for rate cards. */
  deltaSuffix?: string
  /** Renders the full signed delta string (e.g. currency); overrides deltaSuffix. */
  deltaFormatter?: (delta: number) => string
  /** True when an increase is a good trend (e.g. health), false when it's bad (e.g. critical issues). */
  goodWhenUp?: boolean
  caption: string
  infoTitle?: string
  infoDescription?: string
  infoLines?: Array<{ label: string; count?: number; value?: string; detail?: string }>
}) {
  const positive = (delta ?? 0) > 0
  const neutral = delta === 0
  const good = neutral ? false : positive === goodWhenUp
  return (
    <div className="sa-enter-scale flex min-w-0 flex-1 flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="truncate text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          {label}
        </p>
        {infoLines?.length ? (
          <KpiBreakdownInfo
            title={infoTitle ?? label}
            description={infoDescription}
            lines={infoLines}
          />
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[44px] font-bold leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums xl:text-[52px]">
          {value}
        </p>
        {delta != null ? (
          <span
            className={[
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] leading-5 tracking-[-0.1504px]',
              // Icon carries a brighter shade than the label text.
              neutral
                ? 'bg-[#f3f4f6] text-[#6a7282]'
                : good
                  ? 'bg-[rgba(16,185,129,0.08)] text-[#008236] [&>svg]:text-[#10b981]'
                  : 'bg-[rgba(255,83,83,0.08)] text-[#c10007] [&>svg]:text-[#fb2c36]',
            ].join(' ')}
          >
            {neutral ? null : positive ? <TrendingUpIcon /> : <TrendingDownIcon />}
            {deltaFormatter
              ? deltaFormatter(delta ?? 0)
              : positive
                ? `+${delta}${deltaSuffix}`
                : `${delta}${deltaSuffix}`}
          </span>
        ) : null}
      </div>
      <p className="text-[12px] leading-4 text-[#6a7282]">{caption}</p>
    </div>
  )
}

/** Map insight score (0–100) onto a 1–5 strength meter for insight cards. */
function insightStrengthDots(score: number): number {
  return Math.min(5, Math.max(1, Math.floor((score - 50) / 10)))
}

function InsightStrengthMeter({ score }: { score: number }) {
  const filled = insightStrengthDots(score)
  return (
    <div className="flex shrink-0 items-center gap-[6px]" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`size-[10px] rounded-full ${
            i < filled ? 'bg-[#9E439F]' : 'bg-[#e2e8f0]'
          }`}
        />
      ))}
    </div>
  )
}

/** Alert badge for high-strength (4–5) or low-strength (1–2) insight cards. */
function InsightAlertIcon({
  score,
  when,
}: {
  score: number
  when: 'high' | 'low'
}) {
  const dots = insightStrengthDots(score)
  if (when === 'high' && dots < 4) return null
  if (when === 'low' && dots > 2) return null
  return (
    <span
      role="img"
      aria-label={when === 'high' ? 'High priority insight' : 'Low vendor response'}
      className="mt-0.5 size-5 shrink-0"
      style={{
        backgroundColor: '#DA4951',
        WebkitMaskImage: `url(${insightWarningIcon})`,
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskImage: `url(${insightWarningIcon})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
      }}
    />
  )
}

function RecurringIssuesInsightCard({ insight }: { insight: SmartInsight }) {
  const categoryLabel = insight.categoryLabel ?? 'Maintenance'
  const requestCount = insight.requestCount ?? 0
  const requestWord = requestCount === 1 ? 'Request' : 'Requests'

  return (
    <div className="sa-enter-scale sa-surface flex flex-col gap-2 rounded-[12px] border border-[#eef2ff] bg-white p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-extrabold uppercase leading-normal tracking-[0.04em] text-[#9E439F]">
          Recurring Issues
        </p>
        <InsightAlertIcon score={insight.score} when="high" />
      </div>
      <div className="flex items-center gap-5">
        <p className="min-w-0 flex-1 text-[16px] font-normal leading-[1.4] text-[#0f172a]">
          {insight.text}
        </p>
        <InsightStrengthMeter score={insight.score} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] leading-normal text-[#64748b]">
        <span>
          {requestCount} {categoryLabel} {requestWord}
        </span>
        <span className="h-3 w-px shrink-0 bg-[#eef2ff]" aria-hidden />
        <span>Last 60 Days</span>
      </div>
    </div>
  )
}

function RiskInsightCard({ insight }: { insight: SmartInsight }) {
  const requestCount = insight.requestCount ?? 0
  const requestWord = requestCount === 1 ? 'Request' : 'Requests'

  return (
    <div className="sa-enter-scale sa-surface flex flex-col gap-2 rounded-[12px] border border-[#eef2ff] bg-white p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-extrabold uppercase leading-normal tracking-[0.04em] text-[#9E439F]">
          Needs Attention
        </p>
        <InsightAlertIcon score={insight.score} when="high" />
      </div>
      <div className="flex items-center gap-5">
        <p className="min-w-0 flex-1 text-[16px] font-normal leading-[1.4] text-[#0f172a]">
          {insight.text}
        </p>
        <InsightStrengthMeter score={insight.score} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] leading-normal text-[#64748b]">
        <span>
          {requestCount} Maintenance {requestWord}
        </span>
        <span className="h-3 w-px shrink-0 bg-[#eef2ff]" aria-hidden />
        <span>Last 60 Days</span>
      </div>
    </div>
  )
}

function VendorResponseInsightCard({ insight }: { insight: SmartInsight }) {
  const assignedCount = insight.assignedCount ?? 0
  const assignedWord = assignedCount === 1 ? 'Work Order' : 'Work Orders'

  return (
    <div className="sa-enter-scale sa-surface flex flex-col gap-2 rounded-[12px] border border-[#eef2ff] bg-white p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-extrabold uppercase leading-normal tracking-[0.04em] text-[#9E439F]">
          Vendor Response
        </p>
        <InsightAlertIcon score={insight.score} when="low" />
      </div>
      <div className="flex items-center gap-5">
        <p className="min-w-0 flex-1 text-[16px] font-normal leading-[1.4] text-[#0f172a]">
          {insight.text}
        </p>
        <InsightStrengthMeter score={insight.score} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] leading-normal text-[#64748b]">
        <span>
          {assignedCount} Assigned {assignedWord}
        </span>
        <span className="h-3 w-px shrink-0 bg-[#eef2ff]" aria-hidden />
        <span>All Time</span>
      </div>
    </div>
  )
}

function PreventFutureRepairsInsightCard({ insight }: { insight: SmartInsight }) {
  const categoryLabel = insight.categoryLabel ?? 'Maintenance'
  const requestCount = insight.requestCount ?? 0
  const requestWord = requestCount === 1 ? 'Request' : 'Requests'

  return (
    <div className="sa-enter-scale sa-surface flex flex-col gap-2 rounded-[12px] border border-[#eef2ff] bg-white p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-extrabold uppercase leading-normal tracking-[0.04em] text-[#9E439F]">
          Prevent Future Repairs
        </p>
        <InsightAlertIcon score={insight.score} when="high" />
      </div>
      <div className="flex items-center gap-5">
        <p className="min-w-0 flex-1 text-[16px] font-normal leading-[1.4] text-[#0f172a]">
          {insight.text}
        </p>
        <InsightStrengthMeter score={insight.score} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] leading-normal text-[#64748b]">
        <span>
          {requestCount} {categoryLabel} {requestWord}
        </span>
        <span className="h-3 w-px shrink-0 bg-[#eef2ff]" aria-hidden />
        <span>Last 60 Days</span>
      </div>
    </div>
  )
}

const FEED_BADGE_STYLES: Record<string, string> = {
  maintenance: 'bg-[#f3e8ff] text-[#7c3aed]',
  rent: 'bg-[#fef9c2] text-[#a65f00]',
  move_in: 'bg-[#dbfce7] text-[#008236]',
  move_out: 'bg-[#ffe2e2] text-[#c10007]',
  inspection: 'bg-[#dbeafe] text-[#1447e6]',
  vendor: 'bg-[#e0f2fe] text-[#0069a8]',
  admin: 'bg-[#f3f4f6] text-[#364153]',
}

async function loadOverviewFeedEvents(): Promise<PropertyOperationsTimelineEvent[]> {
  return fetchRecentPropertyOperationsEvents(8)
}

function overviewGreetingSalutation(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function overviewGreetingFirstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/).filter(Boolean)[0]
  return first || null
}

export function AdminOverviewDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const initialOnboardingNotice =
    typeof (location.state as { onboardingNotice?: unknown } | null)?.onboardingNotice ===
    'string'
      ? ((location.state as { onboardingNotice: string }).onboardingNotice)
      : null
  const [onboardingNotice, setOnboardingNotice] = useState<string | null>(
    initialOnboardingNotice,
  )
  useEffect(() => {
    if (initialOnboardingNotice) {
      // Consume the one-shot notice so a refresh/back-nav doesn't resurface it.
      navigate('.', { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { profile: accountHolderProfile } = useSidebarAdminProfile()
  const greetingName = overviewGreetingFirstName(accountHolderProfile?.name)
  const greetingLine = greetingName
    ? `${overviewGreetingSalutation()}, ${greetingName}. See what's happening across your portfolio.`
    : `${overviewGreetingSalutation()}. See what's happening across your portfolio.`
  const [tickets, setTickets] = useState<OverviewTicket[]>([])
  const [vendors, setVendors] = useState<OverviewVendor[]>([])
  const [units, setUnits] = useState<OverviewUnit[]>([])
  const [workflowData, setWorkflowData] =
    useState<AdminWorkflowDashboardData | null>(null)
  const [feedEvents, setFeedEvents] = useState<PropertyOperationsTimelineEvent[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [residents, setResidents] = useState<PropertyHealthResident[]>([])
  const [overviewResidents, setOverviewResidents] = useState<OverviewResident[]>([])
  const [leaseInfoMissing, setLeaseInfoMissing] = useState<LeaseInfoMissingAttention[]>([])
  const [dismissedAttention, setDismissedAttention] = useState<DismissedAttentionIds>({
    ticketIds: new Set(),
    runIds: new Set(),
  })
  const [canonicalProperties, setCanonicalProperties] = useState<PropertyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [escalatedRailTarget, setEscalatedRailTarget] = useState<EscalatedRailTarget | null>(null)
  const [escalatedReview, setEscalatedReview] = useState<SlaOverdueActionReview | null>(null)
  const [escalatedRailLoading, setEscalatedRailLoading] = useState(false)
  const [escalatedRailSaving, setEscalatedRailSaving] = useState(false)
  const [escalatedRailError, setEscalatedRailError] = useState<string | null>(null)
  const [externalVendorSuggestions, setExternalVendorSuggestions] = useState<
    ExternalVendorSuggestionDto[]
  >([])
  const [externalVendorProvidersUsed, setExternalVendorProvidersUsed] = useState<string[]>([])
  const [externalVendorNotice, setExternalVendorNotice] = useState<string | null>(null)
  const [externalVendorDiscoverError, setExternalVendorDiscoverError] = useState<string | null>(
    null,
  )
  const [externalVendorIssueCategory, setExternalVendorIssueCategory] = useState<string | null>(
    null,
  )
  const [externalVendorLocationLabel, setExternalVendorLocationLabel] = useState<string | null>(
    null,
  )
  const [externalVendorAreaLabel, setExternalVendorAreaLabel] = useState<string | null>(null)
  const [findExternalVendorOpen, setFindExternalVendorOpen] = useState(false)
  const [lateRentRailRunId, setLateRentRailRunId] = useState<string | null>(null)
  const [lateRentRailSaving, setLateRentRailSaving] = useState(false)
  const [lateRentRailError, setLateRentRailError] = useState<string | null>(null)
  const [invoicePayReviews, setInvoicePayReviews] = useState<InvoicePaymentReview[]>([])
  const [invoicePayRailId, setInvoicePayRailId] = useState<string | null>(null)
  const [invoicePaySaving, setInvoicePaySaving] = useState(false)
  const [invoicePayError, setInvoicePayError] = useState<string | null>(null)
  const [invoicePaySuccess, setInvoicePaySuccess] =
    useState<InvoicePaymentSuccessDetails | null>(null)
  const [lateRentMessageBrief, setLateRentMessageBrief] =
    useState<LateRentAccountMessageBrief | null>(null)
  const [lateRentMessageSending, setLateRentMessageSending] = useState(false)
  const [lateRentMessageError, setLateRentMessageError] = useState<string | null>(null)
  const [leaseRenewalRailRunId, setLeaseRenewalRailRunId] = useState<string | null>(null)
  const [leaseRenewalRailSaving, setLeaseRenewalRailSaving] = useState(false)
  const [leaseRenewalRailError, setLeaseRenewalRailError] = useState<string | null>(null)
  const [leaseRenewalIncentiveBrief, setLeaseRenewalIncentiveBrief] =
    useState<LeaseRenewalIncentiveBrief | null>(null)
  const [leaseRenewalIncentiveSending, setLeaseRenewalIncentiveSending] = useState(false)
  const [leaseRenewalIncentiveError, setLeaseRenewalIncentiveError] = useState<string | null>(null)
  const [tenantCallFlow, setTenantCallFlow] = useState<{
    name: string
    phone: string
    context: VendorCallContext
    reasonLine: string
  } | null>(null)
  const [awaitingDecisionListOpen, setAwaitingDecisionListOpen] = useState(false)
  const [awaitingDecisionOutcome, setAwaitingDecisionOutcome] =
    useState<AwaitingDecisionOutcome | null>(null)
  const prevAttentionItemsRef = useRef<AttentionItem[]>([])
  const skipAutoOutcomeKeysRef = useRef<Set<string>>(new Set())
  const attentionTrackingReadyRef = useRef(false)
  const allowImportedOperationsRef = useRef(true)
  const invoicePaymentReturnHandledRef = useRef<string | null>(null)
  const invoicePayReviewsRef = useRef(invoicePayReviews)
  invoicePayReviewsRef.current = invoicePayReviews

  const showAwaitingDecisionOutcome = useCallback(
    (outcome: AwaitingDecisionOutcome, itemKey?: string) => {
      if (itemKey) skipAutoOutcomeKeysRef.current.add(itemKey)
      setAwaitingDecisionOutcome(outcome)
    },
    [],
  )

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const paymentStatus = params.get('invoice_payment')
    if (paymentStatus !== 'success' && paymentStatus !== 'cancel') return

    const invoiceId = params.get('invoice_id')?.trim() ?? ''
    const sessionId = params.get('session_id')?.trim() ?? ''
    const handleKey = `${paymentStatus}:${sessionId || invoiceId}`
    if (invoicePaymentReturnHandledRef.current === handleKey) return
    invoicePaymentReturnHandledRef.current = handleKey

    const clearPaymentParams = () => {
      const next = new URLSearchParams(location.search)
      next.delete('invoice_payment')
      next.delete('session_id')
      next.delete('invoice_id')
      next.delete('method')
      const qs = next.toString()
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true })
    }

    if (paymentStatus === 'cancel') {
      if (invoiceId) {
        setInvoicePayRailId(invoiceId)
        setInvoicePayError('Payment canceled. Choose a payment method to try again.')
      }
      clearPaymentParams()
      return
    }

    if (!sessionId) {
      setInvoicePayError('Missing Stripe checkout session after payment.')
      clearPaymentParams()
      return
    }

    let cancelled = false
    setInvoicePaySaving(true)
    setInvoicePayError(null)

    void (async () => {
      try {
        const result = await completeInvoicePaymentCheckout({ sessionId })
        if (cancelled) return

        const paidInvoiceId = result.invoiceId || invoiceId
        const review =
          invoicePayReviewsRef.current.find((r) => r.invoiceId === paidInvoiceId) ?? null
        const ytdPaidTotal = review?.vendorId
          ? await fetchVendorYtdPaidTotal({
              landlordId: getActiveLandlordId(),
              vendorId: review.vendorId,
            })
          : null

        setInvoicePayReviews((prev) => prev.filter((r) => r.invoiceId !== paidInvoiceId))
        setInvoicePaySuccess({
          amountPaid: result.amountPaid || review?.totalCost || 0,
          vendorName: result.vendorName || review?.vendorName || 'Vendor',
          sourceLabel: result.sourceLabel,
          transactionId: result.transactionId,
          paidAt: result.paidAt,
          receiptUrl: result.receiptUrl,
          ytdPaidTotal,
        })
        setInvoicePayRailId(paidInvoiceId)
        skipAutoOutcomeKeysRef.current.add(`invoice-${paidInvoiceId}`)
      } catch (err) {
        if (!cancelled) {
          setInvoicePayError(
            getErrorMessage(err, 'Could not confirm invoice payment.'),
          )
          if (invoiceId) setInvoicePayRailId(invoiceId)
        }
      } finally {
        if (!cancelled) {
          setInvoicePaySaving(false)
          clearPaymentParams()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    let cancelled = false
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      timedOut = true
      setLoading(false)
      setError('Overview is taking too long to load. Try refreshing the page.')
    }, 20_000)

    async function load() {
      if (!supabase) {
        setLoading(false)
        setError('Supabase is not configured — connect a project to see live operations data.')
        return
      }

      setLoading(true)
      setError(null)

      try {
      const landlordId = getActiveLandlordId()

      // Strict rule: guided New Landlord only shows portfolio-matched ops.
      const dashboardSync = await ensureOnboardingDashboardMatchesPortfolio(landlordId)
      if (cancelled) return
      const allowImportedOperations = dashboardSync.allowImportedOperations
      allowImportedOperationsRef.current = allowImportedOperations

      const [
        ticketsResult,
        vendorsResult,
        vendorScoresResult,
        unitsResult,
        workflowResult,
        feedResult,
        healthSignals,
        residentsResult,
        invoicesResult,
        feedbackResult,
        canonicalPropertiesResult,
        leaseInfoMissingResult,
        dismissedAttentionResult,
      ] = await Promise.all([
          allowImportedOperations
            ? supabase
                .from('maintenance_request_enriched')
                .select(
                  'id, created_at, assigned_at, unit, unit_id, building, email, description, issue_category, assigned_vendor_id, vendor_work_status, urgency, severity, priority, due_at, resident_name, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
                )
                .eq('landlord_id', landlordId)
                .order('created_at', { ascending: false })
                .limit(500)
                .then((r) =>
                  r.error
                    ? supabase!
                        .from('maintenance_requests')
                        .select('*')
                        .eq('landlord_id', landlordId)
                        .order('created_at', { ascending: false })
                        .limit(500)
                    : r,
                )
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from('vendors')
            .select('id, name, category, active')
            .eq('landlord_id', landlordId)
            .eq('active', true)
            .limit(500),
          allowImportedOperations
            ? supabase.rpc('get_vendor_scores_for_landlord', { p_landlord_id: landlordId })
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from('units')
            .select('id, unit_label, building, status, property_id, updated_at')
            .eq('landlord_id', landlordId)
            .limit(1000),
          allowImportedOperations
            ? fetchAdminWorkflowDashboard()
            : Promise.resolve(emptyAdminWorkflowDashboardData()),
          loadOverviewFeedEvents(),
          fetchPropertyHealthSignals(),
          supabase
            .from('users')
            .select('id, full_name, unit, building, status, move_in_date, lease_end_date, monthly_rent, balance_due, phone, email')
            .eq('landlord_id', landlordId)
            .neq('status', 'past_resident')
            .limit(2000),
          allowImportedOperations
            ? supabase
                .from('maintenance_invoices')
                .select(
                  'id, maintenance_request_id, total_cost, labor_cost, material_cost, tax_amount, vendor_id, submitted_at, status, invoice_number, document_path',
                )
                .eq('landlord_id', landlordId)
                .eq('status', 'submitted')
                .order('submitted_at', { ascending: false })
                .limit(50)
            : Promise.resolve({ data: [], error: null }),
          allowImportedOperations
            ? supabase
                .from('vendor_feedback')
                .select('maintenance_request_id, rating')
                .eq('landlord_id', landlordId)
                .eq('rater_type', 'resident')
                .gte('rating', 4)
                .limit(200)
            : Promise.resolve({ data: [], error: null }),
          listPropertiesForLandlord(landlordId),
          loadLeaseInfoMissingAttention(landlordId),
          loadDismissedAttentionIds(landlordId),
        ])

      if (cancelled) return

      const vendorNameById: Record<string, string> = {}
      if (!vendorsResult.error) {
        const vendorRows = ((vendorsResult.data ?? []) as Record<string, unknown>[])
          .map((r) => ({
            id: asString(r.id),
            name: asString(r.name),
            category: asString(r.category) || null,
            active: r.active !== false,
          }))
          .filter((v) => v.id && v.name)
        setVendors(vendorRows)
        for (const v of vendorRows) vendorNameById[v.id] = v.name
      } else {
        setVendors([])
      }

      if (!ticketsResult.error) {
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((raw) =>
            normalizeTicketRow(raw, vendorNameById),
          ),
        )
      } else {
        console.error(
          '[admin overview] maintenance requests fetch failed',
          ticketsResult.error.message,
        )
      }

      const ratingByTicket = new Map<string, number>()
      if (!feedbackResult.error) {
        for (const row of (feedbackResult.data ?? []) as Record<string, unknown>[]) {
          const tid = asString(row.maintenance_request_id)
          const rating = Number(row.rating)
          if (!tid || !Number.isFinite(rating)) continue
          ratingByTicket.set(tid, rating)
        }
      }

      const vendorScoreById = new Map<string, { rating: number | null; reviewCount: number }>()
      if (!vendorScoresResult.error) {
        for (const raw of (vendorScoresResult.data ?? []) as Record<string, unknown>[]) {
          const vendorId = asString(raw.vendor_id)
          if (!vendorId) continue
          vendorScoreById.set(vendorId, {
            rating: asFiniteNumber(raw.vendor_score),
            reviewCount: asFiniteNumber(raw.review_count) ?? 0,
          })
        }
      } else if (vendorScoresResult.error) {
        console.warn(
          '[admin overview] get_vendor_scores_for_landlord',
          vendorScoresResult.error.message,
        )
      }

      const ticketRowsForInvoice = !ticketsResult.error
        ? ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((raw) =>
            normalizeTicketRow(raw, vendorNameById),
          )
        : []
      const ticketById = new Map(ticketRowsForInvoice.map((t) => [t.id, t]))

      const payReviews: InvoicePaymentReview[] = []
      if (landlordHasPayments(getActiveLandlordId()) && !invoicesResult.error) {
        for (const row of (invoicesResult.data ?? []) as Record<string, unknown>[]) {
          const invoiceId = asString(row.id)
          const ticketId = asString(row.maintenance_request_id)
          if (!invoiceId || !ticketId) continue
          const rating = ratingByTicket.get(ticketId)
          if (rating == null || rating < 4) continue
          const ticket = ticketById.get(ticketId)
          const vendorId = asString(row.vendor_id)
          const vendorScore = vendorId ? vendorScoreById.get(vendorId) : undefined
          payReviews.push({
            invoiceId,
            maintenanceRequestId: ticketId,
            totalCost: Number(row.total_cost) || 0,
            laborCost: Number(row.labor_cost) || 0,
            materialCost: Number(row.material_cost) || 0,
            taxAmount: Number(row.tax_amount) || 0,
            unit: ticket?.unit ?? '',
            building: ticket?.building ?? null,
            residentName: ticket?.residentName ?? '',
            vendorName:
              (vendorId ? vendorNameById[vendorId] : '') ||
              ticket?.assignedVendorName ||
              'Vendor',
            vendorId: vendorId || null,
            issueCategory: ticket?.issueCategory ?? null,
            submittedAt: asString(row.submitted_at),
            rating,
            invoiceNumber: asString(row.invoice_number) || null,
            documentPath: asString(row.document_path) || null,
            vendorRating: vendorScore?.rating ?? null,
            vendorReviewCount: vendorScore?.reviewCount ?? null,
          })
        }
      }
      setInvoicePayReviews(payReviews)

      if (!unitsResult.error) {
        setUnits(
          ((unitsResult.data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: asString(r.id),
            unitLabel: asString(r.unit_label),
            building: asString(r.building) || null,
            status: asString(r.status).toLowerCase(),
          })),
        )
      }

      setWorkflowData(workflowResult)
      setFeedEvents(feedResult)
      setPmTasks(healthSignals.pmTasks)
      setFeedback(healthSignals.feedback)
      setVendorMetrics(healthSignals.vendorMetrics)

      if (canonicalPropertiesResult.ok) {
        setCanonicalProperties(canonicalPropertiesResult.properties)
      } else {
        setCanonicalProperties([])
      }

      if (!residentsResult.error) {
        const mapped = ((residentsResult.data ?? []) as Record<string, unknown>[])
          .map((raw) => ({
            id: asString(raw.id),
            fullName: asString(raw.full_name) || 'Unnamed resident',
            unit: asString(raw.unit),
            building: asString(raw.building) || null,
            status: asString(raw.status).toLowerCase() || 'active',
            email: asString(raw.email) || null,
            moveInDate: asString(raw.move_in_date) || null,
            leaseEndDate: asString(raw.lease_end_date) || null,
            monthlyRent: asFiniteNumber(raw.monthly_rent) ?? 0,
            balanceDue: asFiniteNumber(raw.balance_due) ?? 0,
            phone: asString(raw.phone) || null,
          }))
          .filter((row) => row.id)
        setResidents(
          mapped.map((row) => ({
            id: row.id,
            fullName: row.fullName,
            unit: row.unit,
            building: row.building,
            status: row.status,
            email: row.email ?? null,
          })),
        )
        setOverviewResidents(mapped)
      } else {
        setResidents([])
        setOverviewResidents([])
      }

      setLeaseInfoMissing(leaseInfoMissingResult)
      setDismissedAttention(dismissedAttentionResult)
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      if (cancelled || timedOut) return
      console.error('[admin overview] load failed', err)
      setError(getErrorMessage(err, 'Could not load overview.'))
    } finally {
      window.clearTimeout(timeoutId)
      if (!cancelled && !timedOut) setLoading(false)
    }
    }

    void load()
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [])

  const now = Date.now()
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000

  const openTickets = useMemo(() => tickets.filter(isTicketOpen), [tickets])

  const canonicalPropertiesForHealth = useMemo(
    (): PropertyHealthCanonicalProperty[] =>
      canonicalProperties.map((property) => ({ id: property.id, name: property.name })),
    [canonicalProperties],
  )

  const propertyIdByBuilding = useMemo(
    () => buildPropertyIdByBuilding(canonicalProperties),
    [canonicalProperties],
  )

  const healthReport = useMemo(() => {
    const healthTickets = mapTicketsForPropertyHealth(
      tickets as unknown as Record<string, unknown>[],
    )
    return buildPropertyHealthReport({
      units: mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[]),
      tickets: healthTickets,
      pmTasks,
      feedback: enrichFeedbackFromTickets(feedback, healthTickets),
      vendorMetrics,
      residents,
      canonicalProperties: canonicalPropertiesForHealth,
      now,
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, residents, canonicalPropertiesForHealth, now])

  const kpis = useMemo(() => {
    const criticalOpen = openTickets.filter(isTicketCritical).length
    const criticalRecent = countCreatedBetween(
      tickets,
      now - fourWeeksMs,
      now,
      isTicketCritical,
    )
    const criticalPrevious = countCreatedBetween(
      tickets,
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
      isTicketCritical,
    )

    // Active operations = every workflow run currently in flight, regardless
    // of type (maintenance, rent collection, move-ins, move-outs, inspections).
    const opsNowSnapshot = snapshotActiveOperations(workflowData, now)
    const opsPreviousSnapshot = snapshotActiveOperations(
      workflowData,
      now - fourWeeksMs,
    )
    const activeOps = opsNowSnapshot.total
    const activeOpsBreakdown = opsNowSnapshot.lines.map((line) => ({
      label: line.label,
      count: line.count,
    }))

    const propertyHealth = healthReport.portfolio?.score ?? null
    const propertyHealthDelta = healthReport.portfolioDelta

    const assigned = tickets.filter((t) => t.assignedVendorId)
    const responded = assigned.filter(
      (t) => t.vendorWorkStatus && t.vendorWorkStatus !== 'pending_accept',
    )
    const vendorResponse = assigned.length
      ? Math.round((responded.length / assigned.length) * 100)
      : null

    // Response rate among tickets created in each 4-week window.
    const responseRateBetween = (fromMs: number, toMs: number): number | null => {
      const windowAssigned = assigned.filter((t) => {
        const ts = new Date(t.createdAt).getTime()
        return !Number.isNaN(ts) && ts >= fromMs && ts < toMs
      })
      if (!windowAssigned.length) return null
      const windowResponded = windowAssigned.filter(
        (t) => t.vendorWorkStatus && t.vendorWorkStatus !== 'pending_accept',
      )
      return Math.round((windowResponded.length / windowAssigned.length) * 100)
    }
    const responseRecent = responseRateBetween(now - fourWeeksMs, now)
    const responsePrevious = responseRateBetween(
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
    )
    const vendorResponseDelta =
      responseRecent != null && responsePrevious != null
        ? responseRecent - responsePrevious
        : null

    // YTD maintenance cost: total spend on completed maintenance jobs from
    // Jan 1 (local) through now. Uses extracted invoice totals when present,
    // else the estimate proxy, attributed to each job's completion date.
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime()
    const completedJobs = tickets.filter(isCompletedJob)
    const spendBetween = (fromMs: number, toMs: number): number =>
      completedJobs.reduce((sum, t) => {
        const at = ticketSpendDate(t)
        if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
        return sum + ticketSpend(t)
      }, 0)
    const ytdMaintenanceCost = Math.round(spendBetween(startOfYear, now))
    // 4-week-over-4-week change in completed-job spend (rising spend = bad).
    const ytdMaintenanceCostDelta = Math.round(
      spendBetween(now - fourWeeksMs, now) -
        spendBetween(now - 2 * fourWeeksMs, now - fourWeeksMs),
    )

    return {
      criticalOpen,
      criticalDelta: criticalRecent - criticalPrevious,
      activeOps,
      activeOpsDelta: workflowData
        ? opsNowSnapshot.total - opsPreviousSnapshot.total
        : null,
      activeOpsBreakdown,
      propertyHealth,
      propertyHealthDelta,
      vendorResponse,
      vendorResponseDelta,
      ytdMaintenanceCost,
      ytdMaintenanceCostDelta,
    }
  }, [tickets, openTickets, units, workflowData, healthReport, now, fourWeeksMs])

  const slaOverdueTickets = useMemo(
    () =>
      openTickets
        .filter(isSlaOverdueOpenTicket)
        .sort((a, b) => {
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : 0
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : 0
          return aDue - bDue
        }),
    [openTickets],
  )

  const slaEscalatedNoVendorKeys = useMemo(
    () =>
      new Set(
        (workflowData?.escalated ?? [])
          .filter((r) => isMaintenanceAdminVendorEscalationReason(r.escalationReason))
          .map((r) => r.entityId)
          .filter(Boolean),
      ),
    [workflowData],
  )

  useEffect(() => {
    if (loading) return
    const url = resolveSlaAutoReassignUrl()
    const secret = getAdminEdgeSecret()
    if (!url || !secret || slaOverdueTickets.length === 0) return

    const toAuto = slaOverdueTickets.filter(
      (ticket) =>
        !slaEscalatedNoVendorKeys.has(ticket.id) &&
        ticketHasRosterAlternative(ticket, vendors, units),
    )
    if (toAuto.length === 0) return

    let cancelled = false
    void (async () => {
      let anyReassigned = false
      for (const ticket of toAuto) {
        if (cancelled) break
        try {
          const result = await postSlaAutoReassign({ url, secret, ticketId: ticket.id })
          if (result.outcome === 'reassigned') anyReassigned = true
        } catch (err) {
          console.warn('[admin overview] sla auto-reassign', ticket.id, err)
        }
      }
      if (cancelled || !anyReassigned || !supabase) return

      const landlordId = getActiveLandlordId()
      const allowImportedOperations = allowImportedOperationsRef.current
      const [ticketsResult, feedResult, workflowResult] = await Promise.all([
        allowImportedOperations
          ? supabase
              .from('maintenance_request_enriched')
              .select(
                'id, created_at, assigned_at, unit, unit_id, building, description, issue_category, assigned_vendor_id, vendor_work_status, urgency, severity, priority, due_at, resident_name, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
              )
              .eq('landlord_id', landlordId)
              .order('created_at', { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
        loadOverviewFeedEvents(),
        allowImportedOperations
          ? fetchAdminWorkflowDashboard()
          : Promise.resolve(emptyAdminWorkflowDashboardData()),
      ])

      if (cancelled) return
      setFeedEvents(feedResult)
      setWorkflowData(workflowResult)
      if (!ticketsResult.error) {
        const vendorNameById = Object.fromEntries(vendors.map((v) => [v.id, v.name]))
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((raw) =>
            normalizeTicketRow(raw, vendorNameById),
          ),
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loading, slaOverdueTickets, slaEscalatedNoVendorKeys, vendors, units])

  const openEscalatedRailForTicket = useCallback((ticketId: string) => {
    setExternalVendorSuggestions([])
    setExternalVendorDiscoverError(null)
    setExternalVendorNotice(null)
    setFindExternalVendorOpen(false)
    setEscalatedRailTarget({ kind: 'ticket', ticketId, preferExternalVendor: true })
    setEscalatedRailError(null)
  }, [])

  const openEscalatedRailForRun = useCallback((runId: string, preferExternalVendor = false) => {
    setExternalVendorSuggestions([])
    setExternalVendorDiscoverError(null)
    setExternalVendorNotice(null)
    setFindExternalVendorOpen(false)
    setEscalatedRailTarget({ kind: 'workflow', runId, preferExternalVendor })
    setEscalatedRailError(null)
  }, [])

  const lateRentReviewRuns = useMemo(
    () => (workflowData ? collectLateRentReviewRuns(workflowData) : []),
    [workflowData],
  )

  const openFeedTarget = useCallback(
    (target: FeedTooltipDestination) => {
      if (target.kind === 'property') {
        navigate(target.path)
        return
      }
      navigate(workflowOperationsPath(target.runId))
    },
    [navigate],
  )

  const openLateRentRail = useCallback((runId: string) => {
    setLateRentRailRunId(runId)
    setLateRentRailError(null)
    setLateRentMessageBrief(null)
    setLateRentMessageError(null)
  }, [])

  const closeLateRentMessageRail = useCallback(() => {
    if (lateRentMessageSending) return
    setLateRentMessageBrief(null)
    setLateRentMessageError(null)
  }, [lateRentMessageSending])

  const closeLateRentRail = useCallback(() => {
    if (lateRentMessageSending) return
    setLateRentRailRunId(null)
    setLateRentRailError(null)
    setLateRentMessageBrief(null)
    setLateRentMessageError(null)
  }, [lateRentMessageSending])

  const openLeaseRenewalRail = useCallback((runId: string) => {
    setLeaseRenewalRailRunId(runId)
    setLeaseRenewalRailError(null)
  }, [])

  const closeLeaseRenewalIncentiveRail = useCallback(() => {
    if (leaseRenewalIncentiveSending) return
    setLeaseRenewalIncentiveBrief(null)
    setLeaseRenewalIncentiveError(null)
  }, [leaseRenewalIncentiveSending])

  const closeLeaseRenewalRail = useCallback(() => {
    if (leaseRenewalIncentiveSending) return
    setLeaseRenewalRailRunId(null)
    setLeaseRenewalRailError(null)
    setLeaseRenewalIncentiveBrief(null)
    setLeaseRenewalIncentiveError(null)
  }, [leaseRenewalIncentiveSending])

  const lateRentReview = useMemo<LateRentAccountReview | null>(() => {
    if (!workflowData || !lateRentRailRunId) return null
    const row =
      lateRentReviewRuns.find((entry) => entry.id === lateRentRailRunId) ??
      workflowData.rentCollection.runs.find((entry) => entry.id === lateRentRailRunId)
    if (!row) return null
    const resident = row.residentId
      ? overviewResidents.find((entry) => entry.id === row.residentId) ?? null
      : null
    return buildLateRentAccountReview(
      row,
      resident
        ? {
            status: resident.status,
            moveInDate: resident.moveInDate,
            balanceDue: resident.balanceDue,
            phone: resident.phone,
          }
        : null,
    )
  }, [workflowData, lateRentReviewRuns, lateRentRailRunId, overviewResidents])

  const leaseRenewalReview = useMemo<LeaseRenewalEscalatedReview | null>(() => {
    if (!workflowData || !leaseRenewalRailRunId) return null
    const run = workflowData.escalated.find((entry) => entry.id === leaseRenewalRailRunId)
    if (!run || !isLeaseRenewalEscalatedRun(run)) return null
    const resident = run.residentId
      ? overviewResidents.find((entry) => entry.id === run.residentId) ?? null
      : null
    return buildLeaseRenewalEscalatedReview(
      run,
      workflowData.runMetadata[run.id],
      resident ? { phone: resident.phone } : null,
    )
  }, [workflowData, leaseRenewalRailRunId, overviewResidents])

  const allAttentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    const completedTicketIds = collectCompletedWorkOrderTicketIds({
      tickets,
      workflowData,
    })

    for (const ticket of slaOverdueTickets) {
      if (completedTicketIds.has(ticket.id)) continue
      if (slaEscalatedNoVendorKeys.has(ticket.id)) continue
      if (ticketHasRosterAlternative(ticket, vendors, units)) continue
      if (isNeedsAttentionDismissed(dismissedAttention, { ticketId: ticket.id })) continue
      const building =
        ticket.building ??
        units.find(
          (u) => normalizeUnitLabel(u.unitLabel) === normalizeUnitLabel(ticket.unit),
        )?.building ??
        null
      items.push({
        key: `sla-${ticket.id}`,
        badge: isTicketCritical(ticket) ? 'critical' : 'warning',
        title: 'No vendor available — response time exceeded',
        context: formatLocationContextLabel({
          propertyLabel: building,
          unitLabel: ticket.unit,
          residentName: ticket.residentName,
        }),
        meta: ticket.dueAt
          ? `${resolveMaintenanceTypeLabel(ticket.issueCategory, ticket)} · Past due ${formatRelativeTime(ticket.dueAt)}`
          : `${resolveMaintenanceTypeLabel(ticket.issueCategory, ticket)} · Past response time`,
        actionLabel: 'Assign vendor',
        actionStyle: 'alert',
        onAction: () => openEscalatedRailForTicket(ticket.id),
      })
    }

    if (workflowData) {
      for (const run of workflowData.escalated) {
        const adminVendorReason = isMaintenanceAdminVendorEscalationReason(run.escalationReason)
          ? run.escalationReason
          : null
        const needsVendor = adminVendorReason != null
        const isLeaseRenewal = isLeaseRenewalEscalatedRun(run)
        const ticketId = maintenanceTicketIdFromWorkflowRun({
          ...run,
          metadata: workflowData.runMetadata[run.id],
        })
        const linkedTicket = ticketId
          ? tickets.find((row) => row.id === ticketId) ?? null
          : null
        if (
          shouldOmitEscalatedRunFromNeedsAttention({
            run,
            metadata: workflowData.runMetadata[run.id],
            linkedTicketVendorWorkStatus: linkedTicket?.vendorWorkStatus ?? null,
            completedTicketIds,
          })
        ) {
          continue
        }
        if (
          needsVendor &&
          isNeedsAttentionDismissed(dismissedAttention, {
            ticketId: ticketId ?? run.entityId,
            runId: run.id,
          })
        ) {
          continue
        }
        const issueCategory = run.issueCategory ?? linkedTicket?.issueCategory ?? null
        items.push({
          key: `run-${run.id}`,
          badge: needsVendor || isLeaseRenewal ? 'critical' : 'warning',
          title: needsVendor
            ? maintenanceAdminVendorAttentionTitle(adminVendorReason)
            : isLeaseRenewal
              ? 'Lease Renewal Escalated'
              : `${run.templateName} Escalated`,
          context: formatLocationContextLabel({
            propertyLabel: run.propertyLabel,
            unitLabel: run.unitLabel,
            residentName: run.residentName,
          }),
          meta: needsVendor
            ? maintenanceAdminVendorAttentionMeta(adminVendorReason, issueCategory)
            : run.lastEventAt
              ? isLeaseRenewal
                ? `No tenant response ${formatRelativeTime(run.lastEventAt)}`
                : `Escalated ${formatRelativeTime(run.lastEventAt)}`
              : 'Awaiting input',
          actionLabel: needsVendor ? 'Assign vendor' : 'Review',
          onAction: isLeaseRenewal
            ? () => openLeaseRenewalRail(run.id)
            : needsVendor
              ? () => openEscalatedRailForRun(run.id, true)
              : () => openEscalatedRailForRun(run.id),
          actionStyle: needsVendor ? 'alert' : undefined,
        })
      }

      for (const row of lateRentReviewRuns) {
        items.push({
          key: `rent-${row.id}`,
          badge: row.status === 'escalated' ? 'critical' : 'warning',
          title: 'Late Rent Escalation',
          context: formatLocationContextLabel({
            propertyLabel: row.propertyLabel,
            unitLabel: row.unitLabel,
            residentName: row.residentName,
          }),
          meta: row.rentDueDate
            ? `Overdue since ${new Date(row.rentDueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : 'Overdue',
          actionLabel: 'Review',
          onAction: () => openLateRentRail(row.id),
        })
      }
    }

    for (const missing of leaseInfoMissing) {
      const resident = missing.residentId
        ? overviewResidents.find((entry) => entry.id === missing.residentId) ?? null
        : null
      if (
        resident &&
        (resident.moveInDate || resident.leaseEndDate || resident.monthlyRent > 0)
      ) {
        continue
      }
      const building = resident?.building ?? null
      const path = resident
        ? propertyResidentDetailPathForBuilding(
            resident.building || resident.unit || 'property',
            resident.id,
            propertyIdByBuilding,
          )
        : '/admin'
      items.push({
        key: `lease-info-${missing.residentId ?? missing.id}`,
        badge: 'warning',
        title: 'Leasing information is missing',
        context: formatLocationContextLabel({
          propertyLabel: building,
          unitLabel: resident?.unit ?? null,
          residentName: resident?.fullName ?? null,
        }),
        meta: missing.message?.trim() || 'A resident asked about their lease over text.',
        actionLabel: 'Review resident',
        onAction: () => navigate(path),
      })
    }

    for (const inv of invoicePayReviews) {
      if (completedTicketIds.has(inv.maintenanceRequestId)) continue
      const totalLabel = inv.totalCost.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      })
      items.push({
        key: `invoice-${inv.invoiceId}`,
        badge: 'warning',
        title: 'Invoice ready to pay',
        context: formatLocationContextLabel({
          propertyLabel: inv.building,
          unitLabel: inv.unit,
          residentName: inv.residentName,
        }),
        meta: `${inv.vendorName} · ${totalLabel}${inv.rating != null ? ` · Rated ${inv.rating}/5` : ''}`,
        actionLabel: 'Review & pay',
        onAction: () => {
          setInvoicePayError(null)
          setInvoicePayRailId(inv.invoiceId)
        },
      })
    }

    return items.sort((a, b) => (a.badge === b.badge ? 0 : a.badge === 'critical' ? -1 : 1))
  }, [workflowData, slaOverdueTickets, slaEscalatedNoVendorKeys, dismissedAttention, units, vendors, tickets, lateRentReviewRuns, invoicePayReviews, leaseInfoMissing, overviewResidents, propertyIdByBuilding, navigate, openEscalatedRailForTicket, openEscalatedRailForRun, openLateRentRail, openLeaseRenewalRail])

  const attentionItems = useMemo(() => allAttentionItems.slice(0, 4), [allAttentionItems])

  const handleAwaitingDecisionItemAction = useCallback((item: AttentionItem) => {
    setAwaitingDecisionListOpen(false)
    item.onAction?.()
  }, [])

  useEffect(() => {
    if (loading) return

    const prev = prevAttentionItemsRef.current
    const currentKeys = new Set(allAttentionItems.map((item) => item.key))

    if (!attentionTrackingReadyRef.current) {
      attentionTrackingReadyRef.current = true
      prevAttentionItemsRef.current = allAttentionItems
      return
    }

    for (const item of prev) {
      if (currentKeys.has(item.key)) continue
      if (skipAutoOutcomeKeysRef.current.has(item.key)) continue
      showAwaitingDecisionOutcome(
        buildAutoRemovedAttentionOutcome({
          title: item.title,
          context: item.context,
          meta: item.meta,
        }),
        item.key,
      )
      break
    }

    skipAutoOutcomeKeysRef.current = new Set(
      [...skipAutoOutcomeKeysRef.current].filter((key) => currentKeys.has(key)),
    )
    prevAttentionItemsRef.current = allAttentionItems
  }, [loading, allAttentionItems, showAwaitingDecisionOutcome])

  useEffect(() => {
    if (!escalatedRailTarget) {
      setEscalatedReview(null)
      setEscalatedRailLoading(false)
      setExternalVendorSuggestions([])
      setExternalVendorProvidersUsed([])
      setExternalVendorNotice(null)
      setExternalVendorDiscoverError(null)
      setExternalVendorIssueCategory(null)
      setExternalVendorLocationLabel(null)
      setExternalVendorAreaLabel(null)
      setFindExternalVendorOpen(false)
      return
    }

    let cancelled = false
    let ticketIdForAction: string | null = null
    let builtReview: SlaOverdueActionReview | null = null

    if (escalatedRailTarget.kind === 'ticket') {
      const ticket = tickets.find((t) => t.id === escalatedRailTarget.ticketId)
      if (!ticket) {
        setEscalatedReview(null)
        return
      }
      ticketIdForAction = ticket.id
      const ticketInput = overviewTicketToInput(ticket, units)
      builtReview =
        buildSlaOverdueActionReview(ticketInput, vendors, vendorMetrics) ??
        buildExternalVendorFallbackReview(ticketInput)
    } else {
      const run = workflowData?.escalated.find((r) => r.id === escalatedRailTarget.runId)
      if (!run) {
        setEscalatedReview(null)
        return
      }
      const linkedTicket =
        run.entityType === 'maintenance_request' && run.entityId
          ? tickets.find((t) => t.id === run.entityId) ?? null
          : null
      if (linkedTicket) ticketIdForAction = linkedTicket.id
      builtReview =
        buildEscalatedWorkflowReview(
          run,
          linkedTicket ? overviewTicketToInput(linkedTicket, units) : null,
          vendors,
          vendorMetrics,
        ) ??
        (linkedTicket
          ? buildExternalVendorFallbackReview(overviewTicketToInput(linkedTicket, units), {
              workflowRunId: run.id,
            })
          : null)
      if (!builtReview) {
        setEscalatedRailError('Could not load escalation details for this workflow.')
        setEscalatedRailLoading(false)
        return
      }
    }

    const preferExternalVendor =
      escalatedRailTarget.preferExternalVendor === true || builtReview.noVendorOnRoster

    if (builtReview && !preferExternalVendor && ticketIdForAction) {
      const autoUrl = resolveSlaAutoReassignUrl()
      const secret = getAdminEdgeSecret()
      setEscalatedRailLoading(true)
      if (autoUrl && secret) {
        void postSlaAutoReassign({ url: autoUrl, secret, ticketId: ticketIdForAction })
          .then(async (result) => {
            if (cancelled) return
            if (result.outcome === 'reassigned') {
              setFeedEvents(await loadOverviewFeedEvents())
            }
            setEscalatedRailTarget(null)
          })
          .catch((err) => {
            if (cancelled) return
            console.warn('[admin overview] sla auto-reassign rail', err)
            setEscalatedRailError(getErrorMessage(err, "Couldn't reassign the vendor. Please try again."))
          })
          .finally(() => {
            if (!cancelled) setEscalatedRailLoading(false)
          })
      } else {
        setEscalatedRailTarget(null)
        setEscalatedRailLoading(false)
      }
      return () => {
        cancelled = true
      }
    }

    setEscalatedReview(builtReview)
    setEscalatedRailLoading(true)
    setExternalVendorSuggestions([])
    setExternalVendorProvidersUsed([])
    setExternalVendorNotice(null)
    setExternalVendorDiscoverError(null)
    setExternalVendorLocationLabel(builtReview.locationLabel)

    if (preferExternalVendor) {
      const linkedTicket =
        escalatedRailTarget.kind === 'ticket'
          ? tickets.find((t) => t.id === escalatedRailTarget.ticketId)
          : (() => {
              const run = workflowData?.escalated.find((r) => r.id === escalatedRailTarget.runId)
              return run?.entityType === 'maintenance_request' && run.entityId
                ? tickets.find((t) => t.id === run.entityId) ?? null
                : null
            })()
      setExternalVendorIssueCategory(linkedTicket?.issueCategory ?? null)
    }

    const discoverUrl = resolveDiscoverExternalVendorsUrl()
    const secret = getAdminEdgeSecret()
    if (!discoverUrl || !secret || !ticketIdForAction) {
      setEscalatedRailLoading(false)
      if (preferExternalVendor) {
        setExternalVendorDiscoverError(
          !ticketIdForAction
            ? 'Could not link this escalation to a maintenance ticket.'
            : 'External vendor search is not configured (check VITE_ADMIN_REASSIGN_SECRET).',
        )
      }
      return () => {
        cancelled = true
      }
    }

    void postDiscoverExternalVendors({
      url: discoverUrl,
      secret,
      ticketId: ticketIdForAction,
    })
      .then((result) => {
        if (cancelled) return
        const sanitized = sanitizeExternalVendorDiscoveryForAccount({
          suggestions: result.suggestions ?? [],
          providersUsed: result.providersUsed ?? [],
          notice: result.notice,
        })
        const rankedSuggestions = enrichExternalVendorSuggestions(
          sanitized.suggestions,
          result.issueCategory,
          result.locationLabel,
        )
        setExternalVendorSuggestions(sanitized.suggestions)
        setExternalVendorProvidersUsed(sanitized.providersUsed)
        if (sanitized.notice) setExternalVendorNotice(sanitized.notice)
        if (result.areaLabel) setExternalVendorAreaLabel(result.areaLabel)
        if (result.issueCategory !== undefined) {
          setExternalVendorIssueCategory(result.issueCategory)
        }
        const pick = rankedSuggestions[0]
        if (!pick) return
        setEscalatedReview((prev) => {
          if (!prev) return prev
          const meta = [
            pick.rating != null ? `${pick.rating.toFixed(1)}★` : null,
            pick.priceLabel,
          ]
            .filter(Boolean)
            .join(' · ')
          return {
            ...prev,
            suggestion: {
              vendorId: '',
              vendorName: pick.name,
              rating: pick.rating,
              etaMinutes: pick.etaMinutes ?? null,
            },
            suggestionLine: `Assign external vendor ${pick.name}${meta ? ` (${meta})` : ''}`,
          }
        })
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[admin overview] discover external vendors', err)
        const message = getErrorMessage(err, "Couldn't find vendors nearby. Please try again.")
        setEscalatedRailError(message)
        setExternalVendorDiscoverError(message)
      })
      .finally(() => {
        if (!cancelled) setEscalatedRailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [escalatedRailTarget, tickets, units, vendors, vendorMetrics, workflowData])

  const handleEscalatedTakeAction = useCallback(
    async (review: SlaOverdueActionReview) => {
      if (review.takeActionMode === 'workflows') {
        navigate(review.workflowRunId ? `/admin/workflows?run=${review.workflowRunId}` : '/admin/workflows')
        setEscalatedRailTarget(null)
        return
      }

      if (
        review.takeActionMode === 'assign_vendor' ||
        review.takeActionMode === 'external_vendor' ||
        review.takeActionMode === 'reassign'
      ) {
        if (escalatedRailLoading) {
          setEscalatedRailError('Vendor search is still loading.')
          return
        }
        setEscalatedRailError(null)
        setFindExternalVendorOpen(true)
        return
      }

      setEscalatedRailError('This ticket is handled automatically when a roster vendor is available.')
    },
    [navigate, escalatedRailLoading],
  )

  const closeEscalatedRail = useCallback(() => {
    if (escalatedRailSaving) return
    setFindExternalVendorOpen(false)
    setEscalatedRailTarget(null)
    setEscalatedRailError(null)
  }, [escalatedRailSaving])

  const closeEscalatedVendorFlow = useCallback(() => {
    closeEscalatedRail()
  }, [closeEscalatedRail])

  const handleDeleteEscalatedAttention = useCallback(
    async (review: SlaOverdueActionReview) => {
      if (escalatedRailSaving) return
      const ticketId = review.ticketId?.trim() || null
      const workflowRunId = review.workflowRunId?.trim() || null
      if (!ticketId && !workflowRunId) {
        setEscalatedRailError('Nothing to remove.')
        return
      }

      const relatedWorkflowRunIds = (workflowData?.escalated ?? [])
        .filter(
          (run) =>
            isMaintenanceAdminVendorEscalationReason(run.escalationReason) &&
            ((ticketId && run.entityId === ticketId) || run.id === workflowRunId),
        )
        .map((run) => run.id)

      setEscalatedRailSaving(true)
      setEscalatedRailError(null)
      try {
        const result = await dismissNeedsAttentionItem({
          ticketId,
          workflowRunId,
          relatedWorkflowRunIds,
          locationLabel: review.locationLabel,
        })
        if (!result.ok) {
          setEscalatedRailError(result.error)
          return
        }

        const dismissedRunIds = result.runIds
        setDismissedAttention((prev) => {
          const ticketIds = new Set(prev.ticketIds)
          const runIds = new Set(prev.runIds)
          if (ticketId) ticketIds.add(ticketId)
          if (workflowRunId) runIds.add(workflowRunId)
          for (const id of dismissedRunIds) runIds.add(id)
          return { ticketIds, runIds }
        })
        if (ticketId) skipAutoOutcomeKeysRef.current.add(`sla-${ticketId}`)
        if (workflowRunId) skipAutoOutcomeKeysRef.current.add(`run-${workflowRunId}`)
        for (const id of dismissedRunIds) {
          skipAutoOutcomeKeysRef.current.add(`run-${id}`)
        }

        setFindExternalVendorOpen(false)
        setEscalatedRailTarget(null)
        setEscalatedRailError(null)
        if (allowImportedOperationsRef.current) {
          setWorkflowData(await fetchAdminWorkflowDashboard())
          setFeedEvents(await loadOverviewFeedEvents())
        }
        showAwaitingDecisionOutcome(
          buildAttentionDeletedOutcome({
            operationTitle: review.headerTitle,
            context: review.locationLabel,
          }),
          ticketId ? `sla-${ticketId}` : workflowRunId ? `run-${workflowRunId}` : undefined,
        )
      } catch (err) {
        setEscalatedRailError(getErrorMessage(err, 'Something went wrong. Please try again.'))
      } finally {
        setEscalatedRailSaving(false)
      }
    },
    [escalatedRailSaving, workflowData, showAwaitingDecisionOutcome],
  )

  const backFromFindExternalVendor = useCallback(() => {
    if (escalatedRailSaving) return
    setFindExternalVendorOpen(false)
    setEscalatedRailError(null)
  }, [escalatedRailSaving])

  const handleExternalVendorSelect = useCallback(
    async (
      pick: ExternalVendorSuggestionDto,
      compliance?: import('@/components/ExternalVendorVerificationView').ExternalVendorComplianceSnapshot,
    ) => {
      const ticketId =
        escalatedReview?.ticketId ??
        (escalatedRailTarget?.kind === 'ticket' ? escalatedRailTarget.ticketId : null)
      if (!ticketId) {
        setEscalatedRailError('Could not link this vendor to a maintenance ticket.')
        return
      }
      const secret = getAdminEdgeSecret()
      const reassignUrl = resolveReassignExternalVendorUrl()
      if (!secret || !reassignUrl) {
        setEscalatedRailError('External reassign is not configured.')
        return
      }

      setEscalatedRailSaving(true)
      setEscalatedRailError(null)
      try {
        const result = await postReassignExternalVendor({
          url: reassignUrl,
          secret,
          ticketId,
          vendorName: pick.name,
          rating: pick.rating,
          reviewCount: pick.reviewCount,
          priceLabel: pick.priceLabel,
          sources: pick.sources,
          compliance: compliance
            ? {
                license_status: compliance.licenseStatus,
                license_number: compliance.licenseNumber,
                license_simulated: compliance.licenseSimulated,
                license_source: compliance.licenseSource,
                coi_status: compliance.coiStatus,
                coi_simulated: compliance.coiSimulated,
                coi_source: compliance.coiSource,
                monitoring_active: compliance.monitoringActive,
              }
            : null,
        })
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId
              ? {
                  ...t,
                  assignedVendorId: result.assigned_vendor_id,
                  assignedVendorName: pick.name,
                  vendorWorkStatus: 'pending_accept',
                }
              : t,
          ),
        )
        setFeedEvents(await loadOverviewFeedEvents())
        setFindExternalVendorOpen(false)
        setEscalatedRailTarget(null)
        setExternalVendorSuggestions([])
        const locationLabel =
          externalVendorLocationLabel ??
          escalatedReview?.locationLabel ??
          tickets.find((t) => t.id === ticketId)?.unit ??
          'Property · Unit'
        showAwaitingDecisionOutcome(
          buildVendorAssignedOutcome({
            operationTitle: escalatedReview?.headerTitle ?? 'No vendor available — response time exceeded',
            context: locationLabel,
            vendorName: pick.name,
            external: true,
          }),
          `sla-${ticketId}`,
        )
      } catch (err) {
        setEscalatedRailError(getErrorMessage(err, "Couldn't assign that vendor. Please try again."))
      } finally {
        setEscalatedRailSaving(false)
      }
    },
    [
      escalatedReview,
      escalatedRailTarget,
      externalVendorLocationLabel,
      tickets,
      showAwaitingDecisionOutcome,
    ],
  )

  const handleLateRentAction = useCallback(
    async (action: LateRentAccountAction, review: LateRentAccountReview) => {
      setLateRentRailSaving(true)
      setLateRentRailError(null)
      try {
        const result = await applyLateRentAccountAction(action, review, getActiveLandlordId())
        if (!result.ok) {
          setLateRentRailError(result.error)
          return
        }

        if (action === 'offer_payment_plan') {
          if (review.paymentPlanSmsSent) {
            setLateRentRailError('A payment plan was already sent for this account.')
            return
          }
          setLateRentMessageError(null)
          setLateRentMessageBrief(buildLateRentPaymentPlanBrief(review))
          return
        }

        if (action === 'waive_late_fee') {
          if (review.lateFeeWaiverSmsSent) {
            setLateRentRailError('A late fee waiver was already sent for this account.')
            return
          }
          setLateRentMessageError(null)
          setLateRentMessageBrief(buildLateRentWaiveLateFeeBrief(review))
          return
        }

        if (action === 'mark_payment_received' && review.residentId) {
          setOverviewResidents((prev) =>
            prev.map((resident) =>
              resident.id === review.residentId
                ? { ...resident, balanceDue: 0 }
                : resident,
            ),
          )
        }

        const nextWorkflowData = await fetchAdminWorkflowDashboard()
        setWorkflowData(nextWorkflowData)
        closeLateRentRail()
        showAwaitingDecisionOutcome(
          buildLateRentActionOutcome(action, review),
          `rent-${review.workflowRunId}`,
        )
      } catch (err) {
        setLateRentRailError(getErrorMessage(err, "That action didn't work. Please try again."))
      } finally {
        setLateRentRailSaving(false)
      }
    },
    [closeLateRentRail, showAwaitingDecisionOutcome],
  )

  const handleLateRentMessageSend = useCallback(
    async (
      brief: LateRentAccountMessageBrief,
      message: string,
      options?: { installments?: number },
    ) => {
      setLateRentMessageSending(true)
      setLateRentMessageError(null)
      try {
        const result = await sendLateRentAccountMessage(
          brief,
          message,
          getActiveLandlordId(),
          options,
        )
        if (!result.ok) {
          setLateRentMessageError(result.error)
          return
        }
        // Payment plan / waive late fee stay in Needs Your Attention — no
        // acknowledgement modal until Mark payment received.
        setLateRentMessageBrief(appendLateRentSentMessage(brief, message))
        // Waive late fee adjusts users.balance_due + open rent run amounts.
        if (
          brief.action === 'waive_late_fee' &&
          brief.residentId &&
          result.balanceDueAfterWaiver != null
        ) {
          const nextBalance = result.balanceDueAfterWaiver
          setOverviewResidents((prev) =>
            prev.map((resident) =>
              resident.id === brief.residentId
                ? { ...resident, balanceDue: nextBalance }
                : resident,
            ),
          )
        }
        const nextWorkflowData = await fetchAdminWorkflowDashboard()
        setWorkflowData(nextWorkflowData)
      } catch (err) {
        setLateRentMessageError(getErrorMessage(err, "Couldn't send that message. Please try again."))
      } finally {
        setLateRentMessageSending(false)
      }
    },
    [],
  )

  const handleLeaseRenewalAction = useCallback(
    async (action: LeaseRenewalEscalatedAction, review: LeaseRenewalEscalatedReview) => {
      setLeaseRenewalRailSaving(true)
      setLeaseRenewalRailError(null)
      try {
        const result = await applyLeaseRenewalEscalatedAction(action, review, getActiveLandlordId())
        if (!result.ok) {
          setLeaseRenewalRailError(result.error)
          return
        }

        if (action === 'mark_resolved' || action === 'trigger_move_out_prep') {
          setWorkflowData(await fetchAdminWorkflowDashboard())
          closeLeaseRenewalRail()
          showAwaitingDecisionOutcome(
            buildLeaseRenewalActionOutcome(action, review, {
              moveOutRunId: result.moveOutRunId,
            }),
            `run-${review.workflowRunId}`,
          )
          return
        }

        if (action === 'offer_renewal_incentive') {
          const run = workflowData?.escalated.find((entry) => entry.id === review.workflowRunId)
          const residentName =
            run?.residentName?.trim() ||
            (review.residentId
              ? overviewResidents.find((entry) => entry.id === review.residentId)?.fullName
              : null) ||
            'Resident'
          setLeaseRenewalIncentiveError(null)
          setLeaseRenewalIncentiveBrief(
            buildLeaseRenewalIncentiveBrief(review, { residentName }),
          )
          return
        }

        if (action === 'call_tenant') {
          if (!review.residentPhone) {
            setLeaseRenewalRailError('No phone number on file for this tenant.')
            return
          }
          const run = workflowData?.escalated.find((entry) => entry.id === review.workflowRunId)
          const residentName =
            run?.residentName?.trim() ||
            (review.residentId
              ? overviewResidents.find((entry) => entry.id === review.residentId)?.fullName
              : null) ||
            'Resident'
          closeLeaseRenewalRail()
          setTenantCallFlow({
            name: residentName,
            phone: review.residentPhone,
            context: {
              workOrderRef: review.workflowRef,
              locationLabel: review.locationLabel,
              residentName,
              issueCategory: 'lease_renewal',
            },
            reasonLine: buildLeaseRenewalCallReasonLine(review.workflowRef),
          })
        }
      } catch (err) {
        setLeaseRenewalRailError(getErrorMessage(err, "That action didn't work. Please try again."))
      } finally {
        setLeaseRenewalRailSaving(false)
      }
    },
    [
      closeLeaseRenewalRail,
      overviewResidents,
      showAwaitingDecisionOutcome,
      workflowData?.escalated,
    ],
  )

  const handleLeaseRenewalIncentiveSend = useCallback(
    async (brief: LeaseRenewalIncentiveBrief, message: string) => {
      setLeaseRenewalIncentiveSending(true)
      setLeaseRenewalIncentiveError(null)
      try {
        const result = await sendLeaseRenewalIncentiveMessage(
          brief,
          message,
          getActiveLandlordId(),
        )
        if (!result.ok) {
          setLeaseRenewalIncentiveError(result.error)
          return
        }
        setLeaseRenewalIncentiveBrief(appendLeaseRenewalIncentiveSentMessage(brief, message))
      } catch (err) {
        setLeaseRenewalIncentiveError(getErrorMessage(err, "Couldn't send that message. Please try again."))
      } finally {
        setLeaseRenewalIncentiveSending(false)
      }
    },
    [],
  )

  const criticalAttentionCount = allAttentionItems.filter(
    (i) => i.badge === 'critical',
  ).length

  const overviewBuildingHealth = useMemo(
    () => healthReport.buildings.slice(0, 6),
    [healthReport.buildings],
  )

  const smartInsights = useMemo<SmartInsight[]>(() => {
    return computePortfolioInsights({
      tickets: tickets.map((t) => ({
        id: t.id,
        building: t.building,
        unit: t.unit,
        issueCategory: t.issueCategory,
        vendorWorkStatus: t.vendorWorkStatus,
        createdAt: t.createdAt,
        assignedVendorId: t.assignedVendorId,
        urgency: t.urgency,
      })),
      units: units.map((u) => ({
        unitLabel: u.unitLabel,
        building: u.building,
      })),
      vendorResponsePct: kpis.vendorResponse,
      assignedWorkOrderCount: tickets.filter((t) => t.assignedVendorId).length,
      now,
    })
  }, [tickets, units, kpis.vendorResponse, now])

  const updatedCaption =
    loading || !lastUpdated ? 'Updating…' : formatUpdatedAt(lastUpdated)
  const portfolioPendingSetup =
    !healthReport.portfolio || healthReport.portfolio.status === 'pending_setup'
  const healthScoreReady = shouldShowPropertyHealthScore(healthReport.portfolio?.status)
  const healthKpiCaption = resolvePropertyHealthKpiCaption(healthReport.portfolio)
  const healthFactorBreakdown =
    !loading && healthReport.portfolio && healthScoreReady
      ? propertyHealthFactorBreakdownLines(healthReport.portfolio.components)
      : undefined
  const healthKpiValue = loading
    ? '—'
    : resolvePropertyHealthKpiValue(
        healthReport.portfolio?.status,
        healthReport.portfolio?.score,
      )

  const escalatedRailOpen = escalatedRailTarget != null && escalatedReview != null
  const stackedVendorRails = escalatedRailOpen && findExternalVendorOpen
  const findExternalAreaLabel = useMemo(() => {
    if (externalVendorAreaLabel) return externalVendorAreaLabel
    const loc = externalVendorLocationLabel ?? escalatedReview?.locationLabel ?? ''
    const building = loc.split(' · ')[0]?.trim() || null
    return cityStateZipForBuildingName(canonicalProperties, building)
  }, [
    externalVendorAreaLabel,
    externalVendorLocationLabel,
    escalatedReview?.locationLabel,
    canonicalProperties,
  ])
  const invoicePayReview = useMemo(
    () => invoicePayReviews.find((r) => r.invoiceId === invoicePayRailId) ?? null,
    [invoicePayReviews, invoicePayRailId],
  )

  const closeInvoicePayRail = useCallback(() => {
    if (invoicePaySaving) return
    setInvoicePayRailId(null)
    setInvoicePayError(null)
    setInvoicePaySuccess(null)
  }, [invoicePaySaving])

  const handleInvoicePayApprove = useCallback(async (note?: string) => {
    if (!invoicePayReview) return
    setInvoicePaySaving(true)
    setInvoicePayError(null)
    try {
      await approveMaintenanceInvoice(invoicePayReview.invoiceId, note)
      const ytdPaidTotal = invoicePayReview.vendorId
        ? await fetchVendorYtdPaidTotal({
            landlordId: getActiveLandlordId(),
            vendorId: invoicePayReview.vendorId,
          })
        : null
      setInvoicePayReviews((prev) =>
        prev.filter((r) => r.invoiceId !== invoicePayReview.invoiceId),
      )
      setInvoicePaySuccess({
        amountPaid: invoicePayReview.totalCost,
        vendorName: invoicePayReview.vendorName,
        sourceLabel: 'Payment method',
        transactionId: `TXN-${invoicePayReview.invoiceId.replace(/-/g, '').slice(0, 8).toUpperCase()}-ULO`,
        paidAt: new Date().toISOString(),
        receiptUrl: null,
        ytdPaidTotal,
      })
      setInvoicePayRailId(invoicePayReview.invoiceId)
      skipAutoOutcomeKeysRef.current.add(`invoice-${invoicePayReview.invoiceId}`)
    } catch (err) {
      setInvoicePayError(getErrorMessage(err, 'Could not approve invoice'))
    } finally {
      setInvoicePaySaving(false)
    }
  }, [invoicePayReview])

  const handleInvoicePayReject = useCallback(async () => {
    if (!invoicePayReview) return
    setInvoicePaySaving(true)
    setInvoicePayError(null)
    try {
      await rejectMaintenanceInvoice(
        invoicePayReview.invoiceId,
        'Rejected from Needs Your Attention',
      )
      setInvoicePayReviews((prev) =>
        prev.filter((r) => r.invoiceId !== invoicePayReview.invoiceId),
      )
      setInvoicePayRailId(null)
      showAwaitingDecisionOutcome(
        {
          operationTitle: 'Invoice ready to pay',
          context: formatLocationContextLabel({
            propertyLabel: invoicePayReview.building,
            unitLabel: invoicePayReview.unit,
            residentName: invoicePayReview.residentName,
          }),
          kind: 'resolved',
          headline: 'Removed from Needs Your Attention',
          detail: `Rejected the invoice from ${invoicePayReview.vendorName}. Ask the vendor to resubmit if needed.`,
          removedFromQueue: true,
        },
        `invoice-${invoicePayReview.invoiceId}`,
      )
    } catch (err) {
      setInvoicePayError(getErrorMessage(err, 'Could not reject invoice'))
    } finally {
      setInvoicePaySaving(false)
    }
  }, [invoicePayReview, showAwaitingDecisionOutcome])

  const lateRentRailOpen = lateRentRailRunId != null && lateRentReview != null
  const stackedLateRentRails = lateRentRailOpen && lateRentMessageBrief != null
  const leaseRenewalRailOpen = leaseRenewalRailRunId != null && leaseRenewalReview != null
  const stackedLeaseRenewalRails = leaseRenewalRailOpen && leaseRenewalIncentiveBrief != null

  return (
    <div className="flex flex-col px-8 pb-8">
      <div className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Operations Overview
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            {greetingLine}
          </p>
        </div>
      </div>

      {onboardingNotice ? (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]"
        >
          <span>{onboardingNotice}</span>
          <button
            type="button"
            onClick={() => setOnboardingNotice(null)}
            className="sa-link shrink-0 text-[12px] font-medium text-[#92400e] underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      {!loading && units.length === 0 && tickets.length === 0 ? (
        <section className="mb-4 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
            Welcome to Ulo — let’s get your portfolio set up
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            Data will appear once activity begins. Work through these steps to
            bring your first property online.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                step: '1',
                title: 'Add a property',
                desc: 'Register your first building and units.',
                to: '/admin/properties?add=1',
              },
              {
                step: '2',
                title: 'Import residents',
                desc: 'Add residents so Ulo can reach them.',
                to: '/admin/residents',
              },
              {
                step: '3',
                title: 'Add vendors',
                desc: 'Plumbing, HVAC, electrical, and more.',
                to: '/admin/vendors',
              },
              {
                step: '4',
                title: 'Connect channels',
                desc: 'Set up SMS and email communication.',
                to: '/admin/settings/operations/notifications',
              },
              {
                step: '5',
                title: 'First request',
                desc: 'Submit a test maintenance request.',
                to: '/request',
              },
            ].map((item) => (
              <li key={item.step}>
                <Link
                  to={item.to}
                  className="sa-card flex h-full flex-col gap-1 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4 hover:border-[#101828]/30 hover:bg-white"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#101828] text-[12px] font-semibold text-white">
                    {item.step}
                  </span>
                  <span className="mt-1 text-[14px] font-semibold text-[#101828]">
                    {item.title}
                  </span>
                  <span className="text-[12px] leading-4 text-[#6a7282]">
                    {item.desc}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          label="Critical Issues"
          value={loading ? '—' : String(kpis.criticalOpen)}
          delta={loading ? null : kpis.criticalDelta}
          caption="More reported than 4 weeks ago"
        />
        <KpiCard
          label="Active Tasks"
          value={loading ? '—' : String(kpis.activeOps)}
          delta={loading ? null : kpis.activeOpsDelta}
          caption="Compared to 4 weeks ago"
          infoTitle="Active tasks breakdown"
          infoDescription="Shows the tasks Ulo is actively managing, such as maintenance, rent, inspections, move-ins, move-outs, and lease renewals. It doesn't include every open work order—only those currently in progress."
          infoLines={loading ? undefined : kpis.activeOpsBreakdown}
        />
        <KpiCard
          label="Property Health"
          value={healthKpiValue}
          delta={
            loading || portfolioPendingSetup
              ? null
              : propertyHealthKpiDelta(kpis.propertyHealthDelta)
          }
          deltaSuffix="%"
          goodWhenUp
          caption={healthKpiCaption}
          infoTitle="Property health factors"
          infoDescription="See the six factors that make up your Property Health score. The areas that need the most attention are shown first so you know where to focus."
          infoLines={healthFactorBreakdown}
        />
        <KpiCard
          label="YTD Maintenance Cost"
          value={loading ? '—' : formatSpendCompact(kpis.ytdMaintenanceCost)}
          delta={loading ? null : kpis.ytdMaintenanceCostDelta}
          deltaFormatter={formatSignedSpend}
          caption={updatedCaption}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[2fr_3fr]">
        {/* Smart Insights */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="border-b border-[#e5e7eb] px-6 py-4">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Property Insights
            </h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Insights generated from activity across your property
            </p>
          </div>
          <div className="flex flex-col gap-3 p-4">
            {loading ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : smartInsights.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#6a7282]">
                Insights will appear as Ulo learns from your properties.
              </p>
            ) : (
              smartInsights.map((insight) =>
                insight.tag === 'RECURRING ISSUES' ? (
                  <RecurringIssuesInsightCard key={insight.tag} insight={insight} />
                ) : insight.tag === 'RISK' ? (
                  <RiskInsightCard key={insight.tag} insight={insight} />
                ) : insight.tag === 'VENDOR RESPONSE' ? (
                  <VendorResponseInsightCard key={insight.tag} insight={insight} />
                ) : (
                  <PreventFutureRepairsInsightCard key={insight.tag} insight={insight} />
                ),
              )
            )}
          </div>
        </section>

        {/* Needs Attention */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
            <div>
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                Needs Your Attention
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">
                {allAttentionItems.length} operation{allAttentionItems.length === 1 ? '' : 's'}{' '}
                need{allAttentionItems.length === 1 ? 's' : ''} your attention
                {criticalAttentionCount > 0 ? ` · ${criticalAttentionCount} critical` : ''}
              </p>
            </div>
            {allAttentionItems.length > 4 ? (
              <button
                type="button"
                onClick={() => setAwaitingDecisionListOpen(true)}
                disabled={loading}
                className="admin-quiet-text-action sa-link"
              >
                View all →
              </button>
            ) : null}
          </div>
          <div className="flex flex-col divide-y divide-[#f3f4f6]">
            {loading ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : attentionItems.length === 0 ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                Nothing needs attention.
              </p>
            ) : (
              attentionItems.map((item, index) => (
                <div
                  key={item.key}
                  style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
                  className="sa-enter flex items-center gap-4 px-6 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                        {item.title}
                      </p>
                      <span
                        className={[
                          'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                          item.badge === 'critical'
                            ? 'bg-[#E3646C] text-white'
                            : item.actionStyle === 'alert'
                              ? 'bg-[#FBE3E5] text-[#E3646C]'
                              : 'bg-[#fef9c2] text-[#a65f00]',
                        ].join(' ')}
                      >
                        {item.badge === 'critical' ? 'Critical' : 'Warning'}
                      </span>
                    </div>
                    {item.context ? (
                      <p className="mt-0.5 truncate text-[13px] leading-5 text-[#6a7282]">
                        {item.context}
                      </p>
                    ) : null}
                    <p className="text-[12px] leading-4 text-[#6a7282]">{item.meta}</p>
                  </div>
                  {item.onAction ? (
                    <button
                      type="button"
                      onClick={item.onAction}
                      className={ADMIN_ATTENTION_ACTION_CLASS}
                    >
                      {item.actionLabel} →
                    </button>
                  ) : (
                    <Link
                      to={item.actionTo ?? '/admin/workflows'}
                      className={ADMIN_ATTENTION_ACTION_CLASS}
                    >
                      {item.actionLabel} →
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* AI Operations Feed */}
        <section className="flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-4">
            <div>
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
                Ulo Activity Feed
              </h2>
              <p className="text-[12px] leading-4 text-[#6a7282]">Actions completed across your properties</p>
            </div>
            <span className="size-2 shrink-0 rounded-full bg-[#00c950]" aria-hidden />
          </div>
          <div className="flex flex-col">
            {loading ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : feedEvents.length === 0 ? (
              <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
                No AI actions yet. Activity will stream here as Ulo starts working.
              </p>
            ) : (
              feedEvents.map((event, index) => {
                const context = formatTimelineContextLine(event)
                const isLast = index === feedEvents.length - 1
                const isFirst = index === 0
                return (
                  <div
                    key={event.id}
                    style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                    className="sa-enter flex gap-3 px-6"
                  >
                    <div className="flex w-[4.75rem] shrink-0 flex-col items-center self-stretch">
                      <span
                        className={[
                          'w-full text-center text-[11px] leading-4 text-[#6a7282]',
                          isFirst ? 'mt-3' : 'mt-1',
                        ].join(' ')}
                      >
                        {formatRelativeTime(event.createdAt)}
                      </span>
                      {!isLast ? (
                        <span
                          className="mt-1 w-0 min-h-[12px] flex-1 border-l border-dotted border-[#d1d5dc]"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 py-3">
                      <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                        {event.label}
                        {context ? (
                          <span className="text-[#6a7282]"> · {context}</span>
                        ) : null}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={[
                            'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                            FEED_BADGE_STYLES[event.category] ?? FEED_BADGE_STYLES.admin,
                          ].join(' ')}
                        >
                          {formatTimelineCategoryLabel(event.category)}
                        </span>
                      </div>
                    </div>
                    <FeedEventInfo
                      event={event}
                      propertyIdByBuilding={propertyIdByBuilding}
                      onOpen={openFeedTarget}
                    />
                  </div>
                )
              })
            )}
          </div>
        </section>

        <PropertyHealthBuildingGrid
          loading={loading}
          buildings={overviewBuildingHealth}
          buildingCount={healthReport.buildings.length}
          totalUnits={countDistinctPortfolioUnits(units)}
          onBuildingOpen={(building) =>
            navigate(propertyDetailPathForBuilding(building, propertyIdByBuilding))
          }
          headerAction={
            <Link to="/admin/properties" className="admin-quiet-text-action sa-link">
              View all properties →
            </Link>
          }
        />
      </div>

      {escalatedRailError ? (
        <p className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-[13px] text-[#c10007] shadow-lg">
          {escalatedRailError}
        </p>
      ) : null}

      {lateRentRailError ? (
        <p className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-[13px] text-[#c10007] shadow-lg">
          {lateRentRailError}
        </p>
      ) : null}

      {leaseRenewalRailError ? (
        <p className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-[10px] border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-[13px] text-[#c10007] shadow-lg">
          {leaseRenewalRailError}
        </p>
      ) : null}

      {stackedVendorRails ? (
        <div className={ADMIN_RIGHT_RAIL_STACK_HOST}>
          <div
            role="presentation"
            className={ADMIN_RIGHT_RAIL_SCRIM}
            aria-hidden
            onClick={() => {
              if (!escalatedRailSaving) closeEscalatedRail()
            }}
          />
          <div className="relative flex h-full max-h-dvh max-w-full">
            <FindExternalVendorRail
              panelOnly
              stackedPosition="left"
              open
              onClose={closeEscalatedVendorFlow}
              onBack={backFromFindExternalVendor}
              onSelect={handleExternalVendorSelect}
              saving={escalatedRailSaving}
              saveError={escalatedRailError}
              loading={escalatedRailLoading}
              error={externalVendorDiscoverError}
              notice={externalVendorNotice}
              locationLabel={
                externalVendorLocationLabel ??
                escalatedReview?.locationLabel ??
                'Property · Unit'
              }
              areaLabel={findExternalAreaLabel}
              issueCategory={externalVendorIssueCategory}
              suggestions={externalVendorSuggestions}
              providersUsed={externalVendorProvidersUsed}
            />
            <SlaOverdueActionRail
              panelOnly
              stackedPosition="right"
              open
              review={escalatedReview}
              loading={escalatedRailLoading}
              saving={escalatedRailSaving}
              error={escalatedRailError}
              onClose={closeEscalatedRail}
              onTakeAction={handleEscalatedTakeAction}
              onDelete={handleDeleteEscalatedAttention}
            />
          </div>
        </div>
      ) : (
        <SlaOverdueActionRail
          open={escalatedRailOpen}
          review={escalatedReview}
          loading={escalatedRailLoading}
          saving={escalatedRailSaving}
          error={escalatedRailError}
          onClose={closeEscalatedRail}
          onTakeAction={handleEscalatedTakeAction}
          onDelete={handleDeleteEscalatedAttention}
        />
      )}

      <AwaitingDecisionListRail
        open={awaitingDecisionListOpen}
        items={allAttentionItems}
        criticalCount={criticalAttentionCount}
        onClose={() => setAwaitingDecisionListOpen(false)}
        onItemAction={handleAwaitingDecisionItemAction}
      />

      {landlordHasPayments(getActiveLandlordId()) && (invoicePaySuccess || invoicePayReview) ? (
        <InvoicePaymentRail
          open
          review={invoicePayReview}
          successDetails={invoicePaySuccess}
          saving={invoicePaySaving}
          error={invoicePayError}
          onClose={closeInvoicePayRail}
          onApprove={(note) => void handleInvoicePayApprove(note)}
          onReject={() => void handleInvoicePayReject()}
        />
      ) : null}

      {stackedLateRentRails ? (
        <div className={ADMIN_RIGHT_RAIL_STACK_HOST}>
          <div
            role="presentation"
            className={ADMIN_RIGHT_RAIL_SCRIM}
            aria-hidden
            onClick={() => {
              if (!lateRentRailSaving && !lateRentMessageSending) {
                closeLateRentRail()
              }
            }}
          />
          <div className="relative flex h-full max-h-dvh max-w-full">
            <LateRentAccountMessageRail
              panelOnly
              stackedPosition="left"
              open
              brief={lateRentMessageBrief}
              sending={lateRentMessageSending}
              sendError={lateRentMessageError}
              onClose={closeLateRentMessageRail}
              onSend={(brief, message, options) =>
                void handleLateRentMessageSend(brief, message, options)
              }
            />
            <LateRentAccountReviewRail
              panelOnly
              stackedPosition="right"
              open
              review={lateRentReview}
              saving={lateRentRailSaving || lateRentMessageSending}
              onClose={closeLateRentRail}
              onAction={(action, review) => void handleLateRentAction(action, review)}
            />
          </div>
        </div>
      ) : (
        <>
          <LateRentAccountReviewRail
            open={lateRentRailOpen}
            review={lateRentReview}
            saving={lateRentRailSaving}
            onClose={closeLateRentRail}
            onAction={(action, review) => void handleLateRentAction(action, review)}
          />

          <LateRentAccountMessageRail
            open={lateRentMessageBrief != null}
            brief={lateRentMessageBrief}
            sending={lateRentMessageSending}
            sendError={lateRentMessageError}
            onClose={closeLateRentMessageRail}
            onSend={(brief, message, options) =>
              void handleLateRentMessageSend(brief, message, options)
            }
          />
        </>
      )}

      {stackedLeaseRenewalRails ? (
        <div className={ADMIN_RIGHT_RAIL_STACK_HOST}>
          <div
            role="presentation"
            className={ADMIN_RIGHT_RAIL_SCRIM}
            aria-hidden
            onClick={() => {
              if (!leaseRenewalRailSaving && !leaseRenewalIncentiveSending) {
                closeLeaseRenewalRail()
              }
            }}
          />
          <div className="relative flex h-full max-h-dvh max-w-full">
            <LeaseRenewalIncentiveMessageRail
              panelOnly
              stackedPosition="left"
              open
              brief={leaseRenewalIncentiveBrief}
              sending={leaseRenewalIncentiveSending}
              sendError={leaseRenewalIncentiveError}
              onClose={closeLeaseRenewalIncentiveRail}
              onSend={(brief, message) => void handleLeaseRenewalIncentiveSend(brief, message)}
            />
            <LeaseRenewalEscalatedRail
              panelOnly
              stackedPosition="right"
              open
              review={leaseRenewalReview}
              saving={leaseRenewalRailSaving || leaseRenewalIncentiveSending}
              onClose={closeLeaseRenewalRail}
              onAction={(action, review) => void handleLeaseRenewalAction(action, review)}
            />
          </div>
        </div>
      ) : (
        <>
          <LeaseRenewalEscalatedRail
            open={leaseRenewalRailOpen}
            review={leaseRenewalReview}
            saving={leaseRenewalRailSaving}
            onClose={closeLeaseRenewalRail}
            onAction={(action, review) => void handleLeaseRenewalAction(action, review)}
          />

          <LeaseRenewalIncentiveMessageRail
            open={leaseRenewalIncentiveBrief != null}
            brief={leaseRenewalIncentiveBrief}
            sending={leaseRenewalIncentiveSending}
            sendError={leaseRenewalIncentiveError}
            onClose={closeLeaseRenewalIncentiveRail}
            onSend={(brief, message) => void handleLeaseRenewalIncentiveSend(brief, message)}
          />
        </>
      )}

      {tenantCallFlow ? (
        <VendorCallFlowModal
          open
          onClose={() => setTenantCallFlow(null)}
          vendorName={tenantCallFlow.name}
          vendorPhone={tenantCallFlow.phone}
          context={tenantCallFlow.context}
          reasonLine={tenantCallFlow.reasonLine}
          quickNotesPlaceholder="e.g. Tenant leaning toward renewing, asked about parking…"
        />
      ) : null}

      <AwaitingDecisionOutcomeModal
        open={awaitingDecisionOutcome != null}
        outcome={awaitingDecisionOutcome}
        onClose={() => setAwaitingDecisionOutcome(null)}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  postDiscoverExternalVendors,
  resolveDiscoverExternalVendorsUrl,
  type DiscoverExternalVendorsOk,
  type ExternalVendorJobContextDto,
  type ExternalVendorSuggestionDto,
} from '@/api/discoverExternalVendors'
import {
  postReassignExternalVendor,
  resolveReassignExternalVendorUrl,
} from '@/api/reassignExternalVendor'
import { postSlaAutoReassign, resolveSlaAutoReassignUrl } from '@/api/slaAutoReassign'
import openRepairsIcon from '@/assets/repair-tool.png'
import scheduledVisitsIcon from '@/assets/calendar.png'
import propertyHealthIcon from '@/assets/hospital.png'
import ytdMaintenanceCostIcon from '@/assets/price-up.png'
import { MyPropertiesAcrossAdmin } from '@/components/MyPropertiesAcrossAdmin'
import { NeedsAttentionRow } from '@/components/NeedsAttentionRowAction'
import { AwaitingDecisionListRail } from '@/components/AwaitingDecisionListRail'
import { PmAttentionActions, PmServiceReviewRail } from '@/components/PmServiceReviewRail'
import { batchesFromPmTaskRows, type PmTaskAttentionRow } from '@/lib/pmServiceAttentionCards'
import { persistPmServiceAppResolution } from '@/lib/pmServiceAttentionActions'
import {
  approvePmServiceSelection,
  derivePmServiceCards,
  sortNeedsAttention,
  type PmServiceBatchSnapshot,
  type PmServiceCard,
} from '@shared/pm/pmServiceAttention'
import { AwaitingDecisionOutcomeModal } from '@/components/AwaitingDecisionOutcomeModal'
import { LateRentAccountReviewRail } from '@/components/LateRentAccountReviewRail'
import { LateRentAccountMessageRail } from '@/components/LateRentAccountMessageRail'
import { LeaseRenewalEscalatedRail } from '@/components/LeaseRenewalEscalatedRail'
import { LeaseRenewalIncentiveMessageRail } from '@/components/LeaseRenewalIncentiveMessageRail'
import {
  InvoicePaymentRail,
  type InvoiceApprovalSuccess,
  type InvoicePaymentReview,
  type InvoicePaymentSuccessDetails,
} from '@/components/InvoicePaymentRail'
import { SlaOverdueActionRail } from '@/components/SlaOverdueActionRail'
import { RecommendedActionsWorkOrdersRail } from '@/components/RecommendedActionsWorkOrdersRail'
import type { RecommendedActionWorkOrderItem } from '@/components/RecommendedActionsWorkOrdersRail'
import { FindExternalVendorRail } from '@/components/FindExternalVendorRail'
import { VendorCallFlowModal } from '@/components/VendorCallFlowModal'
import { useAdminDesktopLayout } from '@/hooks/useAdminDesktopLayout'
import { findExternalVendorTicketFromSearch, FIND_EXTERNAL_VENDOR_QUERY } from '@/lib/uloAppUrl'
import { isLandlordFacingMaintenanceRequest } from '@/lib/landlordWorkOrders'
import { getActiveLandlordId, isDemoAccountActive } from '@/lib/activeLandlord'
import {
  TRY_DEMO_SPOTLIGHT_ATTENTION_ID,
  TRY_DEMO_SPOTLIGHT_PORTFOLIO_ID,
  TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID,
} from '@/lib/tryDemoAttentionGuide'
import { landlordHasPayments } from '@shared/landlordCapabilities'
import { insightDetailSections, insightDetailWorkOrderContext } from '@shared/portfolioIntelligence/insightDetailSections'
import {
  insightCardAddressLine,
  insightCardHeadline,
  resolveInsightCardSummary,
} from '@shared/portfolioIntelligence/insightCardSummary'
import { cityStateZipForBuildingName, listPropertiesForLandlord, type PropertyRecord } from '@/lib/properties'
import {
  ensureOnboardingDashboardMatchesPortfolio,
} from '@/lib/onboarding'
import { useSidebarAdminProfile } from '@/hooks/useSidebarAdminProfile'
import {
  isMaintenanceAdminVendorEscalationReason,
  isStalePendingAcceptNeedsAdminVendor,
  maintenanceAdminVendorAttentionTitle,
  shouldSkipSlaReassignForNeedsAdminVendor,
  STALE_PENDING_ACCEPT_NEEDS_ADMIN_ATTENTION_TITLE,
} from '@/lib/maintenanceAdminVendor'
import {
  emptyAdminWorkflowDashboardData,
  fetchAdminWorkflowDashboard,
  formatLocationContextLabel,
  maintenanceTicketIdFromWorkflowRun,
  type AdminWorkflowDashboardData,
} from '@/lib/adminWorkflows'
import { collectAdminWorkflowRuns } from '@/lib/adminWorkflowKanban'
import {
  collectCompletedWorkOrderTicketIds,
  shouldOmitEscalatedRunFromNeedsAttention,
  buildInspectionScopedAttentionCopy,
} from '@/lib/needsAttentionWorkOrder'
import {
  lateRentAttentionSummary,
  leaseInfoAttentionSummary,
  leaseRenewalAttentionSummary,
  responseTimeNoVendorSummary,
  rosterGapAttentionSummary,
  smsDeliveryAttentionSummary,
  staleVendorAttentionSummary,
  vendorDeclinedAttentionSummary,
  waitingAttentionSummary,
} from '@/lib/needsAttentionSummary'
import {
  finishInvoiceApproval,
  formatInvoiceAmount,
  invoiceAttentionCard,
  invoiceReviewLocation,
  propertyLabelForInvoice,
  propertyTypeForInvoice,
  startInvoiceApproval,
  type InvoiceApprovalPhase,
} from '@/lib/invoiceApprovalFlow'
import {
  fetchVendorYtdPaidTotal,
  fetchWorkflowPipelineDetail,
  type WorkflowPipelineDetail,
} from '@/lib/workflowPipelineDetail'
import { WorkflowPipelineDetailPanel } from '@/components/WorkflowPipelineDetailPanel'
import {
  ADMIN_RIGHT_RAIL_SCRIM,
  ADMIN_RIGHT_RAIL_STACK_HOST,
} from '@/lib/adminRightRail'
import { buildPropertyIdByBuilding, propertyResidentDetailPathForBuilding } from '@/lib/propertyRoutes'
import {
  insightWorkOrderHref,
  lookupWorkflowRunIdForTicket,
  pickWorkflowRunIdForTicket,
} from '@/lib/insightWorkOrderDestination'
import {
  buildLeaseRenewalCallReasonLine,
  formatWorkOrderRefFromTicketId,
  type VendorCallContext,
} from '@/lib/vendorCallFlow'
import {
  buildPropertyHealthReport,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  propertyHealthFactorBreakdownLines,
  propertyHealthKpiDelta,
  resolvePropertyHealthKpiValue,
  shouldShowPropertyHealthScore,
  type PropertyHealthAsset,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthDamageReport,
  type PropertyHealthFeedback,
  type PropertyHealthInspection,
  type PropertyHealthPmTask,
  type PropertyHealthResident,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import { PropertyHealthDonut, propertyHealthDonutPercent } from '@/components/PropertyHealthDonut'
import { PropertyHealthUnavailableNote } from '@/components/PropertyHealthUnavailableNote'
import { PropertyHealthScoreInfoTip } from '@/components/PropertyHealthScoreInfoTip'
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
  fetchRecognizedMaintenanceSpend,
  rejectMaintenanceInvoice,
  sumRecognizedSpendBetween,
  type RecognizedMaintenanceSpend,
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
import { VENDOR_JOB_ACCEPTANCE_TOOLTIP } from '@/lib/communicationResponseRate'
import { loadLeaseInfoMissingAttention, type LeaseInfoMissingAttention } from '@/lib/leaseInfoMissingAttention'
import { loadSmsNoRecipientsAttention, type SmsNoRecipientsAttention } from '@/lib/smsNoRecipientsAttention'
import {
  dismissNeedsAttentionItem,
  isNeedsAttentionDismissed,
  loadDismissedAttentionIds,
  type DismissedAttentionIds,
} from '@/lib/dismissNeedsAttention'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  applyInsightSynthesis,
  insightActionLabel,
  computePortfolioInsights,
  acceptedStatusLabel,
  needsExternalStatusLabel,
  probingStatusLabel,
  type InsightSchedulingCardState,
  type PortfolioInsightFinding,
  type SynthesizedInsightCard,
} from '@shared/portfolioIntelligence'
import {
  readCachedPropertyInsightCards,
  resolveSynthesizePropertyInsightsUrl,
  synthesizePropertyInsightsCached,
} from '@/api/synthesizePropertyInsights'
import {
  defaultPropertyInsightActionDeps,
  runPropertyInsightAction,
  schedulingStateFromActionResult,
} from '@/lib/propertyInsightActions'
import { NoInspectorAvailableModal } from '@/components/NoInspectorAvailableModal'

type OverviewTicket = {
  id: string
  createdAt: string
  urgency: string
  dueAt: string | null
  /** Confirmed / proposed visit instant when set. */
  scheduledAt: string | null
  vendorWorkStatus: string
  unit: string
  unitId: string | null
  propertyId: string | null
  building: string | null
  email: string | null
  description: string | null
  issueCategory: string | null
  assignedVendorId: string | null
  assignedVendorName: string | null
  assignedAt: string | null
  /** Sticky `needs_admin_vendor|…` — board must not treat as ordinary waiting. */
  autoReassignLastOutcome: string | null
  residentName: string | null
  estimatedMinutes: number | null
  /** Actual total from an extracted vendor invoice (labor + materials + tax), when available. */
  totalCost: number | null
  /** When the job was marked complete, when the schema records it. */
  completedAt: string | null
  /** Resident said this issue happened before (SMS intake). */
  residentReportedRecurring: boolean
  /** HQS / compliance inspection letter that spawned this work order, when set. */
  inspectionReportId: string | null
}

type OverviewVendor = {
  id: string
  name: string
  category: string | null
  active: boolean
  verified: boolean
}

type OverviewUnit = {
  id: string
  unitLabel: string
  building: string | null
  propertyId: string | null
  status: string
}

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
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  onSnooze?: () => void
  emergencyRepair?: boolean
  pmSafety?: boolean
  dueAt?: string | null
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
  activationStatus: string | null
}

function overviewTicketToInput(
  ticket: OverviewTicket,
  units: OverviewUnit[],
): SlaOverdueTicketInput {
  const unitKey = normalizeUnitLabel(ticket.unit)
  const building =
    ticket.building ??
    (ticket.unitId
      ? units.find((u) => u.id === ticket.unitId)?.building ?? null
      : null) ??
    (ticket.propertyId && unitKey
      ? units.find(
          (u) =>
            u.propertyId === ticket.propertyId &&
            normalizeUnitLabel(u.unitLabel) === unitKey,
        )?.building ?? null
      : null)
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
    scheduledAt: asString(raw.scheduled_at) || null,
    vendorWorkStatus: asString(raw.vendor_work_status).toLowerCase(),
    unit: asString(raw.unit),
    unitId: asString(raw.unit_id) || null,
    propertyId: asString(raw.property_id) || null,
    building: asString(raw.building) || null,
    email: asString(raw.email) || null,
    description: asString(raw.description) || null,
    issueCategory: asString(raw.issue_category) || null,
    assignedVendorId,
    assignedVendorName: embeddedVendor?.trim() || null,
    assignedAt: asString(raw.assigned_at) || null,
    autoReassignLastOutcome: asString(raw.auto_reassign_last_outcome) || null,
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
    residentReportedRecurring: raw.resident_reported_recurring === true,
    inspectionReportId: asString(raw.inspection_report_id) || null,
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
  const total = asFiniteNumber(
    raw.total_cost ??
      raw.invoice_total ??
      raw.amount ??
      raw.recognized_spend_amount,
  )
  if (total != null) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor == null && material == null && tax == null) return null
  return (labor ?? 0) + (material ?? 0) + (tax ?? 0)
}

/** Date a job's spend should be attributed to (completion / recognition date). */
function ticketSpendDate(ticket: OverviewTicket): number {
  const completed = ticket.completedAt ? new Date(ticket.completedAt).getTime() : NaN
  if (!Number.isNaN(completed)) return completed
  return new Date(ticket.createdAt).getTime()
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

/** Upcoming (or today) visit still on an open work order. */
function isUpcomingScheduledVisit(
  ticket: OverviewTicket,
  nowMs: number = Date.now(),
): boolean {
  const instant = ticket.scheduledAt?.trim()
  if (!instant) return false
  const status = ticket.vendorWorkStatus
  if (
    status === 'cancelled' ||
    status === 'declined' ||
    status === 'completed'
  ) {
    return false
  }
  const at = new Date(instant).getTime()
  if (Number.isNaN(at)) return false
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  return at >= startOfToday.getTime()
}

function countScheduledBetween(
  tickets: OverviewTicket[],
  fromMs: number,
  toMs: number,
): number {
  return tickets.filter((ticket) => {
    const instant = ticket.scheduledAt?.trim()
    if (!instant) return false
    const status = ticket.vendorWorkStatus
    if (status === 'cancelled' || status === 'declined') return false
    const at = new Date(instant).getTime()
    return !Number.isNaN(at) && at >= fromMs && at < toMs
  }).length
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

function KpiCard({
  label,
  labelIcon,
  value,
  chart,
  valueNote,
  delta,
  deltaSuffix = '',
  deltaFormatter,
  goodWhenUp = false,
  caption,
  infoContent,
  stagger = 0,
}: {
  label: string
  /** Optional icon shown in a gray rounded square to the left of the label. */
  labelIcon?: string
  value: string
  chart?: ReactNode
  /** Replaces the large value when there is no score to chart. */
  valueNote?: ReactNode
  delta: number | null
  /** Appended to the delta, e.g. '%' for rate cards. */
  deltaSuffix?: string
  /** Renders the full signed delta string (e.g. currency); overrides deltaSuffix. */
  deltaFormatter?: (delta: number) => string
  /** True when an increase is a good trend (e.g. health), false when it's bad (e.g. critical issues). */
  goodWhenUp?: boolean
  caption: string
  /** Optional ⓘ control rendered next to the label (e.g. Property Health factors). */
  infoContent?: ReactNode
  stagger?: number
}) {
  const positive = (delta ?? 0) > 0
  const neutral = delta === 0
  const good = neutral ? false : positive === goodWhenUp

  const deltaChip =
    delta != null ? (
      <span
        className={[
          'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] leading-4 tracking-[-0.1504px] sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-[14px] sm:leading-5',
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
    ) : null

  const labelRow = (
    <div className="flex min-w-0 items-center gap-1.5">
      {labelIcon ? (
        <span
          className="flex size-[2.1rem] shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6]"
          aria-hidden
        >
          <img src={labelIcon} alt="" className="size-[1.2rem] object-contain" />
        </span>
      ) : null}
      <p className="min-w-0 truncate text-left text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {label}
      </p>
      {infoContent}
    </div>
  )

  const valueBlock = (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {chart ? (
        <div className="pointer-events-none -ml-2 shrink-0 sm:-ml-3">{chart}</div>
      ) : valueNote ? (
        <div className="max-w-full text-left">{valueNote}</div>
      ) : value ? (
        <p className="shrink-0 whitespace-nowrap text-left text-[28px] font-medium leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums sm:text-[44px] xl:text-[52px]">
          {value}
        </p>
      ) : null}
      {deltaChip}
    </div>
  )

  const captionRow = (
    <p className="mt-auto min-w-0 truncate whitespace-nowrap text-left text-[12px] leading-4 text-[#6a7282]">
      {caption}
    </p>
  )

  // Icon width (2.1rem) + gap-1.5 so value/caption share the title text’s left edge.
  const textIndentClass = labelIcon ? 'pl-[calc(2.1rem+0.375rem)]' : ''

  return (
    <div
      className="sa-stagger-scale sa-card relative z-0 flex h-full min-w-0 flex-1 flex-col gap-4 overflow-visible rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] hover:z-20 focus-within:z-20 sm:p-6"
      style={{ '--sa-stagger': stagger } as CSSProperties}
    >
      {labelRow}
      <div className={['flex min-h-0 min-w-0 flex-1 flex-col gap-4', textIndentClass].filter(Boolean).join(' ')}>
        {valueBlock}
        {captionRow}
      </div>
    </div>
  )
}

const INSIGHT_TAG_LABEL: Record<PortfolioInsightFinding['tag'], string> = {
  'RECURRING ISSUES': 'Recurring Issues',
  RISK: 'Needs Attention',
  'VENDOR RESPONSE': 'Vendor Response',
  'PREVENT FUTURE REPAIRS': 'Prevent Future Repairs',
}

/** Map urgency (0–100) onto a 1–5 strength meter for recommendation cards. */
function insightStrengthDots(score: number): number {
  return Math.min(5, Math.max(1, Math.floor((score - 50) / 10)))
}

function InsightStrengthMeter({ score }: { score: number }) {
  const filled = insightStrengthDots(score)
  return (
    <div className="flex shrink-0 items-center gap-[6px]" aria-label={`Strength ${filled} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`sa-pill size-[10px] rounded-full ${
            i < filled ? 'bg-[#9E439F]' : 'bg-[#e2e8f0]'
          }`}
        />
      ))}
    </div>
  )
}

export function PropertyInsightRecommendationCard({
  card,
  scheduling,
  onAction,
  onViewDetails,
  onFindExternal,
  actionBusy,
}: {
  card: SynthesizedInsightCard
  scheduling: InsightSchedulingCardState | null
  onAction: (card: SynthesizedInsightCard) => void
  onViewDetails: (card: SynthesizedInsightCard) => void
  onFindExternal: (ticketId: string) => void
  actionBusy: boolean
}) {
  const title = INSIGHT_TAG_LABEL[card.tag] ?? card.tag
  const summary = resolveInsightCardSummary({
    summary: card.summary,
    tag: card.tag,
    categoryLabel: card.categoryLabel,
  })
  const requestCount = card.requestCount ?? 0
  const requestWord = requestCount === 1 ? 'Request' : 'Requests'
  const strengthScore = Math.round(card.urgency * (card.confidence / 100))
  const metaBits: string[] = []
  if (card.tag === 'VENDOR RESPONSE') {
    metaBits.push(
      `${card.assignedCount ?? 0} Assigned ${(card.assignedCount ?? 0) === 1 ? 'Work Order' : 'Work Orders'}`,
    )
    metaBits.push('All Time')
  } else {
    if (card.tag === 'RISK') {
      metaBits.push(`${requestCount} Maintenance ${requestWord}`)
    } else if (card.categoryLabel) {
      metaBits.push(`${requestCount} ${card.categoryLabel} ${requestWord}`)
    } else if (requestCount > 0) {
      metaBits.push(`${requestCount} ${requestWord}`)
    }
    metaBits.push('Last 60 Days')
  }

  const status = scheduling?.status ?? 'idle'
  const scheduleCta =
    card.actionType === 'request_diagnostic' ||
    card.actionType === 'schedule_inspection' ||
    card.actionType === 'schedule_building_inspection' ||
    card.actionType === 'schedule_unit_walkthrough'
  const actionLabel = insightActionLabel(card.actionType) ?? card.actionLabel

  return (
    <div className="sa-enter-scale sa-surface flex w-full min-w-0 flex-col gap-2 rounded-[12px] border border-[#eef2ff] bg-white p-3 shadow-[0px_1px_3px_rgba(0,0,0,0.08)] sm:p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 sm:gap-x-6">
        <div className="flex min-w-0 flex-col gap-1.5 self-start">
          <p
            className="min-w-0 text-[12px] font-extrabold uppercase leading-4 tracking-[0.04em] text-[#9E439F]"
            title={card.tag === 'VENDOR RESPONSE' ? VENDOR_JOB_ACCEPTANCE_TOOLTIP : undefined}
          >
            {title}
          </p>
          <p className="min-w-0 truncate whitespace-nowrap text-[16px] font-normal leading-[1.35] text-[#0f172a]">
            {insightCardHeadline(card.building, summary)}
          </p>
          {status === 'probing' ? (
            <p key="probing" className="sa-enter text-[13px] font-medium leading-5 text-[#64748b]">
              {probingStatusLabel()}
            </p>
          ) : null}
          {status === 'accepted' && scheduling ? (
            <p key="accepted" className="sa-enter text-[13px] font-medium leading-5 text-[#146b52]">
              {acceptedStatusLabel(scheduling)}
            </p>
          ) : null}
          {status === 'needs_external' && scheduling?.targetDay ? (
            <p key="needs-external" className="sa-enter text-[13px] font-medium leading-5 text-[#64748b]">
              {needsExternalStatusLabel(scheduling.targetDay)}
            </p>
          ) : null}
          {metaBits.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {metaBits.map((bit) => (
                <span
                  key={bit}
                  className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[12px] font-medium leading-4 text-[#64748b]"
                >
                  {bit}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-center">
          <InsightStrengthMeter score={strengthScore} />
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 justify-self-end self-start">
          {status === 'needs_external' && scheduling?.ticketId ? (
            <button
              key="find-external"
              type="button"
              onClick={() => onFindExternal(scheduling.ticketId!)}
              className="sa-enter-scale sa-press rounded-[8px] bg-[#70ABC5] px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              Find external vendor
            </button>
          ) : status === 'probing' ? (
            <button
              key="probing-cta"
              type="button"
              disabled
              className="sa-enter-scale sa-press rounded-[8px] bg-[#e5e7eb] px-3 py-1.5 text-[12px] font-semibold text-[#6a7282]"
            >
              Reaching out…
            </button>
          ) : status === 'accepted' ? null : card.actionType !== 'none' && actionLabel ? (
            <button
              key="primary-cta"
              type="button"
              disabled={actionBusy}
              onClick={() => onAction(card)}
              className={`sa-enter-scale sa-press rounded-[8px] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60 ${
                scheduleCta || /assign\s*vendor/i.test(actionLabel)
                  ? 'bg-[#70ABC5]'
                  : 'bg-[#101828]'
              }`}
            >
              {actionLabel}
            </button>
          ) : null}
          {card.ticketIds.length > 0 ? (
            <button
              type="button"
              onClick={() => onViewDetails(card)}
              className="sa-press rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#364153] hover:bg-[#f9fafb]"
            >
              View details
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
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
  const isDesktopAdmin = useAdminDesktopLayout()
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
  const greetingTitle = isDemoAccountActive()
    ? 'Welcome to Your Ulo Demo'
    : greetingName
      ? `${overviewGreetingSalutation()}, ${greetingName}`
      : overviewGreetingSalutation()
  const [tickets, setTickets] = useState<OverviewTicket[]>([])
  const [recognizedSpend, setRecognizedSpend] = useState<RecognizedMaintenanceSpend[]>([])
  const [vendors, setVendors] = useState<OverviewVendor[]>([])
  const [units, setUnits] = useState<OverviewUnit[]>([])
  const [workflowData, setWorkflowData] =
    useState<AdminWorkflowDashboardData | null>(null)
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [healthAssets, setHealthAssets] = useState<PropertyHealthAsset[]>([])
  const [healthInspections, setHealthInspections] = useState<PropertyHealthInspection[]>([])
  const [healthDamageReports, setHealthDamageReports] = useState<PropertyHealthDamageReport[]>([])
  const [residents, setResidents] = useState<PropertyHealthResident[]>([])
  const [overviewResidents, setOverviewResidents] = useState<OverviewResident[]>([])
  const [leaseInfoMissing, setLeaseInfoMissing] = useState<LeaseInfoMissingAttention[]>([])
  const [smsNoRecipients, setSmsNoRecipients] = useState<SmsNoRecipientsAttention[]>([])
  const [dismissedAttention, setDismissedAttention] = useState<DismissedAttentionIds>({
    ticketIds: new Set(),
    runIds: new Set(),
  })
  const [pmServiceBatches, setPmServiceBatches] = useState<PmServiceBatchSnapshot[]>([])
  const [pmReviewCard, setPmReviewCard] = useState<PmServiceCard | null>(null)
  // Card buttons only queue the action; the effect below runs it outside render.
  const [pmPendingAction, setPmPendingAction] = useState<
    { kind: 'approve' | 'snooze'; card: PmServiceCard } | null
  >(null)
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
  const [externalVendorTicketId, setExternalVendorTicketId] = useState<string | null>(null)
  const [externalVendorJobContext, setExternalVendorJobContext] =
    useState<ExternalVendorJobContextDto | null>(null)
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
  const [invoiceApprovalSuccess, setInvoiceApprovalSuccess] =
    useState<InvoiceApprovalSuccess | null>(null)
  const invoiceApprovalPhaseRef = useRef<InvoiceApprovalPhase>('idle')
  const lastApprovedInvoiceIdRef = useRef<string | null>(null)
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
  const findVendorDeepLinkHandledRef = useRef<string | null>(null)
  const attentionTrackingReadyRef = useRef(false)
  const allowImportedOperationsRef = useRef(true)
  const invoicePaymentReturnHandledRef = useRef<string | null>(null)
  const invoicePayReviewsRef = useRef(invoicePayReviews)
  useEffect(() => {
    invoicePayReviewsRef.current = invoicePayReviews
  }, [invoicePayReviews])

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
        const [ytdPaidTotal, spendRows] = await Promise.all([
          review?.vendorId
            ? fetchVendorYtdPaidTotal({
                landlordId: getActiveLandlordId(),
                vendorId: review.vendorId,
              })
            : Promise.resolve(null),
          fetchRecognizedMaintenanceSpend(),
        ])
        if (cancelled) return

        setRecognizedSpend(spendRows)
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
        healthSignals,
        residentsResult,
        invoicesResult,
        feedbackResult,
        canonicalPropertiesResult,
        leaseInfoMissingResult,
        dismissedAttentionResult,
        recognizedSpendResult,
        mrSpendResult,
        smsNoRecipientsResult,
      ] = await Promise.all([
          allowImportedOperations
            ? supabase
                .from('maintenance_request_enriched')
                .select(
                  'id, created_at, assigned_at, unit, unit_id, property_id, building, email, description, issue_category, assigned_vendor_id, vendor_work_status, auto_reassign_last_outcome, urgency, severity, priority, due_at, scheduled_at, resident_name, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at, inspection_report_id, resident_reported_recurring',
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
            .select('id, name, category, active, onboarding_overridden_at')
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
          fetchPropertyHealthSignals(),
          supabase
            .from('users')
            .select('id, full_name, unit, building, status, move_in_date, lease_end_date, monthly_rent, balance_due, phone, email, activation_status')
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
          // Always load approved invoice spend for YTD — independent of portfolio sync.
          fetchRecognizedMaintenanceSpend(),
          allowImportedOperations
            ? supabase
                .from('maintenance_requests')
                .select('id, completed_at, recognized_spend_amount, recognized_spend_at, description')
                .eq('landlord_id', landlordId)
                .order('created_at', { ascending: false })
                .limit(500)
            : Promise.resolve({ data: [], error: null }),
          loadSmsNoRecipientsAttention(landlordId),
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
            overridden: Boolean(r.onboarding_overridden_at),
          }))
          .filter((v) => v.id && v.name)
        const vendorIds = vendorRows.map((v) => v.id)
        const outreachStartedIds = new Set<string>()
        for (const v of vendorRows) {
          if (v.overridden) outreachStartedIds.add(v.id)
        }
        if (vendorIds.length > 0) {
          const { data: verificationRows } = await supabase
            .from('vendor_verifications')
            .select('vendor_id, status')
            .in('vendor_id', vendorIds)
          for (const row of (verificationRows ?? []) as Record<string, unknown>[]) {
            const id = asString(row.vendor_id)
            // Any verification row = invite/outreach started.
            if (id) outreachStartedIds.add(id)
          }
        }
        const mappedVendors = vendorRows.map((v) => ({
          id: v.id,
          name: v.name,
          category: v.category,
          active: v.active,
          verified: outreachStartedIds.has(v.id),
        }))
        setVendors(mappedVendors)
        for (const v of mappedVendors) vendorNameById[v.id] = v.name
      } else {
        setVendors([])
      }

      if (!ticketsResult.error) {
        const spendById = new Map<string, Record<string, unknown>>()
        if (!mrSpendResult.error) {
          for (const row of (mrSpendResult.data ?? []) as Record<string, unknown>[]) {
            if (!isLandlordFacingMaintenanceRequest(row)) continue
            const id = asString(row.id)
            if (id) spendById.set(id, row)
          }
        }
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[]).filter(isLandlordFacingMaintenanceRequest).map((raw) => {
            const spend = spendById.get(asString(raw.id))
            const merged = spend ? { ...raw, ...spend } : raw
            if (
              merged.recognized_spend_amount != null &&
              merged.total_cost == null &&
              merged.invoice_total == null
            ) {
              merged.total_cost = merged.recognized_spend_amount
            }
            // Prefer recognition timestamp for YTD attribution when present.
            if (
              typeof merged.recognized_spend_at === 'string' &&
              merged.recognized_spend_at.trim() &&
              !merged.completed_at
            ) {
              merged.completed_at = merged.recognized_spend_at
            }
            return normalizeTicketRow(merged, vendorNameById)
          }),
        )
      } else {
        console.error(
          '[admin overview] maintenance requests fetch failed',
          ticketsResult.error.message,
        )
      }

      setRecognizedSpend(
        Array.isArray(recognizedSpendResult) ? recognizedSpendResult : [],
      )
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
        ? ((ticketsResult.data ?? []) as Record<string, unknown>[])
            .filter(isLandlordFacingMaintenanceRequest)
            .map((raw) => normalizeTicketRow(raw, vendorNameById))
        : []
      const ticketById = new Map(ticketRowsForInvoice.map((t) => [t.id, t]))

      const payReviews: InvoicePaymentReview[] = []
      const invoiceProperties = canonicalPropertiesResult.ok
        ? canonicalPropertiesResult.properties
        : []
      // Always surface submitted invoices. Payments stay off for Limited Alpha;
      // the landlord can still review and approve the cost.
      if (!invoicesResult.error) {
        const paymentsEnabled = landlordHasPayments(getActiveLandlordId())
        for (const row of (invoicesResult.data ?? []) as Record<string, unknown>[]) {
          const invoiceId = asString(row.id)
          const ticketId = asString(row.maintenance_request_id)
          if (!invoiceId || !ticketId) continue
          const rating = ratingByTicket.get(ticketId)
          // Full accounts keep the 4★ gate before pay; Limited Alpha can approve without it.
          if (paymentsEnabled && (rating == null || rating < 4)) continue
          const ticket = ticketById.get(ticketId)
          const propertyType = propertyTypeForInvoice(
            invoiceProperties,
            ticket?.propertyId,
            ticket?.building,
          )
          const propertyLabel = propertyLabelForInvoice(
            invoiceProperties,
            ticket?.propertyId,
            ticket?.building,
          )
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
            building: ticket?.building?.trim() || propertyLabel,
            residentName: ticket?.residentName ?? '',
            vendorName:
              (vendorId ? vendorNameById[vendorId] : '') ||
              ticket?.assignedVendorName ||
              'Vendor',
            vendorId: vendorId || null,
            issueCategory: ticket?.issueCategory ?? null,
            submittedAt: asString(row.submitted_at),
            rating: rating ?? null,
            invoiceNumber: asString(row.invoice_number) || null,
            documentPath: asString(row.document_path) || null,
            propertyType,
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
            propertyId: asString(r.property_id) || null,
            status: asString(r.status).toLowerCase(),
          })),
        )
      }

      setWorkflowData(workflowResult)
      setPmTasks(healthSignals.pmTasks)
      setFeedback(healthSignals.feedback)
      setVendorMetrics(healthSignals.vendorMetrics)
      setHealthAssets(healthSignals.assets)
      setHealthInspections(healthSignals.inspections)
      setHealthDamageReports(healthSignals.damageReports)

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
            activationStatus: asString(raw.activation_status) || null,
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
      setSmsNoRecipients(smsNoRecipientsResult)
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

  // Active Tasks delete / dismiss happens on other routes; refresh ops KPI when Overview is shown again.
  useEffect(() => {
    let cancelled = false
    async function refreshWorkflowKpi() {
      if (!allowImportedOperationsRef.current) return
      try {
        const next = await fetchAdminWorkflowDashboard()
        if (!cancelled) setWorkflowData(next)
      } catch (err) {
        console.warn('[admin overview] workflow kpi refresh', err)
      }
    }
    function onVisible() {
      if (document.visibilityState === 'visible') void refreshWorkflowKpi()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const [overviewNowMs] = useState(() => Date.now())
  const now = overviewNowMs
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000

  const openTickets = useMemo(() => tickets.filter(isTicketOpen), [tickets])

  const canonicalPropertiesForHealth = useMemo(
    (): PropertyHealthCanonicalProperty[] =>
      canonicalProperties.map((property) => ({
        id: property.id,
        name: property.name,
        propertyType: property.propertyType,
      })),
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
      assets: healthAssets,
      inspections: healthInspections,
      damageReports: healthDamageReports,
      residents,
      canonicalProperties: canonicalPropertiesForHealth,
      now,
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, healthAssets, healthInspections, healthDamageReports, residents, canonicalPropertiesForHealth, now])

  const kpis = useMemo(() => {
    const openRepairs = openTickets.length
    const openRepairsRecent = countCreatedBetween(
      tickets,
      now - fourWeeksMs,
      now,
    )
    const openRepairsPrevious = countCreatedBetween(
      tickets,
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
    )

    const scheduledVisits = tickets.filter((ticket) =>
      isUpcomingScheduledVisit(ticket, now),
    ).length
    const scheduledVisitsRecent = countScheduledBetween(
      tickets,
      now - fourWeeksMs,
      now,
    )
    const scheduledVisitsPrevious = countScheduledBetween(
      tickets,
      now - 2 * fourWeeksMs,
      now - fourWeeksMs,
    )

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

    // YTD maintenance cost: approved invoice totals. Fall back to ticket
    // recognized_spend_amount when the invoice query is empty (RLS / lag).
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime()
    const invoiceYtd = sumRecognizedSpendBetween(recognizedSpend, startOfYear, now)
    const ticketYtd = tickets.reduce((sum, t) => {
      if (t.totalCost == null || t.totalCost <= 0) return sum
      const at = ticketSpendDate(t)
      if (Number.isNaN(at) || at < startOfYear || at >= now) return sum
      return sum + t.totalCost
    }, 0)
    const ytdMaintenanceCost = Math.round(invoiceYtd > 0 ? invoiceYtd : ticketYtd)
    // #region agent log
    // #endregion
    // 4-week-over-4-week change in recognized invoice spend (rising spend = bad).
    const ytdMaintenanceCostDelta = Math.round(
      sumRecognizedSpendBetween(recognizedSpend, now - fourWeeksMs, now) -
        sumRecognizedSpendBetween(
          recognizedSpend,
          now - 2 * fourWeeksMs,
          now - fourWeeksMs,
        ),
    )

    return {
      openRepairs,
      openRepairsDelta: openRepairsRecent - openRepairsPrevious,
      scheduledVisits,
      scheduledVisitsDelta: scheduledVisitsRecent - scheduledVisitsPrevious,
      propertyHealth,
      propertyHealthDelta,
      vendorResponse,
      vendorResponseDelta,
      ytdMaintenanceCost,
      ytdMaintenanceCostDelta,
    }
  }, [tickets, openTickets, healthReport, recognizedSpend, now, fourWeeksMs])

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
        !shouldSkipSlaReassignForNeedsAdminVendor({
          assignedVendorId: ticket.assignedVendorId,
          vendorWorkStatus: ticket.vendorWorkStatus,
          workflowNeedsAdminVendor: slaEscalatedNoVendorKeys.has(ticket.id),
        }) && ticketHasRosterAlternative(ticket, vendors, units),
    )
    if (toAuto.length === 0) return

    let cancelled = false
    void (async () => {
      let anyReassigned = false
      for (const ticket of toAuto) {
        if (cancelled) break
        try {
          const result = await postSlaAutoReassign({ url, secret, ticketId: ticket.id })
          if (result.outcome === 'reassigned' || result.outcome === 'awaiting_landlord_choice') {
            anyReassigned = true
          }
        } catch (err) {
          console.warn('[admin overview] sla auto-reassign', ticket.id, err)
        }
      }
      if (cancelled || !anyReassigned || !supabase) return

      const landlordId = getActiveLandlordId()
      const allowImportedOperations = allowImportedOperationsRef.current
      const [ticketsResult, workflowResult] = await Promise.all([
        allowImportedOperations
          ? supabase
              .from('maintenance_request_enriched')
              .select(
                'id, created_at, assigned_at, unit, unit_id, property_id, building, description, issue_category, assigned_vendor_id, vendor_work_status, auto_reassign_last_outcome, urgency, severity, priority, due_at, scheduled_at, resident_name, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at, inspection_report_id, resident_reported_recurring',
              )
              .eq('landlord_id', landlordId)
              .order('created_at', { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
        allowImportedOperations
          ? fetchAdminWorkflowDashboard()
          : Promise.resolve(emptyAdminWorkflowDashboardData()),
      ])

      if (cancelled) return
      setWorkflowData(workflowResult)
      if (!ticketsResult.error) {
        const vendorNameById = Object.fromEntries(vendors.map((v) => [v.id, v.name]))
        setTickets(
          ((ticketsResult.data ?? []) as Record<string, unknown>[])
            .filter(isLandlordFacingMaintenanceRequest)
            .map((raw) => normalizeTicketRow(raw, vendorNameById)),
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loading, slaOverdueTickets, slaEscalatedNoVendorKeys, vendors, units])

  const openEscalatedRailForTicket = useCallback((ticketId: string, opts?: { openFindVendor?: boolean }) => {
    setExternalVendorSuggestions([])
    setExternalVendorDiscoverError(null)
    setExternalVendorNotice(null)
    setExternalVendorTicketId(null)
    setExternalVendorJobContext(null)
    setFindExternalVendorOpen(opts?.openFindVendor === true)
    setEscalatedRailTarget({ kind: 'ticket', ticketId, preferExternalVendor: true })
    setEscalatedRailError(null)
  }, [])

  useEffect(() => {
    if (loading) return
    const ticketId = findExternalVendorTicketFromSearch(location.search)
    if (!ticketId) return
    if (findVendorDeepLinkHandledRef.current === ticketId) return
    findVendorDeepLinkHandledRef.current = ticketId
    openEscalatedRailForTicket(ticketId, { openFindVendor: true })
    const next = new URLSearchParams(location.search)
    next.delete(FIND_EXTERNAL_VENDOR_QUERY.flag)
    next.delete(FIND_EXTERNAL_VENDOR_QUERY.ticket)
    const qs = next.toString()
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true })
  }, [loading, location.pathname, location.search, navigate, openEscalatedRailForTicket])

  const openEscalatedRailForRun = useCallback((runId: string, preferExternalVendor = false) => {
    setExternalVendorSuggestions([])
    setExternalVendorDiscoverError(null)
    setExternalVendorNotice(null)
    setExternalVendorTicketId(null)
    setExternalVendorJobContext(null)
    setFindExternalVendorOpen(false)
    setEscalatedRailTarget({ kind: 'workflow', runId, preferExternalVendor })
    setEscalatedRailError(null)
  }, [])

  const lateRentReviewRuns = useMemo(
    () => (workflowData ? collectLateRentReviewRuns(workflowData) : []),
    [workflowData],
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

  const openInvoiceReview = useCallback((invoiceId: string) => {
    setInvoicePayError(null)
    setInvoicePaySuccess(null)
    setInvoiceApprovalSuccess(null)
    setInvoicePayRailId(invoiceId)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadPmServiceBatches() {
      if (!supabase) return
      const { data } = await supabase
        .from('preventive_maintenance_tasks')
        .select('id, title, status, due_at, unit_label, building, metadata')
        .eq('landlord_id', getActiveLandlordId())
        .limit(500)
      if (cancelled) return
      setPmServiceBatches(
        batchesFromPmTaskRows(
          ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id ?? ''),
            title: typeof row.title === 'string' ? row.title : null,
            status: typeof row.status === 'string' ? row.status : null,
            dueAt: typeof row.due_at === 'string' ? row.due_at : null,
            unitLabel: typeof row.unit_label === 'string' ? row.unit_label : null,
            building: typeof row.building === 'string' ? row.building : null,
            metadata: row.metadata,
          })) satisfies PmTaskAttentionRow[],
        ),
      )
    }
    void loadPmServiceBatches()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  const resolvePmBatch = useCallback((batchId: string, resolution: PmServiceBatchSnapshot['resolution'], snoozedUntil?: string | null) => {
    setPmServiceBatches((current) =>
      current.map((batch) =>
        batch.batchId === batchId
          ? { ...batch, resolution: resolution ?? batch.resolution, snoozedUntil: snoozedUntil ?? batch.snoozedUntil }
          : batch,
      ),
    )
  }, [])

  const approvePmBatch = useCallback(
    (card: PmServiceCard, unitIds: string[]) => {
      const batch = pmServiceBatches.find((row) => row.batchId === card.batchId)
      if (!batch) return
      const result = approvePmServiceSelection(batch, unitIds)
      resolvePmBatch(card.batchId, 'app')
      setPmReviewCard(null)
      setAwaitingDecisionListOpen(false)
      showAwaitingDecisionOutcome(
        {
          operationTitle: 'Preventive HVAC',
          context: card.context,
          kind: 'resolved',
          headline: 'Removed from Needs Your Attention',
          detail: result.summary,
          removedFromQueue: true,
        },
        card.key,
      )
      void persistPmServiceAppResolution({
        batchId: card.batchId,
        taskIds: unitIds,
        summary: result.summary,
      })
    },
    [pmServiceBatches, resolvePmBatch, showAwaitingDecisionOutcome],
  )

  const snoozePmBatch = useCallback(
    (card: PmServiceCard) => {
      const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      resolvePmBatch(card.batchId, null, until)
      void persistPmServiceAppResolution({
        batchId: card.batchId,
        taskIds: [],
        summary: 'Snoozed',
        snoozedUntil: until,
      })
    },
    [resolvePmBatch],
  )

  useEffect(() => {
    if (!pmPendingAction) return
    setPmPendingAction(null)
    const { kind, card } = pmPendingAction
    if (kind === 'approve') approvePmBatch(card, card.units.map((unit) => unit.id))
    else snoozePmBatch(card)
  }, [pmPendingAction, approvePmBatch, snoozePmBatch])

  const allAttentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    const completedTicketIds = collectCompletedWorkOrderTicketIds({
      tickets,
      workflowData,
    })

    for (const ticket of slaOverdueTickets) {
      if (completedTicketIds.has(ticket.id)) continue
      if (
        shouldSkipSlaReassignForNeedsAdminVendor({
          assignedVendorId: ticket.assignedVendorId,
          vendorWorkStatus: ticket.vendorWorkStatus,
          workflowNeedsAdminVendor: slaEscalatedNoVendorKeys.has(ticket.id),
        })
      ) {
        continue
      }
      if (ticketHasRosterAlternative(ticket, vendors, units)) continue
      if (isNeedsAttentionDismissed(dismissedAttention, { ticketId: ticket.id })) continue
      const building =
        ticket.building ??
        units.find(
          (u) => normalizeUnitLabel(u.unitLabel) === normalizeUnitLabel(ticket.unit),
        )?.building ??
        null
      const fallbackMeta = responseTimeNoVendorSummary(ticket.issueCategory)
      const scoped = buildInspectionScopedAttentionCopy({
        ticketId: ticket.id,
        workflowData,
        propertyLabel: building,
        unitLabel: ticket.unit,
        residentName: ticket.residentName,
        fallbackMeta,
      })
      items.push({
        key: `sla-${ticket.id}`,
        badge: isTicketCritical(ticket) ? 'critical' : 'warning',
        title: 'No vendor available — response time exceeded',
        context: scoped.context,
        meta: scoped.meta,
        actionLabel: 'Assign vendor',
        actionStyle: 'alert',
        emergencyRepair: ticket.urgency === 'emergency',
        dueAt: ticket.dueAt,
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
        const stalePendingAccept = isStalePendingAcceptNeedsAdminVendor({
          vendorWorkStatus: linkedTicket?.vendorWorkStatus ?? run.vendorWorkStatus,
          assignedVendorId: linkedTicket?.assignedVendorId ?? run.assignedVendorId,
          autoReassignLastOutcome:
            linkedTicket?.autoReassignLastOutcome ?? run.autoReassignLastOutcome,
          workflowNeedsAdminVendor: needsVendor,
        })
        const relative = run.lastEventAt ? formatRelativeTime(run.lastEventAt) : null
        const fallbackMeta = stalePendingAccept
          ? staleVendorAttentionSummary()
          : needsVendor
            ? adminVendorReason === 'vendor_declined_no_vendor'
              ? vendorDeclinedAttentionSummary()
              : adminVendorReason === 'sla_expired_no_vendor'
                ? responseTimeNoVendorSummary(issueCategory)
                : rosterGapAttentionSummary(issueCategory)
            : isLeaseRenewal
              ? leaseRenewalAttentionSummary(relative)
              : waitingAttentionSummary(relative)
        const scoped = ticketId
          ? buildInspectionScopedAttentionCopy({
              ticketId,
              run,
              workflowData,
              propertyLabel: run.propertyLabel,
              unitLabel: run.unitLabel,
              residentName: run.residentName,
              fallbackMeta,
            })
          : {
              meta: fallbackMeta,
              context: formatLocationContextLabel({
                propertyLabel: run.propertyLabel,
                unitLabel: run.unitLabel,
                residentName: run.residentName,
              }),
            }
        items.push({
          key: `run-${run.id}`,
          badge: needsVendor || isLeaseRenewal || stalePendingAccept ? 'critical' : 'warning',
          title: stalePendingAccept
            ? STALE_PENDING_ACCEPT_NEEDS_ADMIN_ATTENTION_TITLE
            : needsVendor
              ? maintenanceAdminVendorAttentionTitle(adminVendorReason)
              : isLeaseRenewal
                ? 'Lease Renewal Escalated'
                : `${run.templateName} Escalated`,
          context: scoped.context,
          meta: scoped.meta,
          actionLabel: needsVendor || stalePendingAccept ? 'Assign vendor' : 'Review',
          onAction: isLeaseRenewal
            ? () => openLeaseRenewalRail(run.id)
            : needsVendor || stalePendingAccept
              ? () => openEscalatedRailForRun(run.id, true)
              : () => openEscalatedRailForRun(run.id),
          actionStyle: needsVendor || stalePendingAccept ? 'alert' : undefined,
        })
      }

      // Sticky needs_admin + dead pending_accept on active runs (stall path) —
      // not only escalated workflow rows.
      const attentionTicketKeys = new Set(
        items
          .map((item) => item.key)
          .filter((key) => key.startsWith('sla-') || key.startsWith('run-')),
      )
      for (const ticket of openTickets) {
        if (completedTicketIds.has(ticket.id)) continue
        if (
          !isStalePendingAcceptNeedsAdminVendor({
            vendorWorkStatus: ticket.vendorWorkStatus,
            assignedVendorId: ticket.assignedVendorId,
            autoReassignLastOutcome: ticket.autoReassignLastOutcome,
            workflowNeedsAdminVendor: slaEscalatedNoVendorKeys.has(ticket.id),
          })
        ) {
          continue
        }
        if (isNeedsAttentionDismissed(dismissedAttention, { ticketId: ticket.id })) continue
        if (attentionTicketKeys.has(`sla-${ticket.id}`)) continue
        const alreadyViaRun = (workflowData.escalated ?? []).some((run) => {
          const tid = maintenanceTicketIdFromWorkflowRun({
            ...run,
            metadata: workflowData.runMetadata[run.id],
          })
          return tid === ticket.id
        })
        if (alreadyViaRun) continue
        const building =
          ticket.building ??
          units.find(
            (u) => normalizeUnitLabel(u.unitLabel) === normalizeUnitLabel(ticket.unit),
          )?.building ??
          null
        const scoped = buildInspectionScopedAttentionCopy({
          ticketId: ticket.id,
          workflowData,
          propertyLabel: building,
          unitLabel: ticket.unit,
          residentName: ticket.residentName,
          fallbackMeta: staleVendorAttentionSummary(),
        })
        items.push({
          key: `stale-admin-${ticket.id}`,
          badge: 'critical',
          title: STALE_PENDING_ACCEPT_NEEDS_ADMIN_ATTENTION_TITLE,
          context: scoped.context,
          meta: scoped.meta,
          actionLabel: 'Assign vendor',
          actionStyle: 'alert',
          onAction: () => openEscalatedRailForTicket(ticket.id),
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
          meta: lateRentAttentionSummary(
            row.rentDueDate
              ? new Date(row.rentDueDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              : null,
          ),
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
        meta: leaseInfoAttentionSummary(),
        actionLabel: 'Review resident',
        onAction: () => navigate(path),
      })
    }

    for (const row of smsNoRecipients) {
      items.push({
        key: `sms-no-recipients-${row.messageType ?? row.id}`,
        badge: 'warning',
        title: 'SMS could not be delivered',
        context: 'Account phone missing',
        meta: smsDeliveryAttentionSummary(),
        actionLabel: 'Open account',
        onAction: () => navigate('/admin/settings'),
      })
    }

    for (const inv of invoicePayReviews) {
      if (completedTicketIds.has(inv.maintenanceRequestId)) continue
      const card = invoiceAttentionCard({
        vendorName: inv.vendorName,
        amount: inv.totalCost,
      })
      items.push({
        key: `invoice-${inv.invoiceId}`,
        badge: 'warning',
        title: card.title,
        context: invoiceReviewLocation({
          building: inv.building,
          unit: inv.unit,
          propertyType: inv.propertyType,
          residentName: inv.residentName,
        }),
        meta: card.summary,
        actionLabel: card.actionLabel,
        onAction: () => openInvoiceReview(inv.invoiceId),
      })
    }

    for (const batch of pmServiceBatches) {
      for (const card of derivePmServiceCards(batch)) {
        const approval = card.subtype === 'batch_approval'
        items.push({
          key: card.key,
          badge: card.badge,
          title: card.title,
          context: card.context,
          meta: card.meta,
          actionLabel: approval ? 'Review' : 'Review',
          secondaryActionLabel: approval ? 'Approve all' : undefined,
          onSecondaryAction: approval ? () => setPmPendingAction({ kind: 'approve', card }) : undefined,
          onAction: approval ? () => setPmReviewCard(card) : undefined,
          onSnooze: card.canSnooze ? () => setPmPendingAction({ kind: 'snooze', card }) : undefined,
          pmSafety: card.safety,
          dueAt: card.dueAt,
        })
      }
    }

    return sortNeedsAttention(
      items.map((item) => ({
        ...item,
        id: item.key,
        safety: item.pmSafety === true,
        emergencyRepair: item.emergencyRepair === true,
      })),
    )
  }, [workflowData, slaOverdueTickets, slaEscalatedNoVendorKeys, dismissedAttention, units, vendors, tickets, lateRentReviewRuns, invoicePayReviews, leaseInfoMissing, smsNoRecipients, overviewResidents, propertyIdByBuilding, navigate, openEscalatedRailForTicket, openEscalatedRailForRun, openLateRentRail, openLeaseRenewalRail, openInvoiceReview, pmServiceBatches])

  const attentionItems = useMemo(() => allAttentionItems.slice(0, 3), [allAttentionItems])

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
      setExternalVendorTicketId(null)
      setExternalVendorJobContext(null)
      setFindExternalVendorOpen(false)
      return
    }

    let cancelled = false
    let ticketIdForAction: string | null = null
    let builtReview: SlaOverdueActionReview | null = null

    if (escalatedRailTarget.kind === 'ticket') {
      const ticket = tickets.find((t) => t.id === escalatedRailTarget.ticketId)
      ticketIdForAction = escalatedRailTarget.ticketId
      if (!ticket) {
        builtReview = buildExternalVendorFallbackReview({
          id: escalatedRailTarget.ticketId,
          createdAt: new Date().toISOString(),
          dueAt: null,
          urgency: 'medium',
          unit: '',
          building: null,
          description: null,
          issueCategory: null,
          assignedVendorId: null,
          assignedVendorName: null,
          vendorWorkStatus: '',
          residentName: null,
          assignedAt: null,
        })
      } else {
        const ticketInput = overviewTicketToInput(ticket, units)
        builtReview =
          buildSlaOverdueActionReview(ticketInput, vendors, vendorMetrics) ??
          buildExternalVendorFallbackReview(ticketInput)
      }
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
          .then(async () => {
            if (cancelled) return
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
    if (ticketIdForAction) setExternalVendorTicketId(ticketIdForAction)

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
        if (result.jobContext) setExternalVendorJobContext(result.jobContext)
        const pick = rankedSuggestions[0]
        if (!pick) return
        setEscalatedReview((prev) => {
          if (!prev) return prev
          const meta = [
            pick.rating != null && Number.isFinite(Number(pick.rating))
              ? `${Number(pick.rating).toFixed(1)}★`
              : null,
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

  const applyExternalVendorDiscovery = useCallback((result: DiscoverExternalVendorsOk) => {
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
    setExternalVendorNotice(sanitized.notice)
    if (result.areaLabel) setExternalVendorAreaLabel(result.areaLabel)
    if (result.locationLabel) setExternalVendorLocationLabel(result.locationLabel)
    if (result.issueCategory !== undefined) {
      setExternalVendorIssueCategory(result.issueCategory)
    }
    if (result.ticketId) setExternalVendorTicketId(result.ticketId)
    if (result.jobContext) setExternalVendorJobContext(result.jobContext)
    const pick = rankedSuggestions[0]
    if (!pick) return
    setEscalatedReview((prev) => {
      if (!prev) return prev
      const meta = [
        pick.rating != null && Number.isFinite(Number(pick.rating))
          ? `${Number(pick.rating).toFixed(1)}★`
          : null,
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
  }, [])

  const runExternalVendorDiscovery = useCallback(async (ticketId: string) => {
    const discoverUrl = resolveDiscoverExternalVendorsUrl()
    const secret = getAdminEdgeSecret()
    if (!discoverUrl || !secret) {
      setExternalVendorDiscoverError(
        'External vendor search is not configured (check VITE_ADMIN_REASSIGN_SECRET).',
      )
      return
    }
    setEscalatedRailLoading(true)
    setExternalVendorDiscoverError(null)
    setExternalVendorTicketId(ticketId)
    try {
      const result = await postDiscoverExternalVendors({
        url: discoverUrl,
        secret,
        ticketId,
      })
      applyExternalVendorDiscovery(result)
    } catch (err) {
      console.warn('[admin overview] discover external vendors', err)
      const message = getErrorMessage(err, "Couldn't find vendors nearby. Please try again.")
      setEscalatedRailError(message)
      setExternalVendorDiscoverError(message)
    } finally {
      setEscalatedRailLoading(false)
    }
  }, [applyExternalVendorDiscovery])

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
        setEscalatedRailError(null)
        setFindExternalVendorOpen(true)
        const ticketId = review.ticketId?.trim()
        if (ticketId) void runExternalVendorDiscovery(ticketId)
        else {
          setExternalVendorDiscoverError(
            'Could not link this escalation to a maintenance ticket.',
          )
        }
        return
      }

      setEscalatedRailError('This ticket is handled automatically when a roster vendor is available.')
    },
    [navigate, runExternalVendorDiscovery],
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
          vendorCategory: externalVendorIssueCategory,
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
      externalVendorIssueCategory,
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
    [closeLeaseRenewalRail, overviewResidents, showAwaitingDecisionOutcome, workflowData],
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

  const portfolioInsightFindings = useMemo<PortfolioInsightFinding[]>(() => {
    return computePortfolioInsights({
      tickets: tickets.map((t) => ({
        id: t.id,
        building: t.building,
        unit: t.unit,
        unitId: t.unitId,
        propertyId: t.propertyId,
        issueCategory: t.issueCategory,
        description: t.description,
        vendorWorkStatus: t.vendorWorkStatus,
        createdAt: t.createdAt,
        assignedVendorId: t.assignedVendorId,
        urgency: t.urgency,
        residentReportedRecurring: t.residentReportedRecurring,
        inspectionReportId: t.inspectionReportId,
      })),
      units: units.map((u) => ({
        id: u.id,
        unitLabel: u.unitLabel,
        building: u.building,
        propertyId: u.propertyId,
      })),
      vendorResponsePct: kpis.vendorResponse,
      assignedWorkOrderCount: tickets.filter((t) => t.assignedVendorId).length,
      now,
    })
  }, [tickets, units, kpis.vendorResponse, now])

  const [insightCards, setInsightCards] = useState<SynthesizedInsightCard[]>([])
  const [insightActionBusy, setInsightActionBusy] = useState(false)
  const [insightActionError, setInsightActionError] = useState<string | null>(null)
  const [insightDetailsCard, setInsightDetailsCard] = useState<SynthesizedInsightCard | null>(null)
  const [insightSchedulingByCard, setInsightSchedulingByCard] = useState<
    Record<string, InsightSchedulingCardState>
  >({})
  const [noInspectorPrompt, setNoInspectorPrompt] = useState<{
    ticketId: string
    targetDay: string | null
    building: string | null
  } | null>(null)
  const [insightPipelineRunId, setInsightPipelineRunId] = useState<string | null>(null)
  const [insightPipelineDetail, setInsightPipelineDetail] = useState<WorkflowPipelineDetail | null>(null)
  const [insightPipelineLoading, setInsightPipelineLoading] = useState(false)

  const insightWorkflowRuns = useMemo(
    () => (workflowData ? collectAdminWorkflowRuns(workflowData) : []),
    [workflowData],
  )

  const recommendedActionCards = useMemo(
    () => insightCards.filter((card) => card.tag !== 'RISK'),
    [insightCards],
  )

  useEffect(() => {
    if (loading) return
    if (portfolioInsightFindings.length === 0) {
      setInsightCards([])
      return
    }
    const landlordId = getActiveLandlordId()
    const saved = readCachedPropertyInsightCards(landlordId, portfolioInsightFindings)
    if (saved) {
      setInsightCards(saved)
      return
    }
    // Plain aggregates immediately; synthesis enriches in one refresh call.
    setInsightCards(applyInsightSynthesis(portfolioInsightFindings, null, { failed: true }))
    let cancelled = false
    const url = resolveSynthesizePropertyInsightsUrl()
    const secret = getAdminEdgeSecret()
    if (!url || !secret) return
    void synthesizePropertyInsightsCached({
      url,
      secret,
      landlordId,
      findings: portfolioInsightFindings,
    })
      .then((result) => {
        if (cancelled) return
        setInsightCards(result.cards)
      })
      .catch(() => {
        // Keep plain aggregate cards already shown.
      })
    return () => {
      cancelled = true
    }
  }, [loading, portfolioInsightFindings])

  const handleInsightAction = useCallback(async (card: SynthesizedInsightCard) => {
    setInsightActionBusy(true)
    setInsightActionError(null)
    try {
      const result = await runPropertyInsightAction(card, {
        ...defaultPropertyInsightActionDeps,
        resolveAssignedVendorId: async (ticketIds) => {
          for (const id of ticketIds) {
            const ticket = tickets.find((t) => t.id === id)
            if (ticket?.assignedVendorId) return ticket.assignedVendorId
          }
          return null
        },
      })
      if (!result.ok) {
        setInsightActionError(result.error)
        return
      }
      if (result.navigateTo) {
        navigate(result.navigateTo)
        return
      }
      if (result.scheduling) {
        const next = schedulingStateFromActionResult(result.scheduling)
        setInsightSchedulingByCard((prev) => ({ ...prev, [card.id]: next }))
        if (next.status === 'needs_external' && next.ticketId) {
          setNoInspectorPrompt({
            ticketId: next.ticketId,
            targetDay: next.targetDay,
            building: card.building,
          })
        }
      }
    } catch (err) {
      setInsightActionError(getErrorMessage(err, 'Could not start that action.'))
    } finally {
      setInsightActionBusy(false)
    }
  }, [navigate, tickets])

  const openInsightFindExternal = useCallback(
    (ticketId: string) => {
      setExternalVendorSuggestions([])
      setExternalVendorDiscoverError(null)
      setExternalVendorNotice(null)
      setExternalVendorTicketId(ticketId)
      setExternalVendorJobContext(null)
      setFindExternalVendorOpen(true)
      void runExternalVendorDiscovery(ticketId)
    },
    [runExternalVendorDiscovery],
  )

  useEffect(() => {
    const probing = Object.values(insightSchedulingByCard).filter(
      (s) => s.status === 'probing' && s.requestId,
    )
    if (probing.length === 0 || !supabase) return
    const client = supabase
    let cancelled = false
    const tick = async () => {
      for (const state of probing) {
        if (!state.requestId) continue
        const { data } = await client
          .from('insight_scheduling_requests')
          .select('status, inspector_name, confirmed_window, ticket_id, target_day')
          .eq('id', state.requestId)
          .maybeSingle()
        if (cancelled || !data) continue
        const status = String(data.status ?? '')
        if (status === 'accepted') {
          setInsightSchedulingByCard((prev) => {
            const cardId = Object.entries(prev).find(([, v]) => v.requestId === state.requestId)?.[0]
            if (!cardId) return prev
            return {
              ...prev,
              [cardId]: {
                status: 'accepted',
                ticketId: typeof data.ticket_id === 'string' ? data.ticket_id : state.ticketId,
                targetDay:
                  typeof data.target_day === 'string'
                    ? String(data.target_day).slice(0, 10)
                    : state.targetDay,
                inspectorName:
                  typeof data.inspector_name === 'string' ? data.inspector_name : null,
                confirmedWindow:
                  typeof data.confirmed_window === 'string' ? data.confirmed_window : null,
                holdId: null,
                requestId: state.requestId,
              },
            }
          })
        } else if (status === 'needs_external') {
          const ticketId = typeof data.ticket_id === 'string' ? data.ticket_id : state.ticketId
          const targetDay =
            typeof data.target_day === 'string'
              ? String(data.target_day).slice(0, 10)
              : state.targetDay
          let prompt: { ticketId: string; targetDay: string | null; building: string | null } | null =
            null
          setInsightSchedulingByCard((prev) => {
            const cardId = Object.entries(prev).find(([, v]) => v.requestId === state.requestId)?.[0]
            if (!cardId) return prev
            if (prev[cardId]?.status !== 'needs_external' && ticketId) {
              prompt = {
                ticketId,
                targetDay,
                building: insightCards.find((card) => card.id === cardId)?.building ?? null,
              }
            }
            return {
              ...prev,
              [cardId]: {
                status: 'needs_external',
                ticketId,
                targetDay,
                inspectorName: null,
                confirmedWindow: null,
                holdId: null,
                requestId: state.requestId,
              },
            }
          })
          if (prompt) setNoInspectorPrompt(prompt)
        }
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [insightSchedulingByCard, insightCards])

  const insightDetailsItems = useMemo<RecommendedActionWorkOrderItem[]>(() => {
    if (!insightDetailsCard) return []
    const byId = new Map(tickets.map((t) => [t.id, t]))
    const summaryById = new Map(
      (insightDetailsCard.ticketSummaries ?? []).map((s) => [s.id, s.description]),
    )
    return insightDetailsCard.ticketIds.map((ticketId) => {
      const ticket = byId.get(ticketId)
      const fallbackSummary = summaryById.get(ticketId) ?? null
      const categoryLabel = ticket
        ? resolveMaintenanceTypeLabel(ticket.issueCategory, ticket)
        : insightDetailsCard.categoryLabel
      const status = (ticket?.vendorWorkStatus ?? '').trim()
      const statusLabel = status
        ? status.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
        : null
      const location = [ticket?.building, ticket?.unit ? `Unit ${ticket.unit}` : null]
        .filter(Boolean)
        .join(' · ')
      return {
        id: ticketId,
        title: formatWorkOrderRefFromTicketId(ticketId),
        summary:
          ticket?.description?.trim() ||
          fallbackSummary ||
          categoryLabel ||
          'Maintenance request',
        context: insightDetailWorkOrderContext(
          location || insightDetailsCard.unitLabel || insightDetailsCard.building || null,
          insightDetailsCard.building,
        ),
        categoryLabel: categoryLabel || null,
        statusLabel,
        critical: ticket ? isTicketCritical(ticket) : false,
      }
    })
  }, [insightDetailsCard, tickets])

  const closeInsightDetailsRail = useCallback(() => {
    setInsightDetailsCard(null)
    setInsightPipelineRunId(null)
    setInsightPipelineDetail(null)
    setInsightPipelineLoading(false)
  }, [])

  const handleInsightWorkOrderSelect = useCallback(
    (item: RecommendedActionWorkOrderItem) => {
      const ticketId = item.id.trim()
      if (!ticketId) return
      const runId = pickWorkflowRunIdForTicket(
        insightWorkflowRuns,
        ticketId,
        workflowData?.runMetadata,
      )
      if (runId) {
        navigate(insightWorkOrderHref({ runId, ticketId }))
        return
      }
      if (!workflowData) {
        navigate(`/admin/workflows?ticket=${encodeURIComponent(ticketId)}`)
        return
      }
      void lookupWorkflowRunIdForTicket(ticketId).then((found) => {
        const loaded = found && insightWorkflowRuns.some((row) => row.id === found) ? found : null
        navigate(insightWorkOrderHref({ runId: loaded, ticketId }))
      })
    },
    [insightWorkflowRuns, navigate, workflowData],
  )

  useEffect(() => {
    if (!insightPipelineRunId || !workflowData) {
      if (!insightPipelineRunId) {
        setInsightPipelineDetail(null)
        setInsightPipelineLoading(false)
      }
      return
    }

    let cancelled = false
    setInsightPipelineLoading(true)
    setInsightPipelineDetail(null)

    void fetchWorkflowPipelineDetail(
      insightPipelineRunId,
      insightWorkflowRuns,
      workflowData.runMetadata,
    ).then((result) => {
      if (cancelled) return
      setInsightPipelineDetail(result)
      setInsightPipelineLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [insightPipelineRunId, workflowData, insightWorkflowRuns])

  const updatedCaption =
    loading || !lastUpdated ? 'Updating…' : formatUpdatedAt(lastUpdated)
  const healthScoreReady = shouldShowPropertyHealthScore(healthReport.portfolio?.status)
  const healthFactorBreakdown =
    !loading && healthReport.portfolio && healthReport.portfolio.status !== 'pending_setup'
      ? propertyHealthFactorBreakdownLines(healthReport.portfolio.components)
      : undefined
  const healthKpiValue = loading
    ? '—'
    : resolvePropertyHealthKpiValue(
        healthReport.portfolio?.status,
        healthReport.portfolio?.score,
        'percent',
      )
  const propertyHealthPercent = propertyHealthDonutPercent(
    kpis.propertyHealth,
    !loading && healthScoreReady,
  )

  const escalatedRailOpen = escalatedRailTarget != null && escalatedReview != null
  const stackedVendorRails = isDesktopAdmin && escalatedRailOpen && findExternalVendorOpen
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
    invoiceApprovalPhaseRef.current = 'idle'
    lastApprovedInvoiceIdRef.current = null
    setInvoicePayRailId(null)
    setInvoicePayError(null)
    setInvoicePaySuccess(null)
    setInvoiceApprovalSuccess(null)
  }, [invoicePaySaving])

  const handleInvoicePayApprove = useCallback(async (note?: string) => {
    if (!invoicePayReview) return
    const phase =
      invoiceApprovalPhaseRef.current === 'approved' &&
      lastApprovedInvoiceIdRef.current !== invoicePayReview.invoiceId
        ? 'idle'
        : invoiceApprovalPhaseRef.current
    const started = startInvoiceApproval(phase)
    if (!started.submit) return
    invoiceApprovalPhaseRef.current = 'submitting'
    setInvoicePaySaving(true)
    setInvoicePayError(null)
    const invoiceId = invoicePayReview.invoiceId
    const vendorName = invoicePayReview.vendorName
    const amountLabel = formatInvoiceAmount(invoicePayReview.totalCost)
    try {
      await approveMaintenanceInvoice(invoiceId, note)
      const spendRows = await fetchRecognizedMaintenanceSpend()
      setRecognizedSpend(spendRows)
      invoiceApprovalPhaseRef.current = finishInvoiceApproval(true)
      lastApprovedInvoiceIdRef.current = invoiceId
      skipAutoOutcomeKeysRef.current.add(`invoice-${invoiceId}`)
      setInvoicePayReviews((prev) => prev.filter((row) => row.invoiceId !== invoiceId))
      setInvoiceApprovalSuccess({ vendorName, amountLabel })
      setInvoicePayRailId(invoiceId)
    } catch (err) {
      invoiceApprovalPhaseRef.current = finishInvoiceApproval(false)
      setInvoiceApprovalSuccess(null)
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
          operationTitle: 'Invoice needs approval',
          context: invoiceReviewLocation({
            building: invoicePayReview.building,
            unit: invoicePayReview.unit,
            propertyType: invoicePayReview.propertyType,
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
    <div className="flex w-full min-w-0 max-w-full flex-col gap-4 overflow-x-hidden px-4 pb-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-[34px] font-semibold leading-10 tracking-[0.0703px] text-[#0a0a0a]">
            {greetingTitle}
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            See what&apos;s happening across your portfolio.
          </p>
        </div>
      </div>

      {/* Needs Your Attention — top of page, under greeting */}
      <section
        id={TRY_DEMO_SPOTLIGHT_ATTENTION_ID}
        className="relative z-0 flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e7eb] px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Needs Your Attention
            </h2>
            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-[4px] bg-[#fef9c2] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-[#a65f00] tabular-nums">
              {loading ? '—' : allAttentionItems.length}
            </span>
            {!loading && criticalAttentionCount > 0 ? (
              <span className="text-[12px] font-medium leading-4 text-[#DA4951] tabular-nums">
                {criticalAttentionCount} critical
              </span>
            ) : null}
          </div>
          {allAttentionItems.length > 3 ? (
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
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-[#f3f4f6]">
          {loading ? (
            <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
          ) : attentionItems.length === 0 ? (
            <p className="px-6 py-8 text-center text-[13px] text-[#6a7282]">
              Nothing needs attention.
            </p>
          ) : (
            attentionItems.map((item, index) =>
              item.key.startsWith('pm_') ? (
                <div
                  key={item.key}
                  className="sa-enter flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6"
                  style={{ animationDelay: `${Math.min(index, 3) * 40}ms` }}
                >
                  <div className="flex w-[4.75rem] shrink-0 items-center sm:justify-start">
                    <span
                      className={[
                        'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                        item.badge === 'critical'
                          ? 'bg-[#E3646C] text-white'
                          : 'bg-[#fef9c2] text-[#a65f00]',
                      ].join(' ')}
                    >
                      {item.badge === 'critical' ? 'Critical' : 'Warning'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 basis-0">
                    <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                      {item.title}
                    </p>
                    {item.context ? (
                      <p className="mt-0.5 truncate text-[13px] leading-5 text-[#6a7282]">{item.context}</p>
                    ) : null}
                  </div>
                  <p className="min-w-0 flex-1 basis-0 text-[12px] leading-4 text-[#6a7282] sm:text-[13px] sm:leading-5">
                    {item.meta}
                  </p>
                  <PmAttentionActions
                    approveLabel={item.secondaryActionLabel}
                    onApprove={item.onSecondaryAction}
                    reviewLabel={item.actionLabel}
                    onReview={item.onAction}
                    onSnooze={item.onSnooze}
                  />
                </div>
              ) : (
              <NeedsAttentionRow
                key={item.key}
                actionLabel={item.actionLabel}
                actionTo={item.actionTo}
                onAction={item.onAction}
                className="sa-enter flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6"
                style={{ animationDelay: `${Math.min(index, 3) * 40}ms` }}
              >
                <div className="flex w-[4.75rem] shrink-0 items-center sm:justify-start">
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
                <div className="min-w-0 flex-1 basis-0">
                  <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                    {item.title}
                  </p>
                  {item.context ? (
                    <p className="mt-0.5 truncate text-[13px] leading-5 text-[#6a7282]">
                      {item.context}
                    </p>
                  ) : null}
                </div>
                <p className="min-w-0 flex-1 basis-0 text-[12px] leading-4 text-[#6a7282] sm:text-[13px] sm:leading-5">
                  {item.meta}
                </p>
              </NeedsAttentionRow>
              )
            )
          )}
        </div>
      </section>

      {onboardingNotice ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]"
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
        <div className="rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      <section
        id={TRY_DEMO_SPOTLIGHT_PORTFOLIO_ID}
        className="relative z-0 flex min-w-0 flex-col gap-3"
      >
        <h2 className="text-[20px] font-semibold leading-7 text-[#0a0a0a]">
          Portfolio Snapshot
        </h2>
        <div className="grid min-w-0 grid-cols-2 items-stretch gap-4 overflow-visible xl:grid-cols-4">
        <KpiCard
          stagger={0}
          label="Open Repairs"
          labelIcon={openRepairsIcon}
          value={loading ? '—' : String(kpis.openRepairs)}
          delta={loading ? null : kpis.openRepairsDelta}
          caption="Live maintenance repairs"
        />
        <KpiCard
          stagger={1}
          label="Scheduled Visits"
          labelIcon={scheduledVisitsIcon}
          value={loading ? '—' : String(kpis.scheduledVisits)}
          delta={loading ? null : kpis.scheduledVisitsDelta}
          caption="Upcoming maintenance visits"
        />
        <KpiCard
          stagger={2}
          label="Property Health"
          labelIcon={propertyHealthIcon}
          value={loading || propertyHealthPercent === 0 ? (loading ? '—' : '') : healthKpiValue}
          chart={
            propertyHealthPercent > 0 ? (
              <PropertyHealthDonut
                percent={propertyHealthPercent}
                label={`Property health ${healthKpiValue}`}
                centerText={healthKpiValue}
              />
            ) : undefined
          }
          valueNote={!loading && propertyHealthPercent === 0 ? <PropertyHealthUnavailableNote /> : null}
          delta={
            loading || !healthScoreReady
              ? null
              : propertyHealthKpiDelta(kpis.propertyHealthDelta)
          }
          deltaSuffix="%"
          goodWhenUp
          caption={updatedCaption}
          infoContent={
            healthFactorBreakdown?.length ? (
              <PropertyHealthScoreInfoTip lines={healthFactorBreakdown} />
            ) : null
          }
        />
        <KpiCard
          stagger={3}
          label="YTD Maintenance Cost"
          labelIcon={ytdMaintenanceCostIcon}
          value={loading ? '—' : formatSpendCompact(kpis.ytdMaintenanceCost)}
          delta={loading ? null : kpis.ytdMaintenanceCostDelta}
          deltaFormatter={formatSignedSpend}
          caption={updatedCaption}
        />
        </div>
      </section>

      <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2">
        {/* Smart Insights */}
        <section className="flex h-full min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <div className="border-b border-[#e5e7eb] px-4 py-4 sm:px-6">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Recommended Actions
            </h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Insights generated from activity across your property
            </p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            {loading ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#6a7282]">Loading…</p>
            ) : recommendedActionCards.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-[#6a7282]">
                Insights will appear as Ulo learns from your properties.
              </p>
            ) : (
              <>
                {insightActionError ? (
                  <p className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">
                    {insightActionError}
                  </p>
                ) : null}
                <div className="flex flex-col gap-3">
                  {recommendedActionCards.map((card) => (
                    <PropertyInsightRecommendationCard
                      key={card.id}
                      card={card}
                      scheduling={insightSchedulingByCard[card.id] ?? null}
                      onAction={handleInsightAction}
                      onViewDetails={setInsightDetailsCard}
                      onFindExternal={openInsightFindExternal}
                      actionBusy={insightActionBusy}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
        <div className="flex min-w-0 flex-col">
          <MyPropertiesAcrossAdmin
            fitContainer
            spotlightId={TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID}
          />
        </div>
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
          <div className="relative flex h-full max-h-dvh w-max max-w-full shrink-0">
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
              ticketId={externalVendorTicketId}
              jobContext={externalVendorJobContext}
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
        <>
          {findExternalVendorOpen ? (
            <FindExternalVendorRail
              open
              presentation={isDesktopAdmin ? 'rail' : 'sheet'}
              onClose={closeEscalatedVendorFlow}
              onBack={escalatedRailOpen ? backFromFindExternalVendor : undefined}
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
              ticketId={externalVendorTicketId}
              jobContext={externalVendorJobContext}
              suggestions={externalVendorSuggestions}
              providersUsed={externalVendorProvidersUsed}
            />
          ) : null}
          <SlaOverdueActionRail
            open={escalatedRailOpen && !(isDesktopAdmin && findExternalVendorOpen)}
            review={escalatedReview}
            loading={escalatedRailLoading}
            saving={escalatedRailSaving}
            error={escalatedRailError}
            onClose={closeEscalatedRail}
            onTakeAction={handleEscalatedTakeAction}
            onDelete={handleDeleteEscalatedAttention}
          />
        </>
      )}

      <PmServiceReviewRail
        open={pmReviewCard != null}
        card={pmReviewCard}
        onClose={() => setPmReviewCard(null)}
        onApprove={(unitIds) => {
          if (!pmReviewCard) return
          approvePmBatch(pmReviewCard, unitIds)
        }}
      />

      <AwaitingDecisionListRail
        open={awaitingDecisionListOpen}
        items={allAttentionItems}
        criticalCount={criticalAttentionCount}
        onClose={() => setAwaitingDecisionListOpen(false)}
        onItemAction={handleAwaitingDecisionItemAction}
      />

      <RecommendedActionsWorkOrdersRail
        open={insightDetailsCard != null && insightPipelineRunId == null}
        title={
          insightDetailsCard
            ? (INSIGHT_TAG_LABEL[insightDetailsCard.tag] ?? 'Recommended action')
            : 'Recommended action'
        }
        subtitle={
          insightDetailsCard ? insightCardAddressLine(insightDetailsCard.building) || null : null
        }
        {...(insightDetailsCard
          ? insightDetailSections({
              title: INSIGHT_TAG_LABEL[insightDetailsCard.tag] ?? 'Recommended action',
              building: insightDetailsCard.building,
              unitLabel: insightDetailsCard.unitLabel,
              categoryLabel: insightDetailsCard.categoryLabel,
              tag: insightDetailsCard.tag,
              text: insightDetailsCard.text,
              aggregateText: insightDetailsCard.aggregateText,
              mainIssue: insightDetailsCard.mainIssue,
              ticketSummaries: insightDetailsCard.ticketSummaries,
            })
          : { mainIssue: null, recommendedAction: null })}
        items={insightDetailsItems}
        onClose={closeInsightDetailsRail}
        onSelect={handleInsightWorkOrderSelect}
      />

      <WorkflowPipelineDetailPanel
        open={insightPipelineRunId != null}
        detail={insightPipelineDetail}
        loading={insightPipelineLoading}
        onClose={() => {
          setInsightPipelineRunId(null)
          setInsightPipelineDetail(null)
          setInsightPipelineLoading(false)
        }}
        onWorkflowUpdated={() => {
          void fetchAdminWorkflowDashboard().then((next) => {
            setWorkflowData(next)
            if (insightPipelineRunId) {
              void fetchWorkflowPipelineDetail(
                insightPipelineRunId,
                collectAdminWorkflowRuns(next),
                next.runMetadata,
              ).then(setInsightPipelineDetail)
            }
          })
        }}
      />

      {invoicePaySuccess || invoiceApprovalSuccess || invoicePayReview ? (
        <InvoicePaymentRail
          open
          review={invoicePayReview}
          successDetails={invoicePaySuccess}
          approvalSuccess={invoiceApprovalSuccess}
          paymentsEnabled={landlordHasPayments(getActiveLandlordId())}
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
          <div className="relative flex h-full max-h-dvh w-max max-w-full shrink-0">
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
          <div className="relative flex h-full max-h-dvh w-max max-w-full shrink-0">
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

      <NoInspectorAvailableModal
        open={noInspectorPrompt != null}
        building={noInspectorPrompt?.building}
        targetDay={noInspectorPrompt?.targetDay}
        onClose={() => setNoInspectorPrompt(null)}
        onFindExternal={() => {
          const ticketId = noInspectorPrompt?.ticketId
          setNoInspectorPrompt(null)
          if (ticketId) openInsightFindExternal(ticketId)
        }}
      />

      <AwaitingDecisionOutcomeModal
        open={awaitingDecisionOutcome != null}
        outcome={awaitingDecisionOutcome}
        onClose={() => setAwaitingDecisionOutcome(null)}
      />

    </div>
  )
}

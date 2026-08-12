import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  HEALTH_BADGE_LABELS,
  HEALTH_BADGE_STYLES,
  HEALTH_BAR_STYLES,
} from '@/components/PropertyHealthBuildingGrid'
import { ConversationMonitoringModal } from '@/components/ConversationMonitoringModal'
import { EmergencyApprovalRail } from '@/components/EmergencyApprovalRail'
import { MessageVendorRail } from '@/components/MessageVendorRail'
import { PropertyAiInsightsModal } from '@/components/PropertyAiInsightsModal'
import { PropertyAnalyticsPanel } from '@/components/PropertyAnalyticsPanel'
import { PropertyConversationsList } from '@/components/PropertyConversationsList'
import { PropertyResidentsGrid } from '@/components/PropertyResidentsGrid'
import { PropertyUnitsTable } from '@/components/PropertyUnitsTable'
import { PropertyVendorsList } from '@/components/PropertyVendorsList'
import { PropertyWorkflowsList } from '@/components/PropertyWorkflowsList'
import { PropertyDetailsPanel } from '@/components/PropertyDetailsPanel'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchAdminWorkflowDashboard, type AdminWorkflowDashboardData } from '@/lib/adminWorkflows'
import {
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  workflowOperationsPath,
  WORKFLOW_STAGE_LABEL,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import {
  buildEmergencyApprovalReview,
  deriveVendorSmsReviewState,
  type VendorSmsReviewState,
} from '@/lib/emergencyApprovalReview'
import { fetchConversationMonitoringByMaintenanceRequest } from '@/lib/conversationMonitoring'
import { buildPropertyAiInsights } from '@/lib/propertyAiInsights'
import { fetchRecognizedMaintenanceSpend, type RecognizedMaintenanceSpend } from '@/api/maintenanceInvoice'
import { fetchPmCompliance, type PmComplianceTask } from '@/lib/pmCompliance'
import { buildVendorNegotiationBrief } from '@/lib/vendorNegotiationBrief'
import {
  buildPropertyHealthReport,
  computeGridOccupancyForBuilding,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  filterUnitsForCanonicalProperty,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  filterTicketsForBuildingScope,
  normalizeBuildingKey,
  resolveBuildingHealthRow,
  type PropertyHealthBuildingRow,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthFeedback,
  type PropertyHealthPmTask,
  type PropertyHealthResident,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import {
  formatPropertySubtitle,
  parsePropertyRouteSlug,
  propertyDetailPath,
  resolvePropertyBuildingMeta,
} from '@/lib/propertyRoutes'
import { findPropertyById, findPropertyByName, listPropertiesForLandlord, type PropertyRecord } from '@/lib/properties'
import {
  buildPropertyUnitRows,
  type PropertyUnitResident,
} from '@/lib/propertyUnitRows'
import { buildPropertyAnalytics } from '@/lib/propertyAnalytics'
import { buildPropertyResidentCards } from '@/lib/propertyResidentCards'
import { buildPropertyWorkflowRows, evaluatePropertyWorkflow } from '@/lib/propertyWorkflowRows'
import { fetchPropertyConversations, type PropertyConversationRow } from '@/lib/propertyConversations'
import {
  buildPropertyActiveVendorRows,
  type PropertyVendorRecord,
} from '@/lib/propertyVendorRows'
import { applyAdminUnitOccupancyStatus, activateUnitsFromResidentAssignments, reconcileOccupiedUnitResidents } from '@/lib/unitActivation'
import { supabase } from '@/lib/supabase'
import type { UnitOccupancyStatus } from '@/components/UnitOccupancyStatusMenu'
import { getErrorMessage } from '@/lib/errorMessage'

type PropertyTab =
  | 'overview'
  | 'details'
  | 'units'
  | 'residents'
  | 'workflows'
  | 'conversations'
  | 'vendors'
  | 'analytics'

type PropertyTicket = {
  id: string
  createdAt: string
  urgency: string
  vendorWorkStatus: string
  unit: string
  unitId: string | null
  building: string | null
  issueCategory: string | null
  description: string | null
  assignedVendorId: string | null
  email: string | null
  estimatedMinutes: number | null
  totalCost: number | null
  laborCost: number | null
  materialCost: number | null
  completedAt: string | null
}

type PropertyUnit = {
  id: string
  unitLabel: string
  building: string | null
  status: string
}

type UrgentItem = {
  id: string
  workflowRunId: string
  ticketId: string | null
  title: string
  context: string
  statusLabel: string
  critical: boolean
  category: WorkflowKanbanCategory
  issueCategory: string | null
}

const TABS: { id: PropertyTab; label: string; href?: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Property Details' },
  { id: 'units', label: 'Units' },
  { id: 'residents', label: 'Residents' },
  { id: 'workflows', label: 'Active Tasks' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'analytics', label: 'Analytics' },
]

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function invoiceTotalFromRow(raw: Record<string, unknown>): number | null {
  const total = asFiniteNumber(raw.total_cost ?? raw.invoice_total ?? raw.amount)
  if (total > 0) return total
  const labor = asFiniteNumber(raw.labor_cost)
  const material = asFiniteNumber(raw.material_cost ?? raw.materials_cost)
  const tax = asFiniteNumber(raw.tax_amount ?? raw.tax)
  if (labor === 0 && material === 0 && tax === 0) return null
  return labor + material + tax
}

function pmTaskMatchesBuilding(task: PmComplianceTask, buildingName: string): boolean {
  const buildingShort = buildingName.replace(/\s+Apartments$/i, '').trim().toLowerCase()
  return task.location.toLowerCase().includes(buildingShort)
}

function formatSpend(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: ReactNode
}) {
  return (
    <div className="sa-enter-scale flex min-w-0 flex-1 flex-col gap-3 rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] leading-5 text-[#6a7282]">{label}</p>
        <span className="text-[#9ca3af]">{icon}</span>
      </div>
      <p className="text-[28px] font-bold leading-8 tracking-[0.4px] text-[#0a0a0a] tabular-nums">
        {value}
      </p>
    </div>
  )
}

function BuildingStatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  )
}

function UsersStatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 20a5 5 0 0 0-3-4.6" strokeLinecap="round" />
    </svg>
  )
}

function WrenchStatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4">
      <path
        d="M14.7 6.3a4 4 0 0 0-5.66 5.66L4 17v3h3l5.04-5.04a4 4 0 0 0 5.66-5.66l-1.41 1.41-2.83-2.83 1.41-1.41z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DollarStatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" />
    </svg>
  )
}

function StarStatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M12 17.3l-6.18 3.7 1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.46 4.73L18.18 21z" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4 text-[#fb2c36]">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" />
    </svg>
  )
}

export function AdminPropertyDetailDashboard() {
  const { propertySlug } = useParams<{ propertySlug: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [building, setBuilding] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<PropertyTab>(() => {
    const tab = searchParams.get('tab')
    if (
      tab === 'details' ||
      tab === 'units' ||
      tab === 'residents' ||
      tab === 'workflows' ||
      tab === 'conversations' ||
      tab === 'vendors' ||
      tab === 'analytics' ||
      tab === 'overview'
    ) {
      return tab
    }
    return 'overview'
  })
  const tabListRef = useRef<HTMLDivElement>(null)
  const tabItemRefs = useRef<Map<PropertyTab, HTMLElement>>(new Map())
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0, ready: false })
  const [tickets, setTickets] = useState<PropertyTicket[]>([])
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [canonicalProperty, setCanonicalProperty] = useState<PropertyRecord | null>(null)
  const [canonicalProperties, setCanonicalProperties] = useState<PropertyRecord[]>([])
  const [autoApprovalCap, setAutoApprovalCap] = useState(1000)
  const [workflowData, setWorkflowData] = useState<AdminWorkflowDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null)
  const [reviewVendorSmsState, setReviewVendorSmsState] = useState<VendorSmsReviewState | null>(
    null,
  )
  const [messageVendorTicketId, setMessageVendorTicketId] = useState<string | null>(null)
  const [dismissedWorkflowIds, setDismissedWorkflowIds] = useState<Set<string>>(() => new Set())
  const [approvalSaving, setApprovalSaving] = useState(false)
  const [messageSending, setMessageSending] = useState(false)
  const [pmComplianceTasks, setPmComplianceTasks] = useState<PmComplianceTask[]>([])
  const [aiInsightsOpen, setAiInsightsOpen] = useState(false)
  const [monitoringConversationId, setMonitoringConversationId] = useState<string | null>(null)
  const [residents, setResidents] = useState<PropertyUnitResident[]>([])
  const [propertyConversations, setPropertyConversations] = useState<PropertyConversationRow[]>([])
  const [vendors, setVendors] = useState<PropertyVendorRecord[]>([])
  const [recognizedSpend, setRecognizedSpend] = useState<RecognizedMaintenanceSpend[]>([])
  const [unitStatusError, setUnitStatusError] = useState<string | null>(null)

  const loadProperty = useCallback(async () => {
    const slug = parsePropertyRouteSlug(propertySlug)
    if (!slug) {
      setLoading(false)
      setError('Property not found.')
      return
    }
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured.')
      return
    }

    setLoading(true)
    setError(null)

    const landlordId = getActiveLandlordId()
    let buildingName: string
    let propertyRecord: PropertyRecord | null = null

    if (slug.kind === 'id') {
      const byId = await findPropertyById(landlordId, slug.value)
      if (!byId.ok) {
        setLoading(false)
        setError(byId.error)
        return
      }
      if (!byId.property) {
        setLoading(false)
        setError('Property not found.')
        return
      }
      propertyRecord = byId.property
      buildingName = byId.property.name
    } else {
      const byName = await findPropertyByName(landlordId, slug.value)
      if (!byName.ok) {
        setLoading(false)
        setError(byName.error)
        return
      }
      if (byName.property) {
        const tab = searchParams.get('tab')
        const tabParam =
          tab === 'details' ||
          tab === 'units' ||
          tab === 'residents' ||
          tab === 'workflows' ||
          tab === 'conversations' ||
          tab === 'vendors' ||
          tab === 'analytics'
            ? tab
            : undefined
        navigate(propertyDetailPath(byName.property.id, tabParam), { replace: true })
        return
      }
      buildingName = slug.value
    }

    setBuilding(buildingName)
    setCanonicalProperty(propertyRecord)

    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      setLoading(false)
      setError('This property is taking too long to load. Try refreshing.')
    }, 20000)

    try {
      // Fire-and-forget unit heal — never block first paint of the property page.
      void activateUnitsFromResidentAssignments({
        landlordId,
        source: 'property_sync',
      }).catch((err) => {
        console.warn('[admin property detail] unit activation sync failed', err)
      })
      void reconcileOccupiedUnitResidents({ landlordId }).catch((err) => {
        console.warn('[admin property detail] occupancy rematch failed', err)
      })

      const [enrichedTickets, mrTickets, unitsResult, healthSignals, onboardingResult, workflowDashboard, pmCompliance, residentsResult, vendorsResult, recognizedSpendResult, canonicalPropertiesResult] =
        await Promise.all([
          supabase
            .from('maintenance_request_enriched')
            .select(
              'id, created_at, unit, unit_id, building, email, issue_category, description, assigned_vendor_id, vendor_work_status, urgency, severity, priority, estimated_minutes',
            )
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(500),
          supabase
            .from('maintenance_requests')
            .select(
              'id, created_at, unit, email, issue_category, description, assigned_vendor_id, vendor_work_status, urgency, severity, priority, estimated_minutes, completed_at, recognized_spend_amount',
            )
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(500),
          supabase
            .from('units')
            .select('id, unit_label, building, status, property_id')
            .eq('landlord_id', landlordId)
            .limit(1000),
          fetchPropertyHealthSignals(),
          supabase
            .from('landlord_onboarding')
            .select('auto_approval_threshold')
            .eq('landlord_id', landlordId)
            .maybeSingle(),
          fetchAdminWorkflowDashboard().catch(() => null),
          fetchPmCompliance().catch(() => ({ tasks: [] as PmComplianceTask[] })),
          supabase
            .from('users')
            .select('id, full_name, email, unit, building, status, balance_due, lease_end_date')
            .eq('landlord_id', landlordId)
            .neq('status', 'past_resident')
            .limit(2000),
          supabase
            .from('vendors')
            .select('id, name, category, phone')
            .eq('landlord_id', landlordId)
            .order('name'),
          fetchRecognizedMaintenanceSpend(),
          listPropertiesForLandlord(landlordId),
        ])

      if (timedOut) return
      const spendById = new Map<string, Record<string, unknown>>()
      if (!mrTickets.error) {
        for (const row of (mrTickets.data ?? []) as Record<string, unknown>[]) {
          const id = asString(row.id)
          if (id) spendById.set(id, row)
        }
      }

      const ticketSource =
        enrichedTickets.error == null
          ? ((enrichedTickets.data ?? []) as Record<string, unknown>[])
          : !mrTickets.error
            ? ((mrTickets.data ?? []) as Record<string, unknown>[])
            : []

      const parsedTickets = ticketSource.map((raw) => {
        const spend = spendById.get(asString(raw.id))
        const merged: Record<string, unknown> = spend ? { ...raw, ...spend } : { ...raw }
        if (
          merged.recognized_spend_amount != null &&
          merged.total_cost == null &&
          merged.invoice_total == null
        ) {
          merged.total_cost = merged.recognized_spend_amount
        }
        return {
          id: asString(merged.id),
          createdAt: asString(merged.created_at),
          urgency: (
            asString(merged.urgency) ||
            asString(merged.severity) ||
            asString(merged.priority)
          ).toLowerCase(),
          vendorWorkStatus: asString(merged.vendor_work_status).toLowerCase(),
          unit: asString(merged.unit),
          unitId: asString(merged.unit_id) || null,
          building: asString(merged.building) || null,
          issueCategory: asString(merged.issue_category) || null,
          description: asString(merged.description) || null,
          assignedVendorId: asString(merged.assigned_vendor_id) || null,
          email: asString(merged.email) || null,
          estimatedMinutes:
            typeof merged.estimated_minutes === 'number' && Number.isFinite(merged.estimated_minutes)
              ? merged.estimated_minutes
              : null,
          totalCost: invoiceTotalFromRow(merged),
          laborCost: asFiniteNumber(merged.labor_cost) || null,
          materialCost: asFiniteNumber(merged.material_cost ?? merged.materials_cost) || null,
          completedAt:
            asString(merged.completed_at) ||
            asString(merged.resolved_at) ||
            asString(merged.closed_at) ||
            null,
        }
      })

      const parsedUnits = !unitsResult.error
        ? ((unitsResult.data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: asString(r.id),
            unitLabel: asString(r.unit_label),
            building: asString(r.building) || null,
            status: asString(r.status).toLowerCase(),
          }))
        : []

      const unitBuildingById = new Map(
        parsedUnits.map((unit) => [unit.id, unit.building] as const),
      )

      const ticketsWithBuilding = parsedTickets.map((ticket) => {
        if (ticket.building?.trim() || !ticket.unitId) return ticket
        const fromUnit = unitBuildingById.get(ticket.unitId)
        return fromUnit ? { ...ticket, building: fromUnit } : ticket
      })

      const parsedResidents = !residentsResult.error
        ? ((residentsResult.data ?? []) as Record<string, unknown>[])
            .map((raw) => ({
              id: asString(raw.id),
              fullName: asString(raw.full_name) || 'Unnamed resident',
              unit: asString(raw.unit),
              building: asString(raw.building) || null,
              email: asString(raw.email) || null,
              status: asString(raw.status).toLowerCase() || 'active',
              balanceDue: asFiniteNumber(raw.balance_due),
              leaseEndDate: asString(raw.lease_end_date) || null,
            }))
            .filter((row) => row.id)
        : []

      setTickets(ticketsWithBuilding)
      setUnits(parsedUnits)
      setPmTasks(healthSignals.pmTasks)
      setFeedback(healthSignals.feedback)
      setVendorMetrics(healthSignals.vendorMetrics)

      if (canonicalPropertiesResult.ok) {
        setCanonicalProperties(canonicalPropertiesResult.properties)
      } else {
        setCanonicalProperties([])
      }

      const threshold = onboardingResult.data?.auto_approval_threshold
      if (typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0) {
        setAutoApprovalCap(threshold)
      } else {
        setAutoApprovalCap(1000)
      }

      if (workflowDashboard) {
        setWorkflowData(workflowDashboard)
      } else {
        setWorkflowData(null)
      }

      setPmComplianceTasks(pmCompliance.tasks ?? [])
      setResidents(parsedResidents)

      if (!vendorsResult.error) {
        setVendors(
          ((vendorsResult.data ?? []) as Record<string, unknown>[])
            .map((raw) => ({
              id: asString(raw.id),
              name: asString(raw.name) || 'Vendor',
              category: asString(raw.category) || null,
              phone: asString(raw.phone) || null,
            }))
            .filter((row) => row.id),
        )
      } else {
        setVendors([])
      }

      setRecognizedSpend(recognizedSpendResult ?? [])
      setError(null)

      // Conversations are secondary — don't block the property overview on them.
      void fetchPropertyConversations(
        buildingName,
        ticketsWithBuilding.map((ticket) => ({
          id: ticket.id,
          unit: ticket.unit,
          building: ticket.building,
          email: ticket.email,
        })),
        parsedResidents.map((resident) => ({
          email: resident.email ?? null,
          building: resident.building,
        })),
      )
        .then((rows) => {
          if (!timedOut) setPropertyConversations(rows)
        })
        .catch(() => {
          if (!timedOut) setPropertyConversations([])
        })
    } catch (err) {
      if (timedOut) return
      console.error('[admin property detail] load failed', err)
      setError(getErrorMessage(err, 'Could not load property.'))
    } finally {
      window.clearTimeout(timeoutId)
      if (!timedOut) setLoading(false)
    }
  }, [propertySlug, navigate, searchParams])

  const handleOccupancyStatusChange = useCallback(
    async (unitId: string, status: UnitOccupancyStatus): Promise<boolean> => {
      setUnitStatusError(null)
      const result = await applyAdminUnitOccupancyStatus({
        unitId,
        status,
        landlordId: getActiveLandlordId(),
      })
      if (!result.ok) {
        setUnitStatusError(result.error)
        return false
      }
      setUnits((prev) =>
        prev.map((unit) => {
          if (unit.id !== unitId) return unit
          if (status === 'occupied') return { ...unit, status: 'active' }
          if (status === 'vacant') return { ...unit, status: 'vacant' }
          if (status === 'under_maintenance') return { ...unit, status: 'under_maintenance' }
          return unit
        }),
      )
      await loadProperty()
      return true
    },
    [loadProperty],
  )

  useEffect(() => {
    void loadProperty()
  }, [loadProperty])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (
      tab === 'details' ||
      tab === 'units' ||
      tab === 'residents' ||
      tab === 'workflows' ||
      tab === 'conversations' ||
      tab === 'vendors' ||
      tab === 'analytics' ||
      tab === 'overview'
    ) {
      setActiveTab(tab)
    }
  }, [searchParams])

  useLayoutEffect(() => {
    function measureIndicator() {
      const list = tabListRef.current
      const item = tabItemRefs.current.get(activeTab)
      if (!list || !item) return
      setTabIndicator({
        left: item.offsetLeft,
        width: item.offsetWidth,
        ready: true,
      })
    }
    measureIndicator()
    window.addEventListener('resize', measureIndicator)
    return () => window.removeEventListener('resize', measureIndicator)
  }, [activeTab, building])

  function selectPropertyTab(tab: PropertyTab) {
    if (tab === activeTab) return
    setActiveTab(tab)
  }

  function setTabItemRef(tab: PropertyTab, node: HTMLElement | null) {
    if (node) tabItemRefs.current.set(tab, node)
    else tabItemRefs.current.delete(tab)
  }

  const canonicalPropertiesForHealth = useMemo(
    (): PropertyHealthCanonicalProperty[] =>
      canonicalProperties.map((property) => ({ id: property.id, name: property.name })),
    [canonicalProperties],
  )

  const activeCanonicalProperty = useMemo((): PropertyHealthCanonicalProperty | null => {
    if (canonicalProperty) {
      return { id: canonicalProperty.id, name: canonicalProperty.name }
    }
    if (!building) return null
    return canonicalPropertiesForHealth.find(
      (property) => normalizeBuildingKey(property.name) === normalizeBuildingKey(building),
    ) ?? null
  }, [canonicalProperty, building, canonicalPropertiesForHealth])

  const buildingUnits = useMemo(() => {
    if (!building) return []
    const healthUnits = mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[])
    if (activeCanonicalProperty) {
      return filterUnitsForCanonicalProperty(healthUnits, activeCanonicalProperty).map((unit) => ({
        id: unit.id,
        unitLabel: unit.unitLabel,
        building: unit.building,
        status: unit.status,
      }))
    }
    return units.filter(
      (unit) => normalizeBuildingKey(unit.building) === normalizeBuildingKey(building),
    )
  }, [units, building, activeCanonicalProperty])

  const buildingTickets = useMemo(() => {
    if (!building) return []
    const healthUnits = mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[])
    const scopedResidents = residents.map((resident) => ({
      id: resident.id,
      fullName: resident.fullName,
      unit: resident.unit,
      building: resident.building,
      status: resident.status,
      email: resident.email ?? null,
    }))
    const scopedIds = new Set(
      filterTicketsForBuildingScope(
        tickets.map((ticket) => ({
          id: ticket.id,
          createdAt: ticket.createdAt,
          unit: ticket.unit,
          unitId: ticket.unitId,
          building: ticket.building,
          issueCategory: ticket.issueCategory,
          vendorWorkStatus: ticket.vendorWorkStatus,
          assignedVendorId: ticket.assignedVendorId,
          email: ticket.email,
        })),
        building,
        healthUnits,
        scopedResidents,
      ).map((ticket) => ticket.id),
    )

    if (workflowData) {
      for (const row of collectAdminWorkflowRuns(workflowData)) {
        if (normalizeBuildingKey(row.propertyLabel) !== normalizeBuildingKey(building)) continue
        if (row.entityType === 'maintenance_request' && row.entityId) {
          scopedIds.add(row.entityId)
        }
      }
    }

    return tickets.filter((ticket) => scopedIds.has(ticket.id))
  }, [tickets, units, building, residents, workflowData])

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
      residents: residents.map((resident) => ({
        id: resident.id,
        fullName: resident.fullName,
        unit: resident.unit,
        building: resident.building,
        status: resident.status,
        email: resident.email ?? null,
      })),
      canonicalProperties: canonicalPropertiesForHealth,
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, residents, canonicalPropertiesForHealth])

  const buildingHealth: PropertyHealthBuildingRow | null = useMemo(() => {
    const lookupName = activeCanonicalProperty?.name ?? building
    if (!lookupName) return null
    return resolveBuildingHealthRow(healthReport, lookupName)
  }, [healthReport, building, activeCanonicalProperty])

  const meta = useMemo(() => {
    if (!building) return { addressLine: null, yearBuilt: null }
    const record =
      canonicalProperty ??
      canonicalProperties.find(
        (property) => normalizeBuildingKey(property.name) === normalizeBuildingKey(building),
      ) ??
      null
    return resolvePropertyBuildingMeta(building, [], record, false)
  }, [building, canonicalProperty, canonicalProperties])

  const occupiedCount = useMemo(() => {
    if (!building) return 0
    const lookupName = activeCanonicalProperty?.name ?? building
    const healthUnits = mapUnitsForPropertyHealth(units as unknown as Record<string, unknown>[])
    const healthResidents: PropertyHealthResident[] = residents.map((resident) => ({
      id: resident.id,
      fullName: resident.fullName,
      unit: resident.unit,
      building: resident.building,
      status: resident.status,
    }))
    return computeGridOccupancyForBuilding(
      healthUnits,
      healthResidents,
      lookupName,
      activeCanonicalProperty,
    ).occupied
  }, [building, units, residents, activeCanonicalProperty])

  const urgentItems: UrgentItem[] = useMemo(() => {
    if (!workflowData || !building) return []

    return collectAdminWorkflowRuns(workflowData)
      .filter((row) => normalizeBuildingKey(row.propertyLabel) === normalizeBuildingKey(building))
      .filter((row) => row.status !== 'cancelled')
      .map((row) => {
        const ticket =
          row.entityType === 'maintenance_request' && row.entityId
            ? buildingTickets.find((item) => item.id === row.entityId) ?? null
            : null
        const evaluated = evaluatePropertyWorkflow({
          row,
          workflowData,
          issueCategory: ticket?.issueCategory ?? null,
          urgency: ticket?.urgency ?? null,
        })
        return { row, ...evaluated }
      })
      .filter(({ card }) => isOpenWorkflowKanbanCard(card))
      .filter(({ showInUrgentReview }) => showInUrgentReview)
      .filter(({ row }) => !dismissedWorkflowIds.has(row.id))
      .sort((a, b) => {
        if (a.priority.isUrgent !== b.priority.isUrgent) return a.priority.isUrgent ? -1 : 1
        if (a.card.critical !== b.card.critical) return a.card.critical ? -1 : 1
        return new Date(b.row.startedAt).getTime() - new Date(a.row.startedAt).getTime()
      })
      .slice(0, 8)
      .map(({ row, card, title, priority }) => ({
        id: row.id,
        workflowRunId: row.id,
        ticketId:
          row.entityType === 'maintenance_request' && row.entityId ? row.entityId : null,
        title,
        context: card.context,
        statusLabel: WORKFLOW_STAGE_LABEL[card.stage],
        critical: card.critical,
        category: card.category,
        issueCategory:
          row.entityType === 'maintenance_request' && row.entityId
            ? (buildingTickets.find((item) => item.id === row.entityId)?.issueCategory ?? null)
            : null,
        isUrgent: priority.isUrgent,
      }))
  }, [workflowData, building, dismissedWorkflowIds, buildingTickets])

  const buildingPmTasks = useMemo(
    () => (building ? pmComplianceTasks.filter((task) => pmTaskMatchesBuilding(task, building)) : []),
    [pmComplianceTasks, building],
  )

  const leaseRenewalCount = useMemo(() => {
    if (!workflowData || !building) return 0
    return collectAdminWorkflowRuns(workflowData)
      .filter((row) => normalizeBuildingKey(row.propertyLabel) === normalizeBuildingKey(building))
      .filter((row) => row.templateId === 'lease_renewal')
      .filter((row) => row.status !== 'cancelled' && row.status !== 'completed').length
  }, [workflowData, building])

  const propertyAiInsights = useMemo(() => {
    if (!building || !buildingHealth || buildingHealth.status === 'pending_setup') return null
    return buildPropertyAiInsights({
      building,
      buildingHealth,
      openTickets: buildingTickets.filter(
        (ticket) => !['completed', 'cancelled'].includes(ticket.vendorWorkStatus),
      ),
      trackedUnits: buildingUnits.filter((unit) => unit.status !== 'inactive'),
      pmTasks: buildingPmTasks,
      leaseRenewalCount,
      urgentItems,
      residents: residents.filter(
        (resident) => normalizeBuildingKey(resident.building) === normalizeBuildingKey(building),
      ),
    })
  }, [
    building,
    buildingHealth,
    buildingTickets,
    buildingUnits,
    buildingPmTasks,
    leaseRenewalCount,
    urgentItems,
    residents,
  ])

  const propertyUnitRows = useMemo(() => {
    if (!building) return []
    return buildPropertyUnitRows({
      building,
      units: buildingUnits,
      residents: residents.filter(
        (resident) => normalizeBuildingKey(resident.building) === normalizeBuildingKey(building),
      ),
      tickets: buildingTickets,
      workflowData,
    })
  }, [building, buildingUnits, residents, buildingTickets, workflowData])

  const propertyResidentCards = useMemo(() => {
    if (!building) return []
    return buildPropertyResidentCards(building, residents)
  }, [building, residents])

  const propertyWorkflowRows = useMemo(() => {
    if (!building) return []
    return buildPropertyWorkflowRows({
      building,
      workflowData,
      tickets: buildingTickets.map((ticket) => ({
        id: ticket.id,
        issueCategory: ticket.issueCategory,
        urgency: ticket.urgency,
      })),
    })
  }, [building, workflowData, buildingTickets])

  const propertyActiveVendorRows = useMemo(
    () =>
      buildPropertyActiveVendorRows({
        tickets: buildingTickets,
        vendors,
      }),
    [buildingTickets, vendors],
  )

  const propertyAnalytics = useMemo(() => {
    if (!building) return null
    return buildPropertyAnalytics({
      building,
      buildingTicketIds: new Set(buildingTickets.map((ticket) => ticket.id)),
      tickets: buildingTickets.map((ticket) => ({
        id: ticket.id,
        createdAt: ticket.createdAt,
        completedAt: ticket.completedAt,
        urgency: ticket.urgency,
        vendorWorkStatus: ticket.vendorWorkStatus,
        estimatedMinutes: ticket.estimatedMinutes,
        unit: ticket.unit,
        unitId: ticket.unitId,
        building: ticket.building,
        totalCost: ticket.totalCost,
      })),
      recognizedSpend,
      pmTasks: buildingPmTasks,
    })
  }, [building, buildingTickets, recognizedSpend, buildingPmTasks])

  useEffect(() => {
    if (!reviewTicketId) {
      setReviewVendorSmsState(null)
      return
    }

    let cancelled = false
    const ticketId = reviewTicketId
    setReviewVendorSmsState(null)

    async function refreshVendorSmsState() {
      try {
        const detail = await fetchConversationMonitoringByMaintenanceRequest(ticketId)
        if (cancelled) return
        setReviewVendorSmsState(deriveVendorSmsReviewState(detail))
      } catch {
        if (cancelled) return
        setReviewVendorSmsState((prev) => prev ?? 'no_thread')
      }
    }

    void refreshVendorSmsState()

    const pollId = window.setInterval(() => {
      if (!cancelled) void refreshVendorSmsState()
    }, 3000)

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void refreshVendorSmsState()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const landlordId = getActiveLandlordId()
    const channel =
      supabase != null
        ? supabase
            .channel(`property-urgent-review-sms-${ticketId}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'sms_messages',
                filter: `landlord_id=eq.${landlordId}`,
              },
              () => {
                void refreshVendorSmsState()
              },
            )
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'sms_conversations',
                filter: `maintenance_request_id=eq.${ticketId}`,
              },
              () => {
                void refreshVendorSmsState()
              },
            )
            .subscribe()
        : null

    return () => {
      cancelled = true
      window.clearInterval(pollId)
      document.removeEventListener('visibilitychange', onVisibility)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [reviewTicketId])

  const activeReview = useMemo(() => {
    if (!reviewTicketId) return null
    const ticket = buildingTickets.find((t) => t.id === reviewTicketId)
    if (!ticket) return null
    const vendorName = ticket.assignedVendorId
      ? (vendors.find((vendor) => vendor.id === ticket.assignedVendorId)?.name ?? null)
      : null
    return buildEmergencyApprovalReview(ticket, building, autoApprovalCap, {
      vendorName,
      vendorSmsState: reviewVendorSmsState,
    })
  }, [
    reviewTicketId,
    buildingTickets,
    building,
    autoApprovalCap,
    vendors,
    reviewVendorSmsState,
  ])

  const activeVendorBrief = useMemo(() => {
    if (!messageVendorTicketId) return null
    const ticket = buildingTickets.find((t) => t.id === messageVendorTicketId)
    if (!ticket) return null
    return buildVendorNegotiationBrief(ticket, building)
  }, [messageVendorTicketId, buildingTickets, building])

  function openReview(ticketId: string) {
    setMessageVendorTicketId(null)
    setReviewVendorSmsState(null)
    setReviewTicketId(ticketId)
  }

  function closeReview() {
    setReviewTicketId(null)
    setReviewVendorSmsState(null)
  }

  function openMessageVendor(ticketId: string) {
    setReviewTicketId(null)
    setMessageVendorTicketId(ticketId)
  }

  function closeMessageVendor() {
    setMessageVendorTicketId(null)
  }

  async function handleApprove(ticketId: string) {
    setApprovalSaving(true)
    const workflowId = urgentItems.find((item) => item.ticketId === ticketId)?.workflowRunId
    if (workflowId) {
      setDismissedWorkflowIds((prev) => new Set(prev).add(workflowId))
    }
    setApprovalSaving(false)
    closeReview()
  }

  async function handleDecline(ticketId: string) {
    setApprovalSaving(true)
    const workflowId = urgentItems.find((item) => item.ticketId === ticketId)?.workflowRunId
    if (workflowId) {
      setDismissedWorkflowIds((prev) => new Set(prev).add(workflowId))
    }
    setApprovalSaving(false)
    closeReview()
  }

  async function handleSendVendorMessage(_ticketId: string, _message: string) {
    setMessageSending(true)
    setMessageSending(false)
    closeMessageVendor()
  }

  if (!building) {
    if (loading) {
      return (
        <main className="flex min-h-0 flex-1 items-center justify-center px-8 py-12">
          <p className="text-[14px] text-[#6a7282]">Loading property…</p>
        </main>
      )
    }
    return (
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">Property not found.</p>
        <Link to="/admin/properties" className="sa-link mt-3 text-[14px] font-medium text-[#186179]">
          ← All properties
        </Link>
      </main>
    )
  }

  const subtitle = formatPropertySubtitle(meta, buildingUnits.length)
  const healthScore =
    buildingHealth?.status === 'pending_setup' ? '—' : String(buildingHealth?.score ?? '—')
  const healthValue =
    buildingHealth?.status === 'pending_setup'
      ? 'Pending'
      : `${healthScore}${healthScore === '—' ? '' : ' / 100'}`

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-12">
      <div className="py-6">
        <Link
          to="/admin/properties"
          className="sa-link inline-flex items-center gap-1 text-[13px] font-medium text-[#6a7282] hover:text-[#101828]"
        >
          <span aria-hidden>←</span> All properties
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              {building} Overview
            </h1>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              {subtitle}
            </p>
          </div>
          {buildingHealth ? (
            <span
              className={`rounded-[4px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${HEALTH_BADGE_STYLES[buildingHealth.status]}`}
            >
              {HEALTH_BADGE_LABELS[buildingHealth.status]}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Units" value={loading ? '—' : String(buildingUnits.length)} icon={<BuildingStatIcon />} />
        <StatTile label="Occupied" value={loading ? '—' : String(occupiedCount)} icon={<UsersStatIcon />} />
        <StatTile
          label="Open work orders"
          value={loading ? '—' : String(buildingHealth?.openTickets ?? 0)}
          icon={<WrenchStatIcon />}
        />
        <StatTile
          label="MTD maintenance"
          value={loading ? '—' : formatSpend(propertyAnalytics?.mtdTotal ?? 0)}
          icon={<DollarStatIcon />}
        />
        <StatTile label="Health" value={loading ? '—' : healthValue} icon={<StarStatIcon />} />
      </div>

      <nav
        className="mt-6 shrink-0 -mx-8 overflow-x-auto overscroll-x-contain px-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0"
        aria-label="Property sections"
      >
        <div
          ref={tabListRef}
          className="property-tab-list relative inline-flex w-max max-w-none flex-nowrap gap-1 rounded-full bg-[#f3f4f6] p-1"
        >
          <span
            aria-hidden
            className={[
              'property-tab-indicator pointer-events-none absolute top-1 bottom-1 rounded-full bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.06)] border border-[#e5e7eb]',
              tabIndicator.ready ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            style={{
              left: tabIndicator.left,
              width: tabIndicator.width,
            }}
          />
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            const className = [
              'property-tab-trigger relative z-[1] shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium leading-5 outline-none transition-colors duration-200',
              'focus-visible:shadow-[0_0_0_2px_#ffffff,0_0_0_4px_#187960]',
              isActive
                ? 'text-[#0a0a0a]'
                : 'text-[#6a7282] hover:text-[#101828] active:text-[#0a0a0a]',
            ].join(' ')

            if (tab.href && tab.id !== 'overview') {
              return (
                <Link
                  key={tab.id}
                  ref={(node) => setTabItemRef(tab.id, node)}
                  to={tab.href}
                  className={className}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {tab.label}
                </Link>
              )
            }

            return (
              <button
                key={tab.id}
                ref={(node) => setTabItemRef(tab.id, node)}
                type="button"
                onClick={() => selectPropertyTab(tab.id)}
                className={className}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      <div key={activeTab} className="property-tab-panel min-w-0">
      {activeTab === 'overview' ? (
        <div className="mt-6 flex flex-col gap-4">
          <section
            role={propertyAiInsights ? 'button' : undefined}
            tabIndex={propertyAiInsights ? 0 : undefined}
            onClick={() => propertyAiInsights && setAiInsightsOpen(true)}
            onKeyDown={(event) => {
              if (!propertyAiInsights) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setAiInsightsOpen(true)
              }
            }}
            className={[
              'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]',
              propertyAiInsights
                ? 'sa-card cursor-pointer hover:border-[#d1d5dc] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2'
                : '',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">Building health</h2>
              {propertyAiInsights ? (
                <span className="text-[12px] font-medium text-[#9E439F]">View AI insights</span>
              ) : null}
            </div>
            <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[44px] font-bold leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums">
                  {loading || !buildingHealth || buildingHealth.status === 'pending_setup'
                    ? '—'
                    : buildingHealth.score}
                  {buildingHealth && buildingHealth.status !== 'pending_setup' ? (
                    <span className="text-[16px] font-normal text-[#6a7282]"> / 100</span>
                  ) : null}
                </p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#f3f4f6]">
                  {buildingHealth && buildingHealth.status !== 'pending_setup' ? (
                    <div
                      className={`sa-bar h-full rounded-full ${HEALTH_BAR_STYLES[buildingHealth.status]}`}
                      style={{ width: `${buildingHealth.score}%` }}
                    />
                  ) : (
                    <div className="h-full w-0 rounded-full bg-[#d1d5dc]" />
                  )}
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-6 text-center sm:gap-10">
                <div>
                  <p className="text-[12px] leading-4 text-[#6a7282]">Occupancy</p>
                  <p className="mt-1 text-[18px] font-semibold tabular-nums text-[#0a0a0a]">
                    {loading ? '—' : `${buildingHealth?.occupancyPct ?? 0}%`}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] leading-4 text-[#6a7282]">Satisfaction</p>
                  <p className="mt-1 text-[18px] font-semibold tabular-nums text-[#0a0a0a]">
                    {loading || buildingHealth?.residentRating == null
                      ? '—'
                      : `${buildingHealth.residentRating.toFixed(1)}/5.0`}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="flex items-start gap-2">
              <AlertIcon />
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">Urgent items</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                  Open maintenance and overdue inspections Ulo could not fully resolve automatically.
                </p>
              </div>
            </div>

            {loading ? (
              <p className="mt-4 text-[13px] text-[#6a7282]">Loading…</p>
            ) : urgentItems.length === 0 ? (
              <p className="mt-4 text-[13px] text-[#6a7282]">No urgent items for this property.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {urgentItems.map((item, index) => (
                  <li
                    key={item.id}
                    style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
                    className="sa-enter sa-surface flex flex-col gap-3 rounded-[10px] border border-[#f3f4f6] bg-[#fafafa] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                        {item.title}
                      </p>
                      <p className="text-[12px] leading-4 text-[#6a7282]">
                        {item.context} · {item.statusLabel}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => item.ticketId && openReview(item.ticketId)}
                        disabled={!item.ticketId}
                        className="sa-pill inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:pointer-events-none disabled:opacity-40"
                      >
                        <EyeIcon />
                        Review
                      </button>
                      <button
                        type="button"
                        onClick={() => item.ticketId && openMessageVendor(item.ticketId)}
                        disabled={!item.ticketId}
                        className="sa-pill inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:pointer-events-none disabled:opacity-40"
                      >
                        <MessageIcon />
                        Message Vendor
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(workflowOperationsPath(item.workflowRunId))}
                        className="sa-pill inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb]"
                      >
                        <LinkIcon />
                        View Workflow
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : activeTab === 'details' ? (
        <PropertyDetailsPanel
          building={building ?? ''}
          loading={loading}
          initialYearBuilt={meta.yearBuilt}
        />
      ) : activeTab === 'units' ? (
        <>
          {unitStatusError ? (
            <p className="mt-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
              {unitStatusError}
            </p>
          ) : null}
          <PropertyUnitsTable
            building={building ?? ''}
            propertyId={canonicalProperty?.id}
            rows={propertyUnitRows}
            loading={loading}
            onOccupancyStatusChange={(unitId, status) => handleOccupancyStatusChange(unitId, status)}
          />
        </>
      ) : activeTab === 'residents' ? (
        <PropertyResidentsGrid
          building={building ?? ''}
          propertyId={canonicalProperty?.id}
          residents={propertyResidentCards}
          loading={loading}
        />
      ) : activeTab === 'workflows' ? (
        <PropertyWorkflowsList rows={propertyWorkflowRows} loading={loading} />
      ) : activeTab === 'conversations' ? (
        <PropertyConversationsList
          rows={propertyConversations}
          loading={loading}
          selectedConversationId={monitoringConversationId}
          onSelectConversation={setMonitoringConversationId}
        />
      ) : activeTab === 'vendors' ? (
        <PropertyVendorsList
          rows={propertyActiveVendorRows}
          loading={loading}
          onMessageVendor={openMessageVendor}
        />
      ) : activeTab === 'analytics' ? (
        <PropertyAnalyticsPanel
          building={building ?? ''}
          analytics={propertyAnalytics}
          loading={loading}
        />
      ) : (
        <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white p-8 text-center shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] text-[#6a7282]">
            {TABS.find((t) => t.id === activeTab)?.label} view is available from the navigation tabs
            above.
          </p>
        </div>
      )}
      </div>
      <EmergencyApprovalRail
        open={reviewTicketId != null}
        review={activeReview}
        onClose={closeReview}
        onApprove={(ticketId) => void handleApprove(ticketId)}
        onDecline={(ticketId) => void handleDecline(ticketId)}
        saving={approvalSaving}
      />
      <MessageVendorRail
        open={messageVendorTicketId != null}
        brief={activeVendorBrief}
        onClose={closeMessageVendor}
        onSend={(ticketId, message) => void handleSendVendorMessage(ticketId, message)}
        sending={messageSending}
      />
      <PropertyAiInsightsModal
        open={aiInsightsOpen}
        insights={propertyAiInsights}
        onClose={() => setAiInsightsOpen(false)}
      />
      <ConversationMonitoringModal
        open={monitoringConversationId != null}
        conversationId={monitoringConversationId}
        onClose={() => setMonitoringConversationId(null)}
      />
    </main>
  )
}

export default AdminPropertyDetailDashboard

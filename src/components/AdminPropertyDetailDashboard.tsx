import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchAdminWorkflowDashboard, type AdminWorkflowDashboardData } from '@/lib/adminWorkflows'
import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  isOpenWorkflowKanbanCard,
  workflowOperationsPath,
  WORKFLOW_STAGE_LABEL,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import { buildEmergencyApprovalReview } from '@/lib/emergencyApprovalReview'
import { buildPropertyAiInsights } from '@/lib/propertyAiInsights'
import { fetchRecognizedMaintenanceSpend, type RecognizedMaintenanceSpend } from '@/api/maintenanceInvoice'
import { fetchPmCompliance, type PmComplianceTask } from '@/lib/pmCompliance'
import { buildVendorNegotiationBrief } from '@/lib/vendorNegotiationBrief'
import {
  buildPropertyHealthReport,
  computeOccupancyStats,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  filterTicketsForBuildingScope,
  normalizeBuildingKey,
  type PropertyHealthBuildingRow,
  type PropertyHealthFeedback,
  type PropertyHealthPmTask,
  type PropertyHealthVendorMetrics,
} from '@/lib/propertyHealth'
import {
  formatPropertySubtitle,
  parseBuildingSlug,
  resolvePropertyBuildingMeta,
} from '@/lib/propertyRoutes'
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
import { supabase } from '@/lib/supabase'

type PropertyTab =
  | 'overview'
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
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
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
  const { buildingSlug } = useParams<{ buildingSlug: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const building = parseBuildingSlug(buildingSlug)

  const [activeTab, setActiveTab] = useState<PropertyTab>(() => {
    const tab = searchParams.get('tab')
    if (
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
  const [tickets, setTickets] = useState<PropertyTicket[]>([])
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [pmTasks, setPmTasks] = useState<PropertyHealthPmTask[]>([])
  const [feedback, setFeedback] = useState<PropertyHealthFeedback[]>([])
  const [vendorMetrics, setVendorMetrics] = useState<PropertyHealthVendorMetrics[]>([])
  const [onboardingProperties, setOnboardingProperties] = useState<
    Array<Record<string, unknown>>
  >([])
  const [autoApprovalCap, setAutoApprovalCap] = useState(1000)
  const [workflowData, setWorkflowData] = useState<AdminWorkflowDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null)
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

  const loadProperty = useCallback(async () => {
    if (!building) {
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
    const enrichedTickets = await supabase
      .from('maintenance_request_enriched')
      .select(
        'id, created_at, unit, unit_id, building, email, issue_category, description, assigned_vendor_id, vendor_work_status, severity, priority, estimated_minutes, total_cost, invoice_total, amount, labor_cost, material_cost, materials_cost, tax_amount, tax, completed_at, resolved_at, closed_at',
      )
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(500)

    const ticketsResult =
      enrichedTickets.error == null
        ? enrichedTickets
        : await supabase
            .from('maintenance_requests')
            .select('*')
            .eq('landlord_id', landlordId)
            .order('created_at', { ascending: false })
            .limit(500)

    const [unitsResult, healthSignals, onboardingResult, workflowDashboard, pmCompliance, residentsResult, vendorsResult, recognizedSpendResult] =
      await Promise.all([
        supabase
          .from('units')
          .select('id, unit_label, building, status')
          .eq('landlord_id', landlordId)
          .limit(1000),
        fetchPropertyHealthSignals(),
        supabase
          .from('landlord_onboarding')
          .select('properties, auto_approval_threshold')
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
      ])

    const parsedTickets = !ticketsResult.error
      ? ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((raw) => ({
          id: asString(raw.id),
          createdAt: asString(raw.created_at),
          urgency: (
            asString(raw.urgency) ||
            asString(raw.severity) ||
            asString(raw.priority)
          ).toLowerCase(),
          vendorWorkStatus: asString(raw.vendor_work_status).toLowerCase(),
          unit: asString(raw.unit),
          unitId: asString(raw.unit_id) || null,
          building: asString(raw.building) || null,
          issueCategory: asString(raw.issue_category) || null,
          description: asString(raw.description) || null,
          assignedVendorId: asString(raw.assigned_vendor_id) || null,
          email: asString(raw.email) || null,
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
        }))
      : []

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

    if (!ticketsResult.error) {
      setTickets(ticketsWithBuilding)
    }

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

    const conversationRows = await fetchPropertyConversations(
      building,
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
    ).catch(() => [] as PropertyConversationRow[])
    setPropertyConversations(conversationRows)

    setUnits(parsedUnits)

    setPmTasks(healthSignals.pmTasks)
    setFeedback(healthSignals.feedback)
    setVendorMetrics(healthSignals.vendorMetrics)

    const propsRaw = onboardingResult.data?.properties
    setOnboardingProperties(Array.isArray(propsRaw) ? (propsRaw as Record<string, unknown>[]) : [])

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

    if (!residentsResult.error) {
      setResidents(parsedResidents)
    } else {
      setResidents([])
    }

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

    setLoading(false)
  }, [building])

  useEffect(() => {
    void loadProperty()
  }, [loadProperty])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (
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

  const buildingUnits = useMemo(
    () => units.filter((u) => normalizeBuildingKey(u.building) === normalizeBuildingKey(building)),
    [units, building],
  )

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
    })
  }, [units, tickets, pmTasks, feedback, vendorMetrics, residents])

  const buildingHealth: PropertyHealthBuildingRow | null = useMemo(
    () =>
      healthReport.buildings.find(
        (row) => normalizeBuildingKey(row.building) === normalizeBuildingKey(building),
      ) ?? null,
    [healthReport.buildings, building],
  )

  const meta = useMemo(() => {
    if (!building) return { addressLine: null, yearBuilt: null }
    return resolvePropertyBuildingMeta(
      building,
      onboardingProperties.map((p) => ({
        name: asString(p.name),
        streetAddress: asString(p.streetAddress ?? p.street_address),
        city: asString(p.city),
        state: asString(p.state),
        zipCode: asString(p.zipCode ?? p.zip_code),
        yearBuilt: (p.yearBuilt ?? p.year_built) as number | string | null | undefined,
      })),
    )
  }, [building, onboardingProperties])

  const occupiedCount = useMemo(() => {
    if (!building) return 0
    const healthUnits = buildingUnits.map((unit) => ({
      id: unit.id,
      unitLabel: unit.unitLabel,
      building: unit.building,
      status: unit.status,
    }))
    return computeOccupancyStats(
      healthUnits,
      residents.map((resident) => ({
        id: resident.id,
        fullName: resident.fullName,
        unit: resident.unit,
        building: resident.building,
        status: resident.status,
      })),
      building,
    ).occupied
  }, [building, buildingUnits, residents])

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

  const activeReview = useMemo(() => {
    if (!reviewTicketId) return null
    const ticket = buildingTickets.find((t) => t.id === reviewTicketId)
    if (!ticket) return null
    return buildEmergencyApprovalReview(ticket, building, autoApprovalCap)
  }, [reviewTicketId, buildingTickets, building, autoApprovalCap])

  const activeVendorBrief = useMemo(() => {
    if (!messageVendorTicketId) return null
    const ticket = buildingTickets.find((t) => t.id === messageVendorTicketId)
    if (!ticket) return null
    return buildVendorNegotiationBrief(ticket, building)
  }, [messageVendorTicketId, buildingTickets, building])

  function openReview(ticketId: string) {
    setMessageVendorTicketId(null)
    setReviewTicketId(ticketId)
  }

  function closeReview() {
    setReviewTicketId(null)
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
    return (
      <main className="flex min-h-0 flex-1 flex-col px-8 pb-12 pt-6">
        <p className="text-[14px] text-[#6a7282]">Property not found.</p>
        <Link to="/admin/properties" className="mt-3 text-[14px] font-medium text-[#186179]">
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
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#6a7282] transition-colors hover:text-[#101828]"
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        className="mt-6 -mx-8 overflow-x-auto overscroll-x-contain px-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0"
        aria-label="Property sections"
      >
        <div className="inline-flex w-max max-w-none flex-nowrap gap-1 rounded-full bg-[#f3f4f6] p-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const className = [
            'shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium leading-5 transition-colors',
            isActive
              ? 'bg-white text-[#0a0a0a] shadow-[0px_1px_2px_rgba(0,0,0,0.06)] border border-[#e5e7eb]'
              : 'text-[#6a7282] hover:text-[#101828]',
          ].join(' ')

          if (tab.href && tab.id !== 'overview') {
            return (
              <Link key={tab.id} to={tab.href} className={className}>
                {tab.label}
              </Link>
            )
          }

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={className}
            >
              {tab.label}
            </button>
          )
        })}
        </div>
      </nav>

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
              'rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]',
              propertyAiInsights
                ? 'cursor-pointer transition-colors hover:border-[#d1d5dc] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2'
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
                      className={`h-full rounded-full ${HEALTH_BAR_STYLES[buildingHealth.status]}`}
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
                {urgentItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 rounded-[10px] border border-[#f3f4f6] bg-[#fafafa] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
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
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:pointer-events-none disabled:opacity-40"
                      >
                        <EyeIcon />
                        Review
                      </button>
                      <button
                        type="button"
                        onClick={() => item.ticketId && openMessageVendor(item.ticketId)}
                        disabled={!item.ticketId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:pointer-events-none disabled:opacity-40"
                      >
                        <MessageIcon />
                        Message Vendor
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(workflowOperationsPath(item.workflowRunId))}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb]"
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
      ) : activeTab === 'units' ? (
        <PropertyUnitsTable building={building ?? ''} rows={propertyUnitRows} loading={loading} />
      ) : activeTab === 'residents' ? (
        <PropertyResidentsGrid
          building={building}
          residents={propertyResidentCards}
          loading={loading}
        />
      ) : activeTab === 'workflows' ? (
        <PropertyWorkflowsList rows={propertyWorkflowRows} loading={loading} />
      ) : activeTab === 'conversations' ? (
        <PropertyConversationsList
          rows={propertyConversations}
          loading={loading}
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

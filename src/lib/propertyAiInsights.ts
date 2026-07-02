import type { PmComplianceTask } from '@/lib/pmCompliance'
import { formatPmDueLabel } from '@/lib/pmCompliance'
import type { WorkflowKanbanCategory } from '@/lib/adminWorkflowKanban'
import {
  countOccupiedUnits,
  normalizeUnitLabel,
  type PropertyHealthBuildingRow,
  type PropertyHealthComponent,
  type PropertyHealthComponentKey,
  type PropertyHealthResident,
  type PropertyHealthUnit,
} from '@/lib/propertyHealth'

export type PropertyAiRecommendationAction =
  | { type: 'workflows'; href: string }
  | { type: 'workflow_run'; workflowRunId: string }

export type PropertyAiRecommendation = {
  id: string
  title: string
  impactPoints: number
  etaLabel: string
  action: PropertyAiRecommendationAction
}

export type PropertyAiInsights = {
  building: string
  currentScore: number
  projectedScore: number
  totalGain: number
  recommendations: PropertyAiRecommendation[]
}

type OpenTicket = {
  id: string
  unit: string
  issueCategory: string | null
  vendorWorkStatus: string
}

type TrackedUnit = {
  unitLabel: string
  status: string
}

export type UrgentWorkflowItem = {
  id: string
  workflowRunId: string
  title: string
  context: string
  critical: boolean
  category: WorkflowKanbanCategory
  ticketId: string | null
  issueCategory: string | null
}

export type BuildPropertyAiInsightsInput = {
  building: string
  buildingHealth: PropertyHealthBuildingRow
  openTickets: OpenTicket[]
  trackedUnits: TrackedUnit[]
  pmTasks: PmComplianceTask[]
  residents?: PropertyHealthResident[]
  leaseRenewalCount?: number
  urgentItems?: UrgentWorkflowItem[]
}

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled'])

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function aggregateWeightedScore(components: PropertyHealthComponent[]): number {
  let sum = 0
  for (const component of components) {
    sum += component.score * component.weight
  }
  return clampScore(sum)
}

function isTicketOpen(ticket: OpenTicket): boolean {
  return !CLOSED_WORK_STATUSES.has(ticket.vendorWorkStatus.toLowerCase())
}

function scoreOpenMaintenanceFromTickets(
  trackedUnits: TrackedUnit[],
  openTickets: OpenTicket[],
): number {
  if (trackedUnits.length === 0) return 50

  const unitLabels = new Set(
    trackedUnits.map((unit) => normalizeUnitLabel(unit.unitLabel)).filter(Boolean),
  )
  const unitsWithOpen = new Set<string>()
  for (const ticket of openTickets.filter(isTicketOpen)) {
    const key = normalizeUnitLabel(ticket.unit)
    if (key && unitLabels.has(key)) unitsWithOpen.add(key)
  }

  return clampScore(100 * (1 - unitsWithOpen.size / trackedUnits.length))
}

function scorePmComplianceFromTasks(tasks: PmComplianceTask[]): number {
  if (tasks.length === 0) return 50
  const completed = tasks.filter((task) => task.status === 'completed').length
  return clampScore((completed / tasks.length) * 100)
}

function scoreVacancyFromOccupancy(occupied: number, total: number): number {
  if (total === 0) return 50
  return clampScore((occupied / total) * 100)
}

function toHealthUnits(trackedUnits: TrackedUnit[], building: string): PropertyHealthUnit[] {
  return trackedUnits.map((unit, index) => ({
    id: `${normalizeUnitLabel(unit.unitLabel)}-${index}`,
    unitLabel: unit.unitLabel,
    building,
    status: unit.status,
  }))
}

function updateComponentScore(
  components: PropertyHealthComponent[],
  key: PropertyHealthComponentKey,
  score: number,
): PropertyHealthComponent[] {
  return components.map((component) =>
    component.key === key ? { ...component, score, isFallback: false } : component,
  )
}

function categoryLabel(category: string): string {
  const normalized = category.trim().toLowerCase()
  if (!normalized) return 'maintenance'
  if (normalized.includes('plumb')) return 'plumbing'
  if (normalized.includes('hvac') || normalized.includes('heat') || normalized.includes('cool'))
    return 'HVAC'
  if (normalized.includes('elect')) return 'electrical'
  return normalized
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

function maintenanceEtaLabel(ticketCount: number): string {
  if (ticketCount <= 1) return '1 day'
  if (ticketCount <= 3) return '2 days'
  return `${Math.min(14, ticketCount + 1)} days`
}

function pmEtaLabel(task: PmComplianceTask): string {
  const due = formatPmDueLabel(task.dueAt, task.status)
  if (due.tone === 'danger') {
    const days = Number.parseInt(due.label, 10)
    return Number.isFinite(days) ? `${days} days` : 'This week'
  }
  if (due.label === 'Due today') return 'Today'
  if (due.label.startsWith('Due in')) {
    const days = Number.parseInt(due.label.replace(/\D/g, ''), 10)
    if (Number.isFinite(days) && days <= 7) return 'This week'
    if (Number.isFinite(days)) return `${days} days`
  }
  return 'This week'
}

function pmRecommendationTitle(task: PmComplianceTask): string {
  if (/hvac/i.test(task.title)) return 'Complete HVAC inspection'
  if (task.kind === 'inspection') return `Complete ${task.title.toLowerCase()}`
  return `Complete ${task.title.toLowerCase()}`
}

function leaseEtaLabel(count: number): string {
  if (count <= 1) return '3 days'
  if (count <= 3) return '5 days'
  return '1 week'
}

function urgentEtaLabel(item: UrgentWorkflowItem): string {
  if (item.critical) return 'Today'
  if (item.category === 'maintenance') return '2 days'
  if (item.category === 'lease' || item.category === 'payment') return '5 days'
  return 'This week'
}

function urgentRecommendationTitle(item: UrgentWorkflowItem): string {
  const location = item.context.split(' · ')[0]?.trim()
  const category = item.issueCategory?.trim().toLowerCase() ?? ''

  if (category.includes('plumb')) {
    return location ? `Resolve plumbing issue — ${location}` : 'Resolve plumbing issue'
  }
  if (category.includes('hvac') || category.includes('heat')) {
    return location ? `Resolve HVAC issue — ${location}` : 'Resolve HVAC issue'
  }
  if (item.critical) {
    return location ? `Review urgent item — ${location}` : `Review urgent: ${item.title}`
  }
  return location ? `${item.title} — ${location}` : item.title
}

function bumpComponentScore(
  components: PropertyHealthComponent[],
  key: PropertyHealthComponentKey,
  delta: number,
): PropertyHealthComponent[] {
  const component = components.find((row) => row.key === key)
  if (!component) return components
  return updateComponentScore(components, key, clampScore(component.score + delta))
}

function componentKeyForUrgentCategory(
  category: WorkflowKanbanCategory,
): PropertyHealthComponentKey {
  switch (category) {
    case 'maintenance':
      return 'openMaintenance'
    case 'inspection':
      return 'pmCompliance'
    case 'lease':
    case 'move_in':
    case 'move_out':
      return 'vacancy'
    case 'payment':
      return 'residentSatisfaction'
    default:
      return 'openMaintenance'
  }
}

function buildUrgentCandidate(
  item: UrgentWorkflowItem,
  trackedUnits: TrackedUnit[],
  openTickets: OpenTicket[],
  pmTasks: PmComplianceTask[],
  building: string,
  residents: PropertyHealthResident[],
): Candidate {
  const resolvedTicketIds = item.ticketId ? new Set([item.ticketId]) : null

  return {
    id: `urgent-${item.id}`,
    title: urgentRecommendationTitle(item),
    etaLabel: urgentEtaLabel(item),
    action: { type: 'workflow_run', workflowRunId: item.workflowRunId },
    apply: (components) => {
      if (resolvedTicketIds) {
        const remainingOpen = openTickets.filter(
          (ticket) => isTicketOpen(ticket) && !resolvedTicketIds.has(ticket.id),
        )
        const nextScore = scoreOpenMaintenanceFromTickets(trackedUnits, remainingOpen)
        return updateComponentScore(components, 'openMaintenance', nextScore)
      }

      const key = componentKeyForUrgentCategory(item.category)
      if (key === 'pmCompliance' && pmTasks.length > 0) {
        const incomplete = pmTasks.find((task) => task.status !== 'completed')
        if (incomplete) {
          return buildPmCandidate(incomplete, pmTasks).apply(components)
        }
      }

      if (key === 'vacancy') {
        const vacancyCandidate = buildVacancyCandidate(1, 0, trackedUnits, building, residents)
        if (vacancyCandidate) return vacancyCandidate.apply(components)
      }

      const delta = item.critical ? 12 : 8
      return bumpComponentScore(components, key, delta)
    },
  }
}

type Candidate = {
  id: string
  title: string
  etaLabel: string
  action: PropertyAiRecommendationAction
  apply: (components: PropertyHealthComponent[]) => PropertyHealthComponent[]
}

function groupOpenTicketsByCategory(tickets: OpenTicket[]): Map<string, OpenTicket[]> {
  const groups = new Map<string, OpenTicket[]>()
  for (const ticket of tickets.filter(isTicketOpen)) {
    const label = categoryLabel(ticket.issueCategory ?? 'maintenance')
    const existing = groups.get(label) ?? []
    existing.push(ticket)
    groups.set(label, existing)
  }
  return groups
}

function buildMaintenanceCandidate(
  category: string,
  tickets: OpenTicket[],
  trackedUnits: TrackedUnit[],
  allOpenTickets: OpenTicket[],
): Candidate | null {
  if (tickets.length === 0) return null

  const resolveIds = new Set(tickets.map((ticket) => ticket.id))
  const label = category.toLowerCase() === 'plumbing' ? 'plumbing' : category

  return {
    id: `maintenance-${label}`,
    title: `Resolve ${tickets.length} ${label} ${pluralize(tickets.length, 'ticket')}`,
    etaLabel: maintenanceEtaLabel(tickets.length),
    action: { type: 'workflows', href: '/admin/workflows' },
    apply: (components) => {
      const remainingOpen = allOpenTickets.filter(
        (ticket) => isTicketOpen(ticket) && !resolveIds.has(ticket.id),
      )
      const nextScore = scoreOpenMaintenanceFromTickets(trackedUnits, remainingOpen)
      return updateComponentScore(components, 'openMaintenance', nextScore)
    },
  }
}

function buildPmCandidate(task: PmComplianceTask, buildingTasks: PmComplianceTask[]): Candidate {
  return {
    id: `pm-${task.id}`,
    title: pmRecommendationTitle(task),
    etaLabel: pmEtaLabel(task),
    action: task.workflowRunId
      ? { type: 'workflow_run', workflowRunId: task.workflowRunId }
      : { type: 'workflows', href: '/admin/workflows' },
    apply: (components) => {
      const completedTasks = buildingTasks.map((row) =>
        row.id === task.id ? { ...row, status: 'completed' as const } : row,
      )
      const nextScore = scorePmComplianceFromTasks(completedTasks)
      return updateComponentScore(components, 'pmCompliance', nextScore)
    },
  }
}

function buildVacancyCandidate(
  vacantCount: number,
  leaseCount: number,
  trackedUnits: TrackedUnit[],
  building: string,
  residents: PropertyHealthResident[],
): Candidate | null {
  const count = leaseCount > 0 ? leaseCount : vacantCount
  if (count <= 0) return null

  const healthUnits = toHealthUnits(trackedUnits, building)
  const total = healthUnits.length

  return {
    id: leaseCount > 0 ? 'lease-renewals' : 'fill-vacancies',
    title:
      leaseCount > 0
        ? `Renew ${count} ${pluralize(count, 'lease')} expiring this month`
        : `Lease ${count} vacant ${pluralize(count, 'unit')}`,
    etaLabel: leaseEtaLabel(count),
    action: { type: 'workflows', href: '/admin/workflows' },
    apply: (components) => {
      const currentOccupied = countOccupiedUnits(healthUnits, residents, building)
      const nextScore = scoreVacancyFromOccupancy(
        Math.min(total, currentOccupied + count),
        total,
      )
      return updateComponentScore(components, 'vacancy', nextScore)
    },
  }
}

/** Derive actionable health recommendations for a single building. */
export function buildPropertyAiInsights(
  input: BuildPropertyAiInsightsInput,
): PropertyAiInsights | null {
  const {
    building,
    buildingHealth,
    openTickets,
    trackedUnits,
    pmTasks,
    residents = [],
    leaseRenewalCount = 0,
    urgentItems = [],
  } = input

  if (buildingHealth.status === 'pending_setup') return null

  const currentScore = buildingHealth.score
  const openByCategory = groupOpenTicketsByCategory(openTickets)
  const sortedCategories = [...openByCategory.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )

  const ticketsLinkedToUrgent = new Set(
    urgentItems.map((item) => item.ticketId).filter((id): id is string => id != null),
  )

  const incompletePm = pmTasks
    .filter((task) => task.status !== 'completed')
    .sort((a, b) => {
      const aPriority = /hvac/i.test(a.title) || a.kind === 'inspection' ? 0 : 1
      const bPriority = /hvac/i.test(b.title) || b.kind === 'inspection' ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    })

  const healthUnits = toHealthUnits(trackedUnits, building)
  const occupiedCount = countOccupiedUnits(healthUnits, residents, building)
  const vacantCount = Math.max(0, healthUnits.length - occupiedCount)

  const candidates: Candidate[] = []

  for (const item of urgentItems) {
    candidates.push(buildUrgentCandidate(item, trackedUnits, openTickets, pmTasks, building, residents))
  }

  for (const [category, tickets] of sortedCategories) {
    const uncovered = tickets.filter((ticket) => !ticketsLinkedToUrgent.has(ticket.id))
    const candidate = buildMaintenanceCandidate(category, uncovered, trackedUnits, openTickets)
    if (candidate) candidates.push(candidate)
  }

  for (const task of incompletePm.slice(0, 2)) {
    candidates.push(buildPmCandidate(task, pmTasks))
  }

  const vacancyCandidate = buildVacancyCandidate(
    vacantCount,
    leaseRenewalCount,
    trackedUnits,
    building,
    residents,
  )
  if (vacancyCandidate) candidates.push(vacancyCandidate)

  if (candidates.length === 0) return null

  const ranked = candidates
    .map((candidate) => {
      const nextComponents = candidate.apply(buildingHealth.components)
      const nextScore = aggregateWeightedScore(nextComponents)
      const current = aggregateWeightedScore(buildingHealth.components)
      return { candidate, impact: nextScore - current }
    })
    .filter((row) => row.impact > 0)
    .sort((a, b) => {
      const aUrgent = a.candidate.id.startsWith('urgent-') ? 0 : 1
      const bUrgent = b.candidate.id.startsWith('urgent-') ? 0 : 1
      if (aUrgent !== bUrgent) return aUrgent - bUrgent
      return b.impact - a.impact
    })

  if (ranked.length === 0) return null

  let runningComponents = buildingHealth.components
  const recommendations: PropertyAiRecommendation[] = []

  for (const row of ranked.slice(0, 3)) {
    const before = aggregateWeightedScore(runningComponents)
    runningComponents = row.candidate.apply(runningComponents)
    const after = aggregateWeightedScore(runningComponents)
    const impactPoints = Math.max(1, after - before)

    recommendations.push({
      id: row.candidate.id,
      title: row.candidate.title,
      impactPoints,
      etaLabel: row.candidate.etaLabel,
      action: row.candidate.action,
    })
  }

  const projectedScore = aggregateWeightedScore(runningComponents)
  const totalGain = Math.max(0, projectedScore - currentScore)

  if (totalGain === 0) return null

  return {
    building,
    currentScore,
    projectedScore,
    totalGain,
    recommendations,
  }
}

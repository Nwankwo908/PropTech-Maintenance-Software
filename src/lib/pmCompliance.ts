/**
 * PM compliance — single source of truth: preventive_maintenance_tasks (+ dashboard view).
 *
 * Pipeline: Property Asset → Preventive Task → Workflow → Assigned → Completed → Compliance
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type PmTaskKind = 'appliance' | 'inspection' | 'service'
export type PmTaskStatus = 'scheduled' | 'assigned' | 'completed' | 'cancelled'
export type PmDueTone = 'danger' | 'warning' | 'neutral'

/** Appliance-category PM tasks use the appliance-repair icon in Analytics. */
export function pmTaskKindUsesApplianceIcon(kind: PmTaskKind): boolean {
  return kind === 'appliance'
}

/** Inspection-category PM tasks use the inspection-review icon in Analytics. */
export function pmTaskKindUsesInspectionIcon(kind: PmTaskKind): boolean {
  return kind === 'inspection'
}

/** Service-category PM tasks use the pm-service icon in Analytics. */
export function pmTaskKindUsesServiceIcon(kind: PmTaskKind): boolean {
  return kind === 'service'
}

export type PmComplianceTask = {
  id: string
  title: string
  kind: PmTaskKind
  location: string
  dueAt: string
  status: PmTaskStatus
  completedAt: string | null
  workflowRunId: string | null
  unitAssetId: string | null
  estimatedAgeYears: number | null
  usefulLifeYears: number | null
  failureRiskPct: number | null
  failurePredictionWindow: string | null
  replacementRecommended: boolean
  estimatedReplacementCost: number | null
}

export type PmComplianceSummary = {
  tasks: PmComplianceTask[]
  totalTasks: number
  completedTasks: number
  overdueTasks: number
  compliancePct: number | null
  complianceLabel: 'Good' | 'Fair' | 'Needs attention' | null
  attentionCount: number
  replacementRecommendedCount: number
}

type DashboardRow = {
  task_id: string
  title: string
  task_kind: PmTaskKind
  due_at: string
  task_status: PmTaskStatus
  completed_at: string | null
  workflow_run_id: string | null
  unit_asset_id: string | null
  building: string | null
  unit_label: string | null
  estimated_age_years: number | null
  useful_life_years: number | null
  failure_risk_pct: number | null
  failure_prediction_window: string | null
  replacement_recommended: boolean | null
  estimated_replacement_cost: number | null
}

function formatLocation(row: DashboardRow): string {
  const building = row.building?.replace(/\s+Apartments$/i, '').trim()
  const unit = row.unit_label?.trim()
  if (building && unit) return `${building} ${unit}`
  if (building) return building
  return unit || 'Portfolio'
}

function mapDashboardRow(row: DashboardRow): PmComplianceTask {
  return {
    id: row.task_id,
    title: row.title,
    kind: row.task_kind,
    location: formatLocation(row),
    dueAt: row.due_at,
    status: row.task_status,
    completedAt: row.completed_at,
    workflowRunId: row.workflow_run_id,
    unitAssetId: row.unit_asset_id,
    estimatedAgeYears:
      row.estimated_age_years != null ? Number(row.estimated_age_years) : null,
    usefulLifeYears:
      row.useful_life_years != null ? Number(row.useful_life_years) : null,
    failureRiskPct: row.failure_risk_pct != null ? Number(row.failure_risk_pct) : null,
    failurePredictionWindow: row.failure_prediction_window,
    replacementRecommended: row.replacement_recommended === true,
    estimatedReplacementCost:
      row.estimated_replacement_cost != null
        ? Number(row.estimated_replacement_cost)
        : null,
  }
}

export function formatPmDueLabel(
  dueAt: string | null,
  status?: PmTaskStatus,
): { label: string; tone: PmDueTone } {
  if (status === 'completed') return { label: 'Completed', tone: 'neutral' }
  if (!dueAt) return { label: 'Schedule pending', tone: 'warning' }
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return { label: 'Schedule pending', tone: 'warning' }
  const days = Math.round((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) {
    const overdue = Math.abs(days)
    return {
      label: `${overdue} day${overdue === 1 ? '' : 's'} overdue`,
      tone: 'danger',
    }
  }
  if (days === 0) return { label: 'Due today', tone: 'warning' }
  return {
    label: `Due in ${days} day${days === 1 ? '' : 's'}`,
    tone: days <= 7 ? 'warning' : 'neutral',
  }
}

export function formatPmTaskSubtitle(task: PmComplianceTask): string {
  if (task.kind === 'inspection') {
    return task.failurePredictionWindow ?? 'Scheduled inspection'
  }
  if (
    task.estimatedAgeYears != null &&
    task.usefulLifeYears != null &&
    task.failureRiskPct != null
  ) {
    const age = `${task.estimatedAgeYears} yr${task.estimatedAgeYears === 1 ? '' : 's'} old`
    const life = `${task.usefulLifeYears} yr useful life`
    const risk = `${task.failureRiskPct}% fail risk${
      task.failurePredictionWindow ? ` (${task.failurePredictionWindow})` : ''
    }`
    return `${age} · ${life} · ${risk}`
  }
  return task.failurePredictionWindow ?? 'Preventive maintenance'
}

function complianceLabel(pct: number | null): PmComplianceSummary['complianceLabel'] {
  if (pct == null) return null
  if (pct >= 85) return 'Good'
  if (pct >= 70) return 'Fair'
  return 'Needs attention'
}

function pmDueSortKey(task: PmComplianceTask): number {
  if (task.status === 'completed') return Number.MAX_SAFE_INTEGER - 1
  const due = new Date(task.dueAt).getTime()
  return Number.isNaN(due) ? Number.MAX_SAFE_INTEGER : due
}

export function sortPmComplianceTasks(tasks: PmComplianceTask[]): PmComplianceTask[] {
  return [...tasks].sort((a, b) => {
    const toneRank = { danger: 0, warning: 1, neutral: 2 }
    const aTone = formatPmDueLabel(a.dueAt, a.status).tone
    const bTone = formatPmDueLabel(b.dueAt, b.status).tone
    if (a.status === 'completed' && b.status !== 'completed') return 1
    if (b.status === 'completed' && a.status !== 'completed') return -1
    if (toneRank[aTone] !== toneRank[bTone]) return toneRank[aTone] - toneRank[bTone]
    return pmDueSortKey(a) - pmDueSortKey(b)
  })
}

function buildSummary(tasks: PmComplianceTask[]): PmComplianceSummary {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((t) => t.status === 'completed').length
  const compliancePct =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : null
  const overdueTasks = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      formatPmDueLabel(t.dueAt, t.status).tone === 'danger',
  ).length
  const attentionCount = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      (formatPmDueLabel(t.dueAt, t.status).tone === 'danger' ||
        formatPmDueLabel(t.dueAt, t.status).tone === 'warning'),
  ).length
  const replacementRecommendedCount = tasks.filter(
    (t) => t.kind === 'appliance' && t.replacementRecommended,
  ).length

  return {
    tasks: sortPmComplianceTasks(tasks),
    totalTasks,
    completedTasks,
    overdueTasks,
    compliancePct,
    complianceLabel: complianceLabel(compliancePct),
    attentionCount,
    replacementRecommendedCount,
  }
}

export async function fetchPmCompliance(): Promise<PmComplianceSummary> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) {
    return buildSummary([])
  }

  const { data, error } = await supabase
    .from('pm_compliance_dashboard_view')
    .select(
      `task_id, title, task_kind, due_at, task_status, completed_at,
       workflow_run_id, unit_asset_id, building, unit_label,
       estimated_age_years, useful_life_years, failure_risk_pct, failure_prediction_window,
       replacement_recommended, estimated_replacement_cost`,
    )
    .eq('landlord_id', getActiveLandlordId())
    .order('due_at', { ascending: true })

  if (error) {
    if (error.code === '42P01' || error.code === '42703') return buildSummary([])
    console.error('[pm-compliance] fetch', error.message)
    return buildSummary([])
  }

  const tasks = ((data ?? []) as DashboardRow[]).map(mapDashboardRow)
  return buildSummary(tasks)
}

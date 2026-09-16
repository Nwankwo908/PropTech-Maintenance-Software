/**
 * PM compliance — single source of truth: preventive_maintenance_tasks (+ dashboard view).
 *
 * Pipeline: Property Asset → Preventive Task → Workflow → Assigned → Completed → Compliance
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { recordActivityLog } from '@/lib/recordActivityLog'
import {
  buildPmTaskCardCopy,
  failureSignalsFromCondition,
  formatPmDueHeadline,
  knownAssetAgeYears,
  persistableAssetAgeYears,
  type PmDueTone as SharedPmDueTone,
} from '@shared/pm/taskCard'

export type PmTaskKind = 'appliance' | 'inspection' | 'service'
export type PmTaskStatus = 'scheduled' | 'assigned' | 'completed' | 'cancelled'
export type PmDueTone = SharedPmDueTone

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

export type PmAgeBasis = 'known' | 'estimated_from_build_year' | 'ai_estimated'

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
  /** Lower-confidence ages (build year / AI) should show an estimated indicator. */
  ageBasis: PmAgeBasis | null
  usefulLifeYears: number | null
  failureRiskPct: number | null
  failurePredictionWindow: string | null
  replacementRecommended: boolean
  estimatedReplacementCost: number | null
  conditionRating: string | null
  applianceType: string | null
  registryAssetType: string | null
}

export type PmSafetyHazardAlert = {
  unitAssetId: string
  label: string
  description: string
  building: string | null
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
  /** Distinct safety_hazard deficiencies from linked unit_assets.metadata */
  safetyHazardAlerts: PmSafetyHazardAlert[]
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
  const ageYears = knownAssetAgeYears(
    row.estimated_age_years != null ? Number(row.estimated_age_years) : null,
  )
  const storedRisk = row.failure_risk_pct != null ? Number(row.failure_risk_pct) : null
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
    estimatedAgeYears: ageYears,
    ageBasis: null,
    usefulLifeYears:
      row.useful_life_years != null ? Number(row.useful_life_years) : null,
    failureRiskPct: ageYears == null ? null : storedRisk,
    failurePredictionWindow:
      ageYears == null && row.failure_prediction_window === '2–5 years'
        ? null
        : row.failure_prediction_window,
    replacementRecommended: row.replacement_recommended === true,
    estimatedReplacementCost:
      row.estimated_replacement_cost != null
        ? Number(row.estimated_replacement_cost)
        : null,
    conditionRating: null,
    applianceType: null,
    registryAssetType: null,
  }
}

function parseAgeBasis(raw: unknown): PmAgeBasis | null {
  if (raw === 'known' || raw === 'estimated_from_build_year' || raw === 'ai_estimated') {
    return raw
  }
  if (typeof raw === 'string' && /build|year built|property/i.test(raw)) {
    return 'estimated_from_build_year'
  }
  if (typeof raw === 'string' && raw.trim()) return 'ai_estimated'
  return null
}

export function formatPmDueLabel(
  dueAt: string | null,
  status?: PmTaskStatus,
): { label: string; tone: PmDueTone } {
  const due = formatPmDueHeadline(dueAt, status)
  return { label: due.headline, tone: due.tone }
}

export function formatPmTaskSubtitle(task: PmComplianceTask): string {
  return buildPmTaskCardCopy(task).summary
}

export function pmAgeIsEstimated(task: PmComplianceTask): boolean {
  return (
    task.ageBasis === 'estimated_from_build_year' || task.ageBasis === 'ai_estimated'
  )
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

function buildSummary(
  tasks: PmComplianceTask[],
  safetyHazardAlerts: PmSafetyHazardAlert[] = [],
): PmComplianceSummary {
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
    safetyHazardAlerts,
  }
}

/** Build PM compliance summary from an already-scoped task list (e.g. one property). */
export function summarizePmComplianceTasks(tasks: PmComplianceTask[]): PmComplianceSummary {
  return buildSummary(tasks)
}

export async function fetchPmCompliance(): Promise<PmComplianceSummary> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) {
    return buildSummary([])
  }

  const landlordId = getActiveLandlordId()
  const { data, error } = await supabase
    .from('pm_compliance_dashboard_view')
    .select(
      `task_id, title, task_kind, due_at, task_status, completed_at,
       workflow_run_id, unit_asset_id, building, unit_label,
       estimated_age_years, useful_life_years, failure_risk_pct, failure_prediction_window,
       replacement_recommended, estimated_replacement_cost`,
    )
    .eq('landlord_id', landlordId)
    .order('due_at', { ascending: true })

  if (error) {
    if (error.code === '42P01' || error.code === '42703') return buildSummary([])
    console.error('[pm-compliance] fetch', error.message)
    return buildSummary([])
  }

  let tasks = ((data ?? []) as DashboardRow[]).map(mapDashboardRow)

  const assetIds = [
    ...new Set(tasks.map((t) => t.unitAssetId).filter((id): id is string => Boolean(id))),
  ]
  const safetyHazardAlerts: PmSafetyHazardAlert[] = []
  const extrasByAsset = new Map<
    string,
    {
      ageBasis: PmAgeBasis | null
      conditionRating: string | null
      applianceType: string | null
      registryAssetType: string | null
    }
  >()
  if (assetIds.length > 0) {
    const { data: assets, error: assetError } = await supabase
      .from('unit_assets')
      .select('id, appliance_label, appliance_type, building, metadata, detection_source')
      .eq('landlord_id', landlordId)
      .in('id', assetIds)

    if (!assetError && assets) {
      for (const asset of assets) {
        const meta =
          asset.metadata && typeof asset.metadata === 'object'
            ? (asset.metadata as Record<string, unknown>)
            : {}
        extrasByAsset.set(String(asset.id), {
          ageBasis: parseAgeBasis(meta.ageBasis),
          conditionRating:
            typeof meta.conditionRating === 'string' ? meta.conditionRating : null,
          applianceType: asset.appliance_type != null ? String(asset.appliance_type) : null,
          registryAssetType:
            typeof meta.registryAssetType === 'string' ? meta.registryAssetType : null,
        })
        const defs = Array.isArray(meta.deficiencies) ? meta.deficiencies : []
        for (const raw of defs) {
          if (!raw || typeof raw !== 'object') continue
          const d = raw as { severity?: string; description?: string }
          if (d.severity !== 'safety_hazard') continue
          safetyHazardAlerts.push({
            unitAssetId: String(asset.id),
            label: String(asset.appliance_label || asset.appliance_type || 'Asset'),
            description: String(d.description || 'Safety hazard noted during inspection'),
            building: asset.building != null ? String(asset.building) : null,
          })
        }
      }
    }
  }

  tasks = tasks.map((task) => {
    const extras = task.unitAssetId ? extrasByAsset.get(task.unitAssetId) : null
    return {
      ...task,
      ageBasis: extras?.ageBasis ?? null,
      conditionRating: extras?.conditionRating ?? task.conditionRating,
      applianceType: extras?.applianceType ?? task.applianceType,
      registryAssetType: extras?.registryAssetType ?? task.registryAssetType,
    }
  })

  return buildSummary(tasks, safetyHazardAlerts)
}

export async function completePmTask(taskId: string): Promise<void> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) throw new Error('Not connected.')
  const landlordId = getActiveLandlordId()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('preventive_maintenance_tasks')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', taskId)
    .eq('landlord_id', landlordId)
    .select('id, title, building, workflow_run_id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('That task could not be updated.')
  await recordActivityLog({
    landlordId,
    eventType: 'pm.task_completed',
    source: 'dashboard',
    actorType: 'landlord',
    taskId,
    workflowRunId: data.workflow_run_id != null ? String(data.workflow_run_id) : null,
    metadata: {
      message: `${data.title || 'Preventive maintenance'} marked complete.`,
      building: data.building,
    },
  })
}

export async function updatePmAssetInstallYear(input: {
  unitAssetId: string
  installYear: number
}): Promise<void> {
  const year = Math.round(input.installYear)
  if (year < 1800 || year > 2100) throw new Error('Enter a valid installation year.')
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) throw new Error('Not connected.')
  const landlordId = getActiveLandlordId()
  const { data: asset, error: loadError } = await supabase
    .from('unit_assets')
    .select('id, building, appliance_type, useful_life_years, metadata')
    .eq('id', input.unitAssetId)
    .eq('landlord_id', landlordId)
    .maybeSingle()
  if (loadError) throw new Error(loadError.message)
  if (!asset) throw new Error('That equipment record could not be updated.')

  const meta =
    asset.metadata && typeof asset.metadata === 'object'
      ? (asset.metadata as Record<string, unknown>)
      : {}
  const ageYears = persistableAssetAgeYears(year)
  const life =
    asset.useful_life_years != null && Number(asset.useful_life_years) > 0
      ? Number(asset.useful_life_years)
      : 25
  const derived = failureSignalsFromCondition({
    rating: typeof meta.conditionRating === 'string' ? meta.conditionRating : null,
    ageYears,
    lifeYears: life,
  })
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('unit_assets')
    .update({
      estimated_age_years: ageYears,
      failure_risk_pct: derived.risk,
      failure_prediction_window: derived.window,
      replacement_recommended: derived.replace,
      replacement_urgency: derived.urgency,
      metadata: {
        ...meta,
        ageBasis: 'known',
        installYear: year,
        fieldProvenance: {
          ...(typeof meta.fieldProvenance === 'object' && meta.fieldProvenance
            ? (meta.fieldProvenance as Record<string, unknown>)
            : {}),
          age: 'manual',
        },
      },
      updated_at: now,
    })
    .eq('id', input.unitAssetId)
    .eq('landlord_id', landlordId)
  if (error) throw new Error(error.message)

  await recordActivityLog({
    landlordId,
    eventType: 'pm.asset_age_updated',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      message: `Installation year added for ${asset.appliance_type || 'equipment'}.`,
      building: asset.building,
      unit_asset_id: input.unitAssetId,
      install_year: year,
    },
  })
}

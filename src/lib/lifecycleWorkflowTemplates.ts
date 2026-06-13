/**
 * Client-side parsers for lifecycle workflow_templates (move_in, move_out, inspection).
 * Mirrors supabase/functions/_shared/engine/lifecycleWorkflowTemplates.ts.
 */

export const LIFECYCLE_WORKFLOW_KEYS = ['move_in', 'move_out', 'inspection'] as const

export type LifecycleWorkflowKey = (typeof LIFECYCLE_WORKFLOW_KEYS)[number]

export type WorkflowTemplateConfigRow = {
  id: string
  name: string
  type: string
  trigger_config: Record<string, unknown>
  route_config: Record<string, unknown>
  escalation_config: Record<string, unknown>
  active: boolean
}

export type LifecycleTemplateStep = {
  key: string
  stage: string
  order: number
  label: string
}

export type LifecycleStatusStage = {
  key: string
  label: string
  order: number
  terminal: boolean
}

export type LifecycleClassification = {
  key: string
  label: string
  source: string
}

export type LifecycleEscalationRule = {
  key: string
  label: string
  action: string
  handler?: string | null
  after_days?: number | null
  before_hours?: number | null
  when_stage?: string | null
}

export type LifecycleDashboardLabels = {
  section_title: string
  section_subtitle: string
  empty_state: string
  stat_cards: Record<string, string>
  status_labels: Record<string, string>
  classification_labels: Record<string, string>
  columns: Record<string, string>
}

export type LifecycleWorkflowTemplateView = {
  workflowKey: LifecycleWorkflowKey
  id: string
  name: string
  type: string
  description: string
  active: boolean
  primaryTrigger: string | null
  triggers: string[]
  entityTypes: string[]
  pipeline: string[]
  requiredSteps: LifecycleTemplateStep[]
  statusStages: LifecycleStatusStage[]
  classifications: LifecycleClassification[]
  classificationMetadataKeys: string[]
  defaultClassification: string | null
  dashboardLabels: LifecycleDashboardLabels
  escalationRules: LifecycleEscalationRule[]
  graphEventPrefix: string | null
  handler: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function parseSteps(value: unknown): LifecycleTemplateStep[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      const row = asRecord(raw)
      const key = readString(row.key)
      const stage = readString(row.stage)
      if (!key || !stage) return null
      return {
        key,
        stage,
        order: typeof row.order === 'number' ? row.order : 0,
        label: readString(row.label) ?? key,
      }
    })
    .filter((row): row is LifecycleTemplateStep => row !== null)
    .sort((a, b) => a.order - b.order)
}

function parseStatusStages(value: unknown): LifecycleStatusStage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      const row = asRecord(raw)
      const key = readString(row.key)
      if (!key) return null
      return {
        key,
        label: readString(row.label) ?? key,
        order: typeof row.order === 'number' ? row.order : 0,
        terminal: row.terminal === true,
      }
    })
    .filter((row): row is LifecycleStatusStage => row !== null)
    .sort((a, b) => a.order - b.order)
}

function parseClassifications(value: unknown): LifecycleClassification[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      const row = asRecord(raw)
      const key = readString(row.key)
      if (!key) return null
      return {
        key,
        label: readString(row.label) ?? key,
        source: readString(row.source) ?? 'unknown',
      }
    })
    .filter((row): row is LifecycleClassification => row !== null)
}

function parseEscalationRules(value: unknown): LifecycleEscalationRule[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      const row = asRecord(raw)
      const key = readString(row.key)
      if (!key) return null
      return {
        key,
        label: readString(row.label) ?? key,
        action: readString(row.action) ?? 'notify_landlord',
        handler: readString(row.handler),
        after_days: typeof row.after_days === 'number' ? row.after_days : null,
        before_hours: typeof row.before_hours === 'number' ? row.before_hours : null,
        when_stage: readString(row.when_stage),
      }
    })
    .filter((row): row is LifecycleEscalationRule => row !== null)
}

function parseDashboardLabels(value: unknown): LifecycleDashboardLabels {
  const row = asRecord(value)
  const mapStrings = (record: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [key, val] of Object.entries(record)) {
      const label = readString(val)
      if (label) out[key] = label
    }
    return out
  }

  return {
    section_title: readString(row.section_title) ?? 'Workflows',
    section_subtitle: readString(row.section_subtitle) ?? '',
    empty_state: readString(row.empty_state) ?? 'No workflows.',
    stat_cards: mapStrings(asRecord(row.stat_cards)),
    status_labels: mapStrings(asRecord(row.status_labels)),
    classification_labels: mapStrings(asRecord(row.classification_labels)),
    columns: mapStrings(asRecord(row.columns)),
  }
}

export function isLifecycleWorkflowKey(id: string): id is LifecycleWorkflowKey {
  return (LIFECYCLE_WORKFLOW_KEYS as readonly string[]).includes(id)
}

export function parseLifecycleWorkflowTemplate(
  config: WorkflowTemplateConfigRow,
): LifecycleWorkflowTemplateView | null {
  const workflowKey =
    readString(config.route_config.workflow_key) ??
    readString(config.trigger_config.workflow_key) ??
    readString(config.escalation_config.workflow_key) ??
    config.id

  if (!isLifecycleWorkflowKey(workflowKey)) return null

  const classify = asRecord(config.route_config.classify)
  const logStep = asRecord(config.route_config.log)

  return {
    workflowKey,
    id: config.id,
    name: config.name,
    type: config.type,
    description: readString(config.trigger_config.description) ?? '',
    active: config.active,
    primaryTrigger: readString(config.trigger_config.primary_trigger),
    triggers: readStringArray(config.trigger_config.triggers),
    entityTypes: readStringArray(config.trigger_config.entity_types),
    pipeline: readStringArray(config.route_config.pipeline),
    requiredSteps: parseSteps(config.route_config.required_steps),
    statusStages: parseStatusStages(config.route_config.status_stages),
    classifications: parseClassifications(classify.classifications),
    classificationMetadataKeys: readStringArray(classify.metadata_keys),
    defaultClassification: readString(classify.default_classification),
    dashboardLabels: parseDashboardLabels(config.route_config.dashboard_labels),
    escalationRules: parseEscalationRules(config.escalation_config.rules),
    graphEventPrefix: readString(logStep.graph_event_prefix),
    handler: readString(config.route_config.handler),
  }
}

export function lifecycleStatusLabel(
  template: LifecycleWorkflowTemplateView,
  stageKey: string | null | undefined,
): string {
  if (!stageKey?.trim()) return '—'
  return template.dashboardLabels.status_labels[stageKey] ?? stageKey.replace(/_/g, ' ')
}

export function lifecycleClassificationLabel(
  template: LifecycleWorkflowTemplateView,
  classificationKey: string | null | undefined,
): string {
  if (!classificationKey?.trim()) return '—'
  return (
    template.dashboardLabels.classification_labels[classificationKey] ??
    classificationKey.replace(/_/g, ' ')
  )
}

export async function fetchLifecycleWorkflowTemplates(): Promise<
  LifecycleWorkflowTemplateView[]
> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const { data, error } = await supabase
    .from('workflow_templates')
    .select('id, name, type, trigger_config, route_config, escalation_config, active')
    .in('id', [...LIFECYCLE_WORKFLOW_KEYS])
    .eq('active', true)

  if (error) {
    console.error('[lifecycle-workflows] fetch templates', error.message)
    return []
  }

  return (data ?? [])
    .map((row) =>
      parseLifecycleWorkflowTemplate({
        id: String(row.id),
        name: String(row.name),
        type: String(row.type),
        trigger_config: (row.trigger_config as Record<string, unknown>) ?? {},
        route_config: (row.route_config as Record<string, unknown>) ?? {},
        escalation_config: (row.escalation_config as Record<string, unknown>) ?? {},
        active: Boolean(row.active),
      }),
    )
    .filter((row): row is LifecycleWorkflowTemplateView => row !== null)
}

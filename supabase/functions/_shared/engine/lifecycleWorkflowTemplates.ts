/**
 * Typed accessors for lifecycle workflow_templates (move_in, move_out, inspection).
 * Config lives in workflow_templates.trigger_config / route_config / escalation_config.
 */
import type { WorkflowTemplateConfigRow } from "./templateConfig.ts"
import type { WorkflowStage, WorkflowTriggerType } from "./types.ts"

export const LIFECYCLE_WORKFLOW_KEYS = [
  "move_in",
  "move_out",
  "inspection",
] as const

export type LifecycleWorkflowKey = (typeof LIFECYCLE_WORKFLOW_KEYS)[number]

export type LifecycleTemplateStep = {
  key: string
  stage: WorkflowStage
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
  primaryTrigger: WorkflowTriggerType | null
  triggers: WorkflowTriggerType[]
  entityTypes: string[]
  pipeline: WorkflowStage[]
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
}

function readTriggerTypes(value: unknown): WorkflowTriggerType[] {
  const allowed = new Set<WorkflowTriggerType>([
    "sms_inbound",
    "cron",
    "dashboard",
    "webhook",
    "vendor_portal",
    "automation",
  ])
  return readStringArray(value).filter((t): t is WorkflowTriggerType =>
    allowed.has(t as WorkflowTriggerType)
  )
}

function readPipeline(value: unknown): WorkflowStage[] {
  const allowed = new Set<WorkflowStage>([
    "trigger",
    "classify",
    "route",
    "act",
    "escalate",
    "log",
  ])
  return readStringArray(value).filter((s): s is WorkflowStage =>
    allowed.has(s as WorkflowStage)
  )
}

function parseSteps(value: unknown): LifecycleTemplateStep[] {
  if (!Array.isArray(value)) return []
  const stages = new Set<WorkflowStage>([
    "trigger",
    "classify",
    "route",
    "act",
    "escalate",
    "log",
  ])

  return value
    .map((raw) => {
      const row = asRecord(raw)
      const stage = readString(row.stage)
      if (!stage || !stages.has(stage as WorkflowStage)) return null
      const key = readString(row.key)
      if (!key) return null
      return {
        key,
        stage: stage as WorkflowStage,
        order: typeof row.order === "number" ? row.order : 0,
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
        order: typeof row.order === "number" ? row.order : 0,
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
        source: readString(row.source) ?? "unknown",
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
        action: readString(row.action) ?? "notify_landlord",
        handler: readString(row.handler),
        after_days: typeof row.after_days === "number" ? row.after_days : null,
        before_hours: typeof row.before_hours === "number"
          ? row.before_hours
          : null,
        when_stage: readString(row.when_stage),
      }
    })
    .filter((row): row is LifecycleEscalationRule => row !== null)
}

function parseDashboardLabels(value: unknown): LifecycleDashboardLabels {
  const row = asRecord(value)
  const statCards = asRecord(row.stat_cards)
  const statusLabels = asRecord(row.status_labels)
  const classificationLabels = asRecord(row.classification_labels)
  const columns = asRecord(row.columns)

  const mapStrings = (record: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [key, val] of Object.entries(record)) {
      const label = readString(val)
      if (label) out[key] = label
    }
    return out
  }

  return {
    section_title: readString(row.section_title) ?? "Workflows",
    section_subtitle: readString(row.section_subtitle) ?? "",
    empty_state: readString(row.empty_state) ?? "No workflows.",
    stat_cards: mapStrings(statCards),
    status_labels: mapStrings(statusLabels),
    classification_labels: mapStrings(classificationLabels),
    columns: mapStrings(columns),
  }
}

export function isLifecycleWorkflowKey(id: string): id is LifecycleWorkflowKey {
  return (LIFECYCLE_WORKFLOW_KEYS as readonly string[]).includes(id)
}

/** Parse a workflow_templates row into a typed lifecycle view. */
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
    description: readString(config.trigger_config.description) ?? "",
    active: config.active,
    primaryTrigger: readString(config.trigger_config.primary_trigger) as
      | WorkflowTriggerType
      | null,
    triggers: readTriggerTypes(config.trigger_config.triggers),
    entityTypes: readStringArray(config.trigger_config.entity_types),
    pipeline: readPipeline(config.route_config.pipeline),
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
  if (!stageKey?.trim()) return "—"
  return template.dashboardLabels.status_labels[stageKey] ??
    stageKey.replace(/_/g, " ")
}

export function lifecycleClassificationLabel(
  template: LifecycleWorkflowTemplateView,
  classificationKey: string | null | undefined,
): string {
  if (!classificationKey?.trim()) return "—"
  return template.dashboardLabels.classification_labels[classificationKey] ??
    classificationKey.replace(/_/g, " ")
}

export function lifecycleGraphEventType(
  template: LifecycleWorkflowTemplateView,
  eventSuffix: string,
): string {
  const prefix = template.graphEventPrefix ?? template.workflowKey
  return `${prefix}.${eventSuffix}`
}

/** Canonical graph event suffixes shared across lifecycle workflows. */
export const LIFECYCLE_GRAPH_EVENTS = {
  started: "started",
  classified: "classified",
  noticeSent: "notice_sent",
  checklistSent: "checklist_sent",
  taskCreated: "task_created",
  taskCompleted: "task_completed",
  completed: "completed",
  escalated: "escalated",
  cancelled: "cancelled",
  inspectionScheduled: "scheduled",
  inspectionCompleted: "completed",
  unitActivated: "unit_activated",
  unitVacated: "unit_vacated",
} as const

export function moveOutTimingFromConfig(
  config: WorkflowTemplateConfigRow | null,
): { noResponseDays: number } {
  const days = config?.escalation_config?.no_response_days
  if (typeof days === "number" && Number.isFinite(days) && days > 0) {
    return { noResponseDays: Math.floor(days) }
  }
  return { noResponseDays: 7 }
}

export function moveInTimingFromConfig(
  config: WorkflowTemplateConfigRow | null,
): { noResponseDays: number } {
  const days = config?.escalation_config?.no_response_days
  if (typeof days === "number" && Number.isFinite(days) && days > 0) {
    return { noResponseDays: Math.floor(days) }
  }
  return { noResponseDays: 5 }
}

export function inspectionTimingFromConfig(
  config: WorkflowTemplateConfigRow | null,
): { noticeHoursBefore: number; noShowDays: number } {
  const noticeHours = config?.trigger_config?.notice_hours_before ??
    config?.escalation_config?.notice_hours_before
  const noShowDays = config?.escalation_config?.no_show_days

  return {
    noticeHoursBefore: typeof noticeHours === "number" && noticeHours > 0
      ? Math.floor(noticeHours)
      : 72,
    noShowDays: typeof noShowDays === "number" && noShowDays > 0
      ? Math.floor(noShowDays)
      : 3,
  }
}

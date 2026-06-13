import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { fetchActiveWorkflowTemplate } from "./templateConfig.ts"
import { workflowRouteForTemplate } from "./logStage.ts"
import { listWorkflowTemplates, getWorkflowTemplate } from "./registry.ts"
import {
  createWorkflowRun,
  logPipelineStageEvent,
} from "./workflowRuns.ts"
import type {
  ClassifiedIntent,
  InvokeWorkflowRequest,
  InvokeWorkflowResult,
  WorkflowEntityType,
  WorkflowNextAction,
  WorkflowStage,
  WorkflowTemplateId,
  WorkflowTriggerType,
} from "./types.ts"

const ENTITY_TYPES = new Set<WorkflowEntityType>([
  "sms_conversation",
  "maintenance_request",
  "user",
  "unit",
])

const TRIGGER_TYPES = new Set<WorkflowTriggerType>([
  "sms_inbound",
  "cron",
  "dashboard",
  "webhook",
  "vendor_portal",
  "automation",
])

export class InvokeWorkflowError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "InvokeWorkflowError"
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readOptionalString(value: unknown): string | null | undefined {
  if (value === null) return null
  return readString(value)
}

/** Parse and validate the run-workflow-engine request body. */
export function parseInvokeWorkflowRequest(
  body: Record<string, unknown>,
): InvokeWorkflowRequest {
  const templateType = readString(body.template_type)
  if (!templateType) {
    throw new InvokeWorkflowError("template_type is required", 400)
  }

  const entityType = readString(body.entity_type)
  if (!entityType || !ENTITY_TYPES.has(entityType as WorkflowEntityType)) {
    throw new InvokeWorkflowError(
      "entity_type must be one of: sms_conversation, maintenance_request, user, unit",
      400,
    )
  }

  const entityId = readString(body.entity_id)
  if (!entityId) {
    throw new InvokeWorkflowError("entity_id is required", 400)
  }

  const metadata = asRecord(body.metadata)

  const landlordId =
    readString(body.landlord_id) ??
    readString(metadata.landlord_id)
  if (!landlordId) {
    throw new InvokeWorkflowError(
      "landlord_id is required (body or metadata.landlord_id)",
      400,
    )
  }

  metadata.landlord_id = landlordId

  const triggerRaw = readString(body.trigger_type) ??
    readString(metadata.trigger_type)
  const triggerType = triggerRaw && TRIGGER_TYPES.has(triggerRaw as WorkflowTriggerType)
    ? (triggerRaw as WorkflowTriggerType)
    : "automation"

  return {
    template_type: templateType,
    entity_type: entityType as WorkflowEntityType,
    entity_id: entityId,
    metadata,
    landlord_id: landlordId,
    trigger_type: triggerType,
    property_id: readOptionalString(body.property_id ?? metadata.property_id),
    resident_id: readOptionalString(body.resident_id ?? metadata.resident_id),
    unit_id: readOptionalString(body.unit_id ?? metadata.unit_id),
  }
}

/** Classify an entity-scoped workflow using the requested template and DB config. */
export function classifyEntityWorkflow(
  templateId: string,
  _routeConfig: Record<string, unknown>,
  params: {
    entityType: WorkflowEntityType
    entityId: string
    runId: string
  },
): ClassifiedIntent {
  return {
    templateId,
    confidence: "high",
    reason: "explicit_template_type",
    runId: params.runId,
  }
}

function isRegisteredTemplateId(id: string): id is WorkflowTemplateId {
  return listWorkflowTemplates().some((template) => template.id === id)
}

function registryRouteForTemplate(templateId: string): string | null {
  if (!isRegisteredTemplateId(templateId)) return null
  return workflowRouteForTemplate(templateId)
}

/** Resolve the next action from workflow_templates.route_config (+ code registry fallback). */
export function resolveWorkflowNextAction(
  templateId: string,
  routeConfig: Record<string, unknown>,
): WorkflowNextAction {
  const routeStep = asRecord(routeConfig.route)
  const actStep = asRecord(routeConfig.act)

  const handler = readString(routeStep.handler) ??
    readString(routeConfig.handler) ??
    readString(actStep.handler)
  const action = readString(routeStep.action) ??
    readString(routeConfig.action) ??
    readString(actStep.action)
  const label = readString(routeStep.label) ??
    readString(routeConfig.label) ??
    readString(actStep.label)
  const domain = readString(routeConfig.domain)

  const registryRoute = registryRouteForTemplate(templateId)
  const codeHandler = isRegisteredTemplateId(templateId)
    ? getWorkflowTemplate(templateId).id
    : null

  return {
    template_id: templateId,
    route: registryRoute ?? handler ?? codeHandler ?? "unknown",
    action,
    handler: handler ?? codeHandler,
    label,
    domain,
  }
}

async function logInvokeStage(
  supabase: SupabaseClient,
  params: {
    runId: string
    stage: WorkflowStage
    step?: string | null
    message?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: params.stage,
    step: params.step,
    actorType: "system",
    message: params.message,
    metadata: params.metadata,
  })
}

/**
 * Programmatic workflow entry point: load template → create run → classify → route → log.
 * Extend by adding templates to workflow_templates + registry; no new engine required.
 */
export async function invokeWorkflowEngine(
  supabase: SupabaseClient,
  request: InvokeWorkflowRequest,
): Promise<InvokeWorkflowResult> {
  const stages: WorkflowStage[] = []

  const template = await fetchActiveWorkflowTemplate(supabase, request.template_type)
  if (!template) {
    throw new InvokeWorkflowError(
      `Active workflow template not found: ${request.template_type}`,
      404,
    )
  }

  stages.push("trigger")

  const run = await createWorkflowRun(supabase, {
    templateId: template.id,
    landlordId: request.landlord_id!,
    triggerType: request.trigger_type ?? "automation",
    currentStep: "initiated",
    entityType: request.entity_type,
    entityId: request.entity_id,
    propertyId: request.property_id ?? null,
    residentId: request.resident_id ?? null,
    unitId: request.unit_id ?? null,
    metadata: {
      ...request.metadata,
      invoke_source: "run-workflow-engine",
    },
  })

  if (!run) {
    throw new InvokeWorkflowError("Failed to create workflow_run", 500)
  }

  stages.push("classify")

  const classified = classifyEntityWorkflow(template.id, template.route_config, {
    entityType: request.entity_type,
    entityId: request.entity_id,
    runId: run.id,
  })

  await logInvokeStage(supabase, {
    runId: run.id,
    stage: "classify",
    step: "initiated",
    message: classified.reason,
    metadata: {
      template_id: template.id,
      entity_type: request.entity_type,
      entity_id: request.entity_id,
      classified_template: classified.templateId,
      classified_confidence: classified.confidence,
      classify_config: template.route_config.classify ?? null,
    },
  })

  stages.push("route")

  const nextAction = resolveWorkflowNextAction(template.id, template.route_config)

  await logInvokeStage(supabase, {
    runId: run.id,
    stage: "route",
    step: nextAction.action,
    message: nextAction.label,
    metadata: {
      next_action: nextAction,
      route_config: template.route_config.route ?? template.route_config,
    },
  })

  stages.push("log")

  await logInvokeStage(supabase, {
    runId: run.id,
    stage: "log",
    step: "initiated",
    message: "Invoke pipeline complete",
    metadata: {
      pipeline_complete: true,
      next_action: nextAction,
    },
  })

  return {
    workflow_run_id: run.id,
    template_type: template.id,
    classified,
    next_action: nextAction,
    stages,
    template: {
      id: template.id,
      name: template.name,
      type: template.type,
      active: template.active,
    },
  }
}

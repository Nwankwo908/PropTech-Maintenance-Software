import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { classifyWorkflow } from "./classify.ts"
import { getWorkflowTemplate } from "./registry.ts"
import { logWorkflowStage } from "./logStage.ts"
import type {
  ClassifiedIntent,
  WorkflowEngineResult,
  WorkflowExecutionContext,
  WorkflowRunRow,
  WorkflowTriggerType,
} from "./types.ts"

export type RunWorkflowEngineOptions = {
  /** Pin classification when the active run is already known (lifecycle start, portal advance). */
  classified?: ClassifiedIntent
}

/**
 * Execute the property operations workflow pipeline:
 * trigger → classify → route → act → escalate → log
 */
export async function runWorkflowEngine(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
  opts?: RunWorkflowEngineOptions,
): Promise<WorkflowEngineResult> {
  const stages: WorkflowEngineResult["stages"] = []
  const identity = ctx.sms?.identity

  stages.push("trigger")
  await logWorkflowStage(supabase, {
    stage: "trigger",
    ctx,
    identity,
    metadata: {
      trigger: ctx.trigger,
      body_preview: ctx.sms?.inbound.body.slice(0, 160),
    },
  })

  stages.push("classify")
  const classified = opts?.classified ??
    await classifyWorkflow(supabase, ctx)
  ctx.runId = classified.runId ?? ctx.runId

  await logWorkflowStage(supabase, {
    stage: "classify",
    ctx,
    intent: classified,
    identity,
  })

  stages.push("route")
  const template = getWorkflowTemplate(classified.templateId)
  await logWorkflowStage(supabase, {
    stage: "route",
    ctx,
    intent: classified,
    identity,
    metadata: { template_name: template.name },
  })

  stages.push("act")
  const result = await template.act(supabase, ctx, classified)
  ctx.runId = result.runId ?? ctx.runId

  await logWorkflowStage(supabase, {
    stage: "act",
    ctx,
    intent: classified,
    result,
    identity,
  })

  if (result.shouldEscalate && template.escalate) {
    stages.push("escalate")
    const escalation = await template.escalate(supabase, ctx, result)
    if (escalation?.escalated) {
      await logWorkflowStage(supabase, {
        stage: "escalate",
        ctx,
        intent: classified,
        result,
        identity,
        metadata: {
          escalation_reason: escalation.reason,
          ...escalation.metadata,
        },
      })
    }
  }

  stages.push("log")
  await logWorkflowStage(supabase, {
    stage: "log",
    ctx,
    intent: classified,
    result,
    identity,
    metadata: { pipeline_complete: true },
  })

  return { ...result, stages, classified }
}

/** Map lifecycle start triggers so initial outreach runs (not cron escalation sweep). */
export function lifecycleStartEngineTrigger(
  triggerType: WorkflowTriggerType,
): WorkflowTriggerType {
  if (triggerType === "cron") return "automation"
  return triggerType
}

/**
 * Run the engine pipeline for an existing workflow_run (skips open classification).
 */
export async function runWorkflowEngineForExistingRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    trigger: WorkflowTriggerType
    extras?: Partial<WorkflowExecutionContext>
  },
): Promise<WorkflowEngineResult> {
  const ctx: WorkflowExecutionContext = {
    trigger: params.trigger,
    landlordId: params.landlordId,
    runId: params.run.id,
    activeRun: params.run,
    ...params.extras,
  }

  return runWorkflowEngine(supabase, ctx, {
    classified: {
      templateId: params.run.template_id,
      confidence: "high",
      reason: "existing_workflow_run",
      runId: params.run.id,
    },
  })
}

/**
 * Inspection workflow template — notice → await access → remind → escalate → complete.
 */
import { workflowRouteForTemplate } from "../logStage.ts"
import { escalateLifecycleRunById } from "../lifecycleEscalation.ts"
import {
  cancelInspectionWorkflow,
  completeInspectionWorkflow,
  executeInspectionAdminAction,
  executeInspectionMissedWindow,
  executeInspectionOutreach,
  executeInspectionRegisterAndOutreach,
  processInspectionResidentReply,
  recordInspectionOutcome,
} from "../inspectionProgress.ts"
import { normalizeInspectionOutcome } from "../inspectionChecklist.ts"
import { ensureLifecycleWorkflowStartedLogged } from "../lifecycleStartLog.ts"
import { isLifecycleInitialActTrigger } from "../lifecyclePolicy.ts"
import type { InspectionEngineInput } from "../inspectionEngine.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

export const inspectionTemplate: WorkflowTemplate = {
  id: "inspection",
  name: "Inspection",
  supportedTriggers: ["dashboard", "automation", "cron", "sms_inbound", "webhook"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.cron?.templateId === "inspection") {
      return {
        templateId: "inspection",
        confidence: "high",
        reason: "cron_inspection",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (
      ctx.trigger === "dashboard" ||
      ctx.trigger === "automation" ||
      ctx.trigger === "webhook"
    ) {
      return {
        templateId: "inspection",
        confidence: "medium",
        reason: "lifecycle_inspection",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }
    if (ctx.trigger === "sms_inbound" && ctx.activeRun?.template_id === "inspection") {
      return {
        templateId: "inspection",
        confidence: "high",
        reason: "active_inspection_sms",
        runId: ctx.activeRun.id,
      }
    }
    return null
  },

  async act(supabase, ctx, intent): Promise<WorkflowActResult> {
    const runId = intent.runId ?? ctx.runId ?? ctx.activeRun?.id ?? null
    if (runId) {
      await ensureLifecycleWorkflowStartedLogged(supabase, {
        landlordId: ctx.landlordId,
        runId,
        trigger: ctx.trigger,
      })
    }
    const inspection = (ctx as WorkflowExecutionContext & {
      inspection?: InspectionEngineInput
    }).inspection

    if (runId && inspection?.action === "send_outreach") {
      const result = await executeInspectionOutreach(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "send_outreach", ...result },
      }
    }

    if (runId && inspection?.action === "register_and_outreach") {
      const result = await executeInspectionRegisterAndOutreach(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "register_and_outreach", ...result },
      }
    }

    if (runId && inspection?.action === "complete") {
      await completeInspectionWorkflow(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "complete", step: "completed" },
      }
    }

    if (runId && inspection?.action === "cancel_inspection") {
      await cancelInspectionWorkflow(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "cancel_inspection", step: "cancelled" },
      }
    }

    if (runId && inspection?.action === "mark_missed_window") {
      const result = await executeInspectionMissedWindow(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "mark_missed_window", ...result },
      }
    }

    if (runId && inspection?.action === "record_outcome") {
      const outcome = normalizeInspectionOutcome(inspection.outcome)
      if (!outcome) {
        return {
          templateId: "inspection",
          route: workflowRouteForTemplate("inspection"),
          runId,
          metadata: { action: "record_outcome", ok: false, error: "Invalid outcome" },
        }
      }
      const result = await recordInspectionOutcome(supabase, {
        landlordId: ctx.landlordId,
        runId,
        outcome,
        notes: inspection.notes,
        completeWorkflow: true,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "record_outcome", ...result },
      }
    }

    if (
      runId &&
      inspection?.action &&
      [
        "send_reminder",
        "mark_no_show",
        "complete_inspection",
      ].includes(inspection.action)
    ) {
      const result = await executeInspectionAdminAction(supabase, {
        landlordId: ctx.landlordId,
        runId,
        action: inspection.action,
        outcome: inspection.outcome,
        notes: inspection.notes,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: {
          action: inspection.action,
          ok: result.ok,
          error: result.error,
        },
      }
    }

    if (runId && inspection?.action === "resident_replied") {
      const body = inspection.smsBody ?? ctx.sms?.inbound.body ?? ""
      const result = await processInspectionResidentReply(supabase, {
        landlordId: ctx.landlordId,
        runId,
        body,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        replyHint: result.replyHint,
        metadata: {
          action: "resident_replied",
          step: result.step,
          completed: result.completed,
        },
      }
    }

    if (runId && isLifecycleInitialActTrigger(ctx.trigger)) {
      const result = await executeInspectionOutreach(supabase, {
        landlordId: ctx.landlordId,
        runId,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "initial_act", ...result },
      }
    }

    if (ctx.trigger === "sms_inbound" && runId) {
      const body = ctx.sms?.inbound.body ?? ""
      const result = await processInspectionResidentReply(supabase, {
        landlordId: ctx.landlordId,
        runId,
        body,
      })
      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        replyHint: result.replyHint,
        metadata: {
          action: "sms_inbound",
          step: result.step,
          completed: result.completed,
        },
      }
    }

    if (ctx.trigger === "cron" && runId) {
      const cronReason = ctx.cron?.escalationReason
      if (cronReason === "missed_inspection_window") {
        const result = await executeInspectionMissedWindow(supabase, {
          landlordId: ctx.landlordId,
          runId,
        })
        return {
          templateId: "inspection",
          route: workflowRouteForTemplate("inspection"),
          runId,
          metadata: { action: "cron_missed_window", ...result },
          shouldEscalate: result.step === "escalated",
          escalationReason: "missed_inspection_window",
        }
      }

      return {
        templateId: "inspection",
        route: workflowRouteForTemplate("inspection"),
        runId,
        metadata: { action: "noop" },
        shouldEscalate: true,
        escalationReason: cronReason ?? "cron_sweep",
      }
    }

    return {
      templateId: "inspection",
      route: workflowRouteForTemplate("inspection"),
      runId,
      metadata: { action: "noop" },
      shouldEscalate: false,
    }
  },

  async escalate(supabase, ctx, result): Promise<EscalationResult | null> {
    const runId = result.runId ?? ctx.runId
    if (!runId) return null
    const out = await escalateLifecycleRunById(supabase, {
      landlordId: ctx.landlordId,
      runId,
      reason: result.escalationReason ?? ctx.cron?.escalationReason ??
        "stalled_inspection",
      escalationConfig: ctx.cron?.escalationConfig,
    })
    if (!out || out.action === "skipped") {
      return {
        escalated: false,
        reason: out?.reason ?? "skipped",
        metadata: { action: "skipped" },
      }
    }
    return {
      escalated: out.action === "escalated",
      reason: out.reason,
      metadata: {
        action: out.action,
        sms_sent: out.sms_sent,
        admin_notified: out.admin_notified,
        admin_notify_errors: out.admin_notify_errors,
      },
    }
  },
}

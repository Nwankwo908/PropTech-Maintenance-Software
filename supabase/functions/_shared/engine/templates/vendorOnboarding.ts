/**
 * Vendor onboarding workflow template — preferred vendor verification pipeline.
 * trigger → classify → route → act → escalate → log
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { workflowRouteForTemplate } from "../logStage.ts"
import {
  advanceVendorOnboardingAdminApprove,
  advanceVendorOnboardingInProgress,
  advanceVendorOnboardingOnSubmit,
  abortFailedVendorOnboardingInvite,
  markVendorOnboardingInviteDelivered,
  readVendorOnboardingState,
  startVendorOnboardingRun,
} from "../vendorOnboardingProgress.ts"
import {
  vendorOnboardingInviteWasDelivered,
  type VendorOnboardingStep,
} from "../vendorOnboardingPolicy.ts"
import { escalateVendorOnboardingRun } from "../vendorOnboardingEscalation.ts"
import { getWorkflowRunById } from "../workflowRuns.ts"
import { deliverVendorInvite } from "../../vendor_verification/deliverVendorInvite.ts"
import {
  finalizeVendorVerificationAdminApprove,
  finalizeVendorVerificationSubmit,
  VendorVerificationSubmitError,
} from "../../vendor_verification/finalizeVendorVerificationSubmit.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"
import { uloAppUrl } from "../../uloAppUrl.ts"

async function loadFormLinkForRun(
  supabase: SupabaseClient,
  runId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("vendor_verifications")
    .select("token")
    .eq("workflow_run_id", runId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const token = typeof data?.token === "string" ? data.token.trim() : ""
  return token ? uloAppUrl.vendorVerification(token) : null
}

export const vendorOnboardingTemplate: WorkflowTemplate = {
  id: "vendor_onboarding",
  name: "Vendor Onboarding",
  supportedTriggers: ["dashboard", "vendor_portal", "cron", "automation", "sms_inbound"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.cron?.templateId === "vendor_onboarding") {
      return {
        templateId: "vendor_onboarding",
        confidence: "high",
        reason: "cron_vendor_onboarding",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }

    if (ctx.trigger === "dashboard" || ctx.trigger === "automation") {
      return {
        templateId: "vendor_onboarding",
        confidence: "medium",
        reason: "dashboard_vendor_invite",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }

    if (ctx.trigger === "vendor_portal") {
      return {
        templateId: "vendor_onboarding",
        confidence: "high",
        reason: "vendor_portal_verification",
        runId: ctx.runId ?? ctx.activeRun?.id ?? null,
      }
    }

    // SMS on an active vendor_onboarding conversation is pinned by classifyWorkflow.
    if (ctx.trigger === "sms_inbound" && ctx.activeRun?.template_id === "vendor_onboarding") {
      return {
        templateId: "vendor_onboarding",
        confidence: "high",
        reason: "active_vendor_onboarding_sms",
        runId: ctx.activeRun.id,
      }
    }

    return null
  },

  async act(supabase, ctx, intent): Promise<WorkflowActResult> {
    const runId = intent.runId ?? ctx.runId ?? ctx.activeRun?.id ?? null
    const meta = (ctx as WorkflowExecutionContext & {
      vendorOnboarding?: {
        action?: string
        verificationId?: string
        vendorId?: string | null
        vendorLabel?: string
        overall?: "verified" | "needs_review"
        completeCount?: number
        requiredCount?: number
        channel?: string
        businessName?: string | null
        contactName?: string | null
        inviteRequest?: {
          vendorId: string | null
          businessName: string | null
          contactName: string | null
          vendorFirstName: string | null
          email: string | null
          phone: string | null
          propertyName: string | null
          channel: string
          tradeCategories: string[]
          vendorName: string | null
          companyName: string | null
        }
        inviteDelivered?: {
          verificationId: string
          vendorLabel: string
          channel: string
          delivery: Record<string, unknown>
          anyDelivered: boolean
          deliveredVia: string
          conversationId?: string | null
        }
      }
    }).vendorOnboarding

    // Programmatic portal / invite advances (when callers attach vendorOnboarding).
    if (meta?.action === "start_invite" && !runId) {
      const run = await startVendorOnboardingRun(supabase, {
        landlordId: ctx.landlordId,
        vendorId: meta.vendorId ?? meta.inviteRequest?.vendorId ?? null,
        channel: meta.channel ?? meta.inviteRequest?.channel ?? "both",
        businessName: meta.businessName ?? meta.inviteRequest?.businessName,
        contactName: meta.contactName ?? meta.inviteRequest?.contactName,
        triggerType: ctx.trigger,
      })
      const newRunId = run?.id ?? null

      if (newRunId && meta.inviteRequest) {
        const delivered = await deliverVendorInvite(supabase, {
          landlordId: ctx.landlordId,
          workflowRunId: newRunId,
          ...meta.inviteRequest,
        })
        if (!delivered || !vendorOnboardingInviteWasDelivered(delivered)) {
          if (newRunId) {
            await abortFailedVendorOnboardingInvite(supabase, {
              runId: newRunId,
              landlordId: ctx.landlordId,
              vendorId: meta.vendorId ?? meta.inviteRequest?.vendorId ?? null,
              vendorLabel:
                meta.businessName ??
                meta.contactName ??
                meta.inviteRequest?.businessName ??
                meta.inviteRequest?.contactName ??
                "vendor",
              verificationId: delivered?.verificationId ?? null,
              delivery: delivered?.delivery ?? null,
            })
          }
          return {
            templateId: "vendor_onboarding",
            route: workflowRouteForTemplate("vendor_onboarding"),
            runId: null,
            metadata: {
              action: "start_invite",
              error: "invite_delivery_failed",
              delivery: delivered?.delivery ?? null,
            },
          }
        }
        return {
          templateId: "vendor_onboarding",
          route: workflowRouteForTemplate("vendor_onboarding"),
          runId: newRunId,
          metadata: {
            action: "start_invite",
            step: "invited",
            verificationId: delivered.verificationId,
            token: delivered.token,
            link: delivered.link,
            delivery: delivered.delivery,
            anyDelivered: delivered.anyDelivered,
            deliveredVia: delivered.deliveredVia,
            workflowRunId: newRunId,
          },
        }
      }

      return {
        templateId: "vendor_onboarding",
        route: workflowRouteForTemplate("vendor_onboarding"),
        runId: newRunId,
        metadata: { action: "start_invite", step: "invited" },
      }
    }

    if (runId && meta?.action === "invite_delivered" && meta.inviteDelivered) {
      const delivered = meta.inviteDelivered
      await markVendorOnboardingInviteDelivered(supabase, {
        runId,
        verificationId: delivered.verificationId,
        vendorLabel: delivered.vendorLabel,
        channel: delivered.channel,
        delivery: delivered.delivery,
        anyDelivered: delivered.anyDelivered,
        deliveredVia: delivered.deliveredVia,
        conversationId: delivered.conversationId ?? null,
      })
      return {
        templateId: "vendor_onboarding",
        route: workflowRouteForTemplate("vendor_onboarding"),
        runId,
        metadata: { action: "invite_delivered", step: "invited" },
      }
    }

    if (runId && meta?.action === "portal_in_progress" && meta.verificationId) {
      await advanceVendorOnboardingInProgress(supabase, {
        runId,
        verificationId: meta.verificationId,
        vendorId: meta.vendorId,
        vendorLabel: meta.vendorLabel,
      })
      return {
        templateId: "vendor_onboarding",
        route: workflowRouteForTemplate("vendor_onboarding"),
        runId,
        metadata: { action: "portal_in_progress", step: "in_progress" },
      }
    }

    if (
      runId &&
      meta?.action === "submit" &&
      meta.verificationId
    ) {
      try {
        const finalized = await finalizeVendorVerificationSubmit(supabase, {
          landlordId: ctx.landlordId,
          verificationId: meta.verificationId,
        })
        await advanceVendorOnboardingOnSubmit(supabase, {
          runId,
          verificationId: meta.verificationId,
          vendorId: finalized.vendorId,
          vendorLabel: finalized.vendorLabel,
          overall: finalized.overall,
          completeCount: finalized.checklist.completeCount,
          requiredCount: finalized.checklist.requiredCount,
        })
        return {
          templateId: "vendor_onboarding",
          route: workflowRouteForTemplate("vendor_onboarding"),
          runId,
          metadata: {
            action: "submit",
            step: finalized.overall,
            overall: finalized.overall,
            vendorId: finalized.vendorId,
          },
        }
      } catch (err) {
        const message = err instanceof VendorVerificationSubmitError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err)
        console.error("[vendor_onboarding] submit failed", message)
        return {
          templateId: "vendor_onboarding",
          route: workflowRouteForTemplate("vendor_onboarding"),
          runId,
          metadata: { action: "submit", error: message },
        }
      }
    }

    if (runId && meta?.action === "admin_approve" && meta.verificationId) {
      try {
        const finalized = await finalizeVendorVerificationAdminApprove(supabase, {
          landlordId: ctx.landlordId,
          verificationId: meta.verificationId,
        })
        await advanceVendorOnboardingAdminApprove(supabase, {
          runId,
          verificationId: meta.verificationId,
          vendorId: finalized.vendorId,
          vendorLabel: finalized.vendorLabel,
        })
        return {
          templateId: "vendor_onboarding",
          route: workflowRouteForTemplate("vendor_onboarding"),
          runId,
          metadata: {
            action: "admin_approve",
            step: "verified",
            vendorId: finalized.vendorId,
          },
        }
      } catch (err) {
        const message = err instanceof VendorVerificationSubmitError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err)
        console.error("[vendor_onboarding] admin_approve failed", message)
        return {
          templateId: "vendor_onboarding",
          route: workflowRouteForTemplate("vendor_onboarding"),
          runId,
          metadata: { action: "admin_approve", error: message },
        }
      }
    }

    // SMS inbound while waiting on the form — nudge with the link.
    if (ctx.trigger === "sms_inbound" && runId) {
      const run = ctx.activeRun ?? await getWorkflowRunById(supabase, runId)
      const step = run ? readVendorOnboardingState(run).step : null
      const link = await loadFormLinkForRun(supabase, runId)
      let replyHint =
        "Thanks — please finish your verification using the link we sent so we can begin sending you work orders."
      if (link) {
        replyHint =
          "Thanks for your message. Please finish your verification here (about 5 minutes):\n\n" +
          link
      }
      if (step === "verified") {
        replyHint =
          "You're all set — your verification is complete and you're eligible for work orders."
      } else if (step === "needs_review") {
        replyHint = link
          ? "Thanks — a few verification items still need attention. Please open your form to finish:\n\n" +
            link
          : "Thanks — a few verification items still need attention. Please open the form link we sent earlier."
      }

      return {
        templateId: "vendor_onboarding",
        route: workflowRouteForTemplate("vendor_onboarding"),
        runId,
        replyHint,
        metadata: {
          action: "sms_nudge",
          step: (step ?? "invited") as VendorOnboardingStep,
        },
      }
    }

    // Cron / default: no-op act; escalation sweep handles reminders.
    return {
      templateId: "vendor_onboarding",
      route: workflowRouteForTemplate("vendor_onboarding"),
      runId,
      metadata: {
        action: "noop",
        step: ctx.activeRun
          ? readVendorOnboardingState(ctx.activeRun).step
          : null,
      },
      shouldEscalate: ctx.trigger === "cron",
      escalationReason: ctx.cron?.escalationReason ??
        (ctx.trigger === "cron" ? "cron_sweep" : undefined),
    }
  },

  async escalate(supabase, ctx, result): Promise<EscalationResult | null> {
    const runId = result.runId ?? ctx.runId ?? ctx.activeRun?.id
    if (!runId) return null

    const run = ctx.activeRun ?? await getWorkflowRunById(supabase, runId)
    if (!run) return null

    const escalated = await escalateVendorOnboardingRun(supabase, {
      landlordId: ctx.landlordId,
      run,
      reason: result.escalationReason ?? ctx.cron?.escalationReason ??
        "stalled_vendor_onboarding",
      escalationConfig: ctx.cron?.escalationConfig,
    })

    if (!escalated || escalated.action === "skipped") {
      return {
        escalated: false,
        reason: escalated?.reason ?? "skipped",
        metadata: escalated ? { ...escalated } : undefined,
      }
    }

    return {
      escalated: escalated.action === "escalated",
      reason: escalated.reason,
      metadata: {
        action: escalated.action,
        sms_sent: escalated.sms_sent,
        email_sent: escalated.email_sent,
        admin_notified: escalated.admin_notified,
      },
    }
  },
}

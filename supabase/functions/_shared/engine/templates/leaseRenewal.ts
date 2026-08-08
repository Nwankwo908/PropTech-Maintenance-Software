import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../../graph/logGraphEvent.ts"
import { notifyLandlordNeedsAttention } from "../../landlordAttentionNotify.ts"
import { sendInboundAutoReply } from "../../sms/inboundReply.ts"
import {
  buildEarlyLeaseInquiryAckSms,
  isLeaseRenewalInquirySms,
  parseLeaseRenewalInquiry,
} from "../../sms/leaseRenewalInquiry.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../../sms/inbound_db.ts"
import type { SmsProviderName } from "../../sms/types.ts"
import {
  createWorkflowRun,
  findActiveWorkflowRun,
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  runConversationId,
  runLeaseEndDate,
  runStepState,
  updateWorkflowRun,
} from "../workflowRuns.ts"
import {
  fetchWorkflowTemplateConfig,
  leaseRenewalTimingFromConfig,
} from "../templateConfig.ts"
import { workflowRouteForTemplate } from "../logStage.ts"
import type {
  ClassifiedIntent,
  EscalationResult,
  WorkflowActResult,
  WorkflowExecutionContext,
  WorkflowTemplate,
} from "../types.ts"

export type LeaseRenewalStep =
  | "initiated"
  | "early_inquiry"
  | "awaiting_response"
  | "completed"
  | "escalated"

export type LeaseRenewalState = {
  step?: LeaseRenewalStep
  response?: "renew" | "move_out" | "questions"
  lease_end_date?: string
  unit_label?: string
  outreach_sent_at?: string
  /** Tenant asked before cron outreach window. */
  early_inquiry?: boolean
  early_inquiry_at?: string
  preferred_term_years?: 1 | 2 | "either" | null
  wants_renewal_timing?: boolean
  last_inbound_summary?: string
}

function parseRenewalReply(body: string): "renew" | "move_out" | "questions" | null {
  const t = body.trim().toLowerCase()
  if (/^(yes|y|renew|stay|staying)\b/.test(t)) return "renew"
  if (/^(no|n|move|moving|leave|leaving|vacate)\b/.test(t)) return "move_out"
  if (/question|help|talk|call|manager/.test(t)) return "questions"
  return null
}

function renewalPrompt(state: LeaseRenewalState): string {
  const end = state.lease_end_date
    ? new Date(`${state.lease_end_date}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    : "soon"

  if (state.step === "awaiting_response" || state.step === "initiated") {
    const termNote = state.preferred_term_years === "either"
      ? " We also noted you're open to a 1- or 2-year term."
      : state.preferred_term_years === 1
      ? " We also noted you'd prefer a 1-year term."
      : state.preferred_term_years === 2
      ? " We also noted you'd prefer a 2-year term."
      : ""

    if (state.early_inquiry) {
      return (
        `Hi, this is your property management team. Following up on your lease renewal note — your lease ends ${end}, and we'd love for you to stay.${termNote} ` +
        `Reply YES to renew, NO if you're moving out, or QUESTIONS if you'd like to talk it through with us.`
      )
    }

    return `Hi, this is your property management team. Your lease ends ${end}, and we'd love for you to stay.${termNote} Are you planning to renew? Reply YES to renew, NO if you're moving out, or QUESTIONS if you'd like to talk it through with us.`
  }

  return "Thanks! Your property manager will follow up with you about your lease."
}

export const leaseRenewalTemplate: WorkflowTemplate = {
  id: "lease_renewal",
  name: "Lease renewal",
  supportedTriggers: ["cron", "sms_inbound", "dashboard"],

  classify(ctx): ClassifiedIntent | null {
    if (ctx.activeRun?.template_id === "lease_renewal") {
      return {
        templateId: "lease_renewal",
        confidence: "high",
        reason: "active_run",
        runId: ctx.activeRun.id,
      }
    }

    if (ctx.cron?.templateId === "lease_renewal") {
      return {
        templateId: "lease_renewal",
        confidence: "high",
        reason: "cron_trigger",
      }
    }

    const sms = ctx.sms
    if (
      sms?.identity.resident_id?.trim() &&
      isLeaseRenewalInquirySms(sms.inbound.body)
    ) {
      return {
        templateId: "lease_renewal",
        confidence: "high",
        reason: "early_lease_inquiry_sms",
      }
    }

    return null
  },

  async act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    intent: ClassifiedIntent,
  ): Promise<WorkflowActResult> {
    if (ctx.trigger === "cron") {
      if (ctx.runId && ctx.cron?.escalationReason) {
        return {
          templateId: "lease_renewal",
          route: workflowRouteForTemplate("lease_renewal"),
          runId: ctx.runId,
          shouldEscalate: true,
          escalationReason: ctx.cron.escalationReason,
          metadata: { action: "cron_escalation" },
        }
      }
      return processLeaseRenewalCron(supabase, ctx)
    }

    return processLeaseRenewalSmsReply(supabase, ctx, intent)
  },

  async escalate(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    result: WorkflowActResult,
  ): Promise<EscalationResult | null> {
    if (!result.shouldEscalate || !ctx.runId) return null

    await updateWorkflowRun(supabase, ctx.runId, {
      status: "escalated",
      currentStep: "escalated",
      metadata: { escalated_at: new Date().toISOString() },
      pipelineStage: "escalate",
      eventMessage: result.escalationReason ?? "no_response",
      eventStep: "escalated",
    })

    await logGraphEvent(supabase, {
      landlord_id: ctx.landlordId,
      event_type: "lease.renewal_escalated",
      source: "automation",
      actor_type: "system",
      resident_id: ctx.activeRun?.resident_id ?? null,
      unit_id: ctx.activeRun?.unit_id ?? null,
      workflow_run_id: ctx.runId,
      workflow_template_id: "lease_renewal",
      metadata: {
        reason: result.escalationReason ?? "no_response",
      },
    })

    try {
      await notifyLandlordNeedsAttention(supabase, {
        landlordId: ctx.landlordId,
        kind: "lease_renewal",
        headline: "Lease renewal escalated",
        detail: "No tenant response — review renewal options",
        idempotencyKey: `lease_renewal:${ctx.runId}`,
        workflowRunId: ctx.runId,
        residentId: ctx.activeRun?.resident_id ?? null,
        unitId: ctx.activeRun?.unit_id ?? null,
      })
    } catch (e) {
      console.error("[lease-renewal] attention notify", e)
    }

    return {
      escalated: true,
      reason: result.escalationReason ?? "no_response",
    }
  },
}

async function loadResidentLeaseRow(
  supabase: SupabaseClient,
  residentId: string,
): Promise<{ lease_end_date: string | null; unit: string | null } | null> {
  const { data, error } = await supabase
    .from("users")
    .select("lease_end_date, unit")
    .eq("id", residentId)
    .maybeSingle()
  if (error || !data) {
    if (error) console.error("[lease-renewal] resident lookup", error.message)
    return null
  }
  return {
    lease_end_date: typeof data.lease_end_date === "string"
      ? data.lease_end_date
      : null,
    unit: typeof data.unit === "string" ? data.unit : null,
  }
}

/**
 * Pre-cron tenant inquiry: update lease_renewal run state + friendly ack.
 * Never escalates to Needs your attention.
 */
async function processEarlyLeaseInquiry(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
  params: {
    residentId: string
    run: Awaited<ReturnType<typeof findActiveWorkflowRun>> | null
  },
): Promise<WorkflowActResult> {
  const sms = ctx.sms!
  const inquiry = parseLeaseRenewalInquiry(sms.inbound.body)
  const resident = await loadResidentLeaseRow(supabase, params.residentId)
  const leaseEnd = resident?.lease_end_date ??
    (params.run ? runLeaseEndDate(params.run) : null)
  const unitLabel = resident?.unit ?? undefined

  let run = params.run
  const nowIso = new Date().toISOString()

  if (!run) {
    run = await createWorkflowRun(supabase, {
      templateId: "lease_renewal",
      landlordId: ctx.landlordId,
      triggerType: "sms_inbound",
      currentStep: "early_inquiry",
      residentId: params.residentId,
      entityType: "sms_conversation",
      entityId: sms.conversationId,
      metadata: {
        lease_end_date: leaseEnd,
        early_inquiry: true,
        unit_label: unitLabel,
        step_state: {
          step: "early_inquiry",
          early_inquiry: true,
          early_inquiry_at: nowIso,
          lease_end_date: leaseEnd ?? undefined,
          unit_label: unitLabel,
        } satisfies LeaseRenewalState,
      },
    })
  }

  if (!run) {
    return {
      templateId: "lease_renewal",
      route: workflowRouteForTemplate("lease_renewal"),
      replyHint:
        "Thanks for reaching out about your lease. I'm having trouble saving that just now — please try again in a moment, or contact your property manager directly.",
      metadata: { error: "create_run_failed", early_inquiry: true },
    }
  }

  ctx.runId = run.id
  ctx.activeRun = run

  await linkConversationToWorkflowRun(supabase, {
    conversationId: sms.conversationId,
    runId: run.id,
    templateId: "lease_renewal",
  })

  const prev = runStepState<LeaseRenewalState>(run)
  const nextState: LeaseRenewalState = {
    ...prev,
    step: inquiry.response === "move_out" ? "completed" : "early_inquiry",
    early_inquiry: true,
    early_inquiry_at: prev.early_inquiry_at ?? nowIso,
    lease_end_date: leaseEnd ?? prev.lease_end_date,
    unit_label: unitLabel ?? prev.unit_label,
    response: inquiry.response ?? prev.response,
    preferred_term_years: inquiry.preferredTermYears ??
      prev.preferred_term_years ??
      null,
    wants_renewal_timing: inquiry.wantsRenewalTiming ||
      Boolean(prev.wants_renewal_timing),
    last_inbound_summary: inquiry.noted.join("; ") || sms.inbound.body.slice(0, 200),
  }

  const completed = inquiry.response === "move_out"
  await updateWorkflowRun(supabase, run.id, {
    status: completed ? "completed" : "active",
    currentStep: nextState.step ?? "early_inquiry",
    completedAt: completed ? nowIso : undefined,
    metadata: {
      lease_end_date: nextState.lease_end_date,
      early_inquiry: true,
      unit_label: nextState.unit_label,
      step_state: nextState,
    },
    pipelineStage: "act",
    eventMessage: completed
      ? "Early lease inquiry — move-out noted"
      : "Early lease inquiry recorded",
    eventStep: nextState.step ?? "early_inquiry",
  })

  await logGraphEvent(supabase, {
    landlord_id: ctx.landlordId,
    event_type: completed
      ? "lease.move_out_confirmed"
      : "lease.early_inquiry_recorded",
    source: "sms",
    actor_type: "resident",
    actor_id: params.residentId,
    resident_id: params.residentId,
    conversation_id: sms.conversationId,
    message_id: sms.messageId,
    workflow_run_id: run.id,
    workflow_template_id: "lease_renewal",
    metadata: {
      lease_end_date: nextState.lease_end_date,
      response: nextState.response,
      preferred_term_years: nextState.preferred_term_years,
      wants_renewal_timing: nextState.wants_renewal_timing,
      early_inquiry: true,
      noted: inquiry.noted,
    },
  })

  const replyHint = buildEarlyLeaseInquiryAckSms({
    parse: inquiry,
    leaseEndDate: nextState.lease_end_date,
  })

  return {
    templateId: "lease_renewal",
    route: workflowRouteForTemplate("lease_renewal"),
    runId: run.id,
    replyHint,
    // Pre-cron: pipeline only — never Needs your attention.
    shouldEscalate: false,
    metadata: {
      early_inquiry: true,
      response: nextState.response,
      preferred_term_years: nextState.preferred_term_years,
      wants_renewal_timing: nextState.wants_renewal_timing,
      completed,
    },
  }
}

async function processLeaseRenewalSmsReply(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
  intent: ClassifiedIntent,
): Promise<WorkflowActResult> {
  const sms = ctx.sms
  if (!sms) {
    return {
      templateId: "lease_renewal",
      route: workflowRouteForTemplate("lease_renewal"),
      metadata: { error: "missing_sms_context" },
    }
  }

  const residentId = sms.identity.resident_id?.trim()
  if (!residentId) {
    return {
      templateId: "lease_renewal",
      route: workflowRouteForTemplate("lease_renewal"),
      replyHint:
        "Happy to help with your lease — I'll just need your unit number first so I can pull up the right home.",
      metadata: { blocked: "missing_resident_id" },
    }
  }

  let run =
    ctx.activeRun?.template_id === "lease_renewal"
      ? ctx.activeRun
      : await findActiveWorkflowRun(supabase, {
        landlordId: ctx.landlordId,
        residentId,
        templateId: "lease_renewal",
      })

  if (!run && intent.runId) {
    const byId = await getWorkflowRunById(supabase, intent.runId)
    if (byId?.template_id === "lease_renewal") run = byId
  }

  const state = run ? runStepState<LeaseRenewalState>(run) : {}
  const outreachOpen = Boolean(state.outreach_sent_at) ||
    state.step === "awaiting_response"
  const earlyInquirySms = isLeaseRenewalInquirySms(sms.inbound.body)
  const onEarlyInquiryRun = Boolean(state.early_inquiry) ||
    state.step === "early_inquiry"

  // Pre-cron (or follow-up on an early-inquiry run): friendly ack + state update.
  if (earlyInquirySms || (onEarlyInquiryRun && !outreachOpen)) {
    return processEarlyLeaseInquiry(supabase, ctx, { residentId, run })
  }

  if (!run) {
    // Short YES/NO without an open renewal — treat as early inquiry if lease-like, else nudge.
    if (earlyInquirySms) {
      return processEarlyLeaseInquiry(supabase, ctx, { residentId, run: null })
    }
    return {
      templateId: "lease_renewal",
      route: workflowRouteForTemplate("lease_renewal"),
      replyHint:
        "Thanks for your message about your lease. Your property management team will follow up with renewal details when they're ready. If you have a maintenance issue, just describe what's going on and I'll help.",
      metadata: { no_active_run: true },
    }
  }

  ctx.runId = run.id

  const linkedConversationId = runConversationId(run)
  if (linkedConversationId !== sms.conversationId) {
    await linkConversationToWorkflowRun(supabase, {
      conversationId: sms.conversationId,
      runId: run.id,
      templateId: "lease_renewal",
    })
  }

  const parsed = parseRenewalReply(sms.inbound.body)

  if (!parsed) {
    // Free-text while awaiting cron outreach — record as early-style inquiry without escalating.
    if (isLeaseRenewalInquirySms(sms.inbound.body) || onEarlyInquiryRun) {
      return processEarlyLeaseInquiry(supabase, ctx, { residentId, run })
    }
    return {
      templateId: "lease_renewal",
      route: workflowRouteForTemplate("lease_renewal"),
      runId: run.id,
      replyHint:
        "I didn't quite catch that — reply YES if you'd like to renew, NO if you're moving out, or QUESTIONS to talk with your property manager.",
      metadata: { step: state.step ?? "awaiting_response", invalid_reply: true },
    }
  }

  const nextState: LeaseRenewalState = {
    ...state,
    step: "completed",
    response: parsed,
  }

  await updateWorkflowRun(supabase, run.id, {
    status: "completed",
    currentStep: "completed",
    completedAt: new Date().toISOString(),
    metadata: { step_state: nextState },
    pipelineStage: "act",
    eventMessage: `Lease renewal response: ${parsed}`,
    eventStep: "completed",
  })

  const eventType =
    parsed === "renew"
      ? "lease.renewal_accepted"
      : parsed === "move_out"
      ? "lease.move_out_confirmed"
      : "lease.renewal_questions"

  await logGraphEvent(supabase, {
    landlord_id: ctx.landlordId,
    event_type: eventType,
    source: "sms",
    actor_type: "resident",
    actor_id: residentId,
    resident_id: residentId,
    unit_id: run.unit_id,
    conversation_id: sms.conversationId,
    message_id: sms.messageId,
    workflow_run_id: run.id,
    workflow_template_id: "lease_renewal",
    metadata: {
      lease_end_date: runLeaseEndDate(run),
      response: parsed,
    },
  })

  const replyHint =
    parsed === "renew"
      ? "Great — I've noted that you'd like to renew. Your property manager will reach out with next steps."
      : parsed === "move_out"
      ? "Thanks for letting us know. Your property manager will follow up about move-out details."
      : "Got it — someone from your property team will reach out to answer your questions about the lease."

  return {
    templateId: "lease_renewal",
    route: workflowRouteForTemplate("lease_renewal"),
    runId: run.id,
    replyHint,
    metadata: { response: parsed, completed: true },
  }
}

/** Cron: start lease renewal runs for residents approaching lease end. */
async function processLeaseRenewalCron(
  supabase: SupabaseClient,
  ctx: WorkflowExecutionContext,
): Promise<WorkflowActResult> {
  const templateConfig = await fetchWorkflowTemplateConfig(supabase, "lease_renewal")
  const { noticeDays, noResponseDays } = leaseRenewalTimingFromConfig(
    templateConfig,
    {
      noticeDays: ctx.cron?.noticeDays,
      noResponseDays: ctx.cron?.noResponseDays,
    },
  )
  const landlordId = ctx.landlordId

  const today = new Date()
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + noticeDays)

  const todayIso = today.toISOString().slice(0, 10)
  const horizonIso = horizon.toISOString().slice(0, 10)

  const { data: residents, error } = await supabase
    .from("users")
    .select("id, full_name, phone, unit, building, lease_end_date, status")
    .eq("status", "active")
    .not("lease_end_date", "is", null)
    .gte("lease_end_date", todayIso)
    .lte("lease_end_date", horizonIso)

  if (error) {
    console.error("[lease-renewal] cron query", error.message)
    return {
      templateId: "lease_renewal",
      route: workflowRouteForTemplate("lease_renewal"),
      metadata: { error: error.message },
    }
  }

  let started = 0
  let skipped = 0
  let outreachSent = 0

  for (const row of residents ?? []) {
    const residentId = String(row.id)
    const leaseEnd = String(row.lease_end_date)

    const existing = await findActiveWorkflowRun(supabase, {
      landlordId,
      residentId,
      templateId: "lease_renewal",
    })

    const existingState = existing
      ? runStepState<LeaseRenewalState>(existing)
      : null

    // Same lease cycle already has a run — don't duplicate. If it was an early
    // tenant inquiry without outreach yet, send the formal renew ask now.
    if (existing && runLeaseEndDate(existing) === leaseEnd) {
      const needsOutreach = Boolean(existingState?.early_inquiry) &&
        !existingState?.outreach_sent_at &&
        existing.status === "active"

      if (!needsOutreach) {
        skipped++
        continue
      }

      const phone = String(row.phone ?? "").trim()
      const mainLine = await lookupLandlordMainNumber(supabase, landlordId)
      if (phone && mainLine) {
        const prompt = renewalPrompt({
          step: "awaiting_response",
          lease_end_date: leaseEnd,
          unit_label: row.unit,
          preferred_term_years: existingState?.preferred_term_years,
        })
        const sent = await sendLeaseRenewalOutreach(supabase, {
          landlordId,
          residentId,
          phone,
          uloNumber: mainLine.phone,
          smsNumberId: mainLine.id,
          provider: mainLine.provider,
          body: prompt,
          runId: existing.id,
        })
        if (sent) {
          outreachSent++
          const dueAt = new Date()
          dueAt.setDate(dueAt.getDate() + noResponseDays)
          await updateWorkflowRun(supabase, existing.id, {
            currentStep: "awaiting_response",
            metadata: {
              lease_end_date: leaseEnd,
              due_at: dueAt.toISOString(),
              early_inquiry: true,
              step_state: {
                ...existingState,
                step: "awaiting_response",
                lease_end_date: leaseEnd,
                unit_label: row.unit,
                outreach_sent_at: new Date().toISOString(),
              },
            },
            pipelineStage: "route",
            eventMessage: "Renewal offer sent after early inquiry",
            eventStep: "awaiting_response",
          })
        }
      } else {
        skipped++
      }
      continue
    }

    const dueAt = new Date()
    dueAt.setDate(dueAt.getDate() + noResponseDays)

    const run = await createWorkflowRun(supabase, {
      templateId: "lease_renewal",
      landlordId,
      triggerType: "cron",
      currentStep: "initiated",
      residentId,
      metadata: {
        lease_end_date: leaseEnd,
        due_at: dueAt.toISOString(),
        unit_label: row.unit,
        step_state: {
          step: "awaiting_response",
          lease_end_date: leaseEnd,
          unit_label: row.unit,
        },
      },
    })

    if (!run) continue
    started++

    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "lease.renewal_started",
      source: "automation",
      actor_type: "system",
      resident_id: residentId,
      workflow_run_id: run.id,
      workflow_template_id: "lease_renewal",
      metadata: {
        lease_end_date: leaseEnd,
        unit: row.unit,
        building: row.building,
      },
    })

    const phone = String(row.phone ?? "").trim()
    const mainLine = await lookupLandlordMainNumber(supabase, landlordId)
    if (phone && mainLine) {
      const prompt = renewalPrompt({
        step: "awaiting_response",
        lease_end_date: leaseEnd,
        unit_label: row.unit,
      })

      const sent = await sendLeaseRenewalOutreach(supabase, {
        landlordId,
        residentId,
        phone,
        uloNumber: mainLine.phone,
        smsNumberId: mainLine.id,
        provider: mainLine.provider,
        body: prompt,
        runId: run.id,
      })

      if (sent) {
        outreachSent++
        await updateWorkflowRun(supabase, run.id, {
          currentStep: "awaiting_response",
          metadata: {
            step_state: {
              step: "awaiting_response",
              lease_end_date: leaseEnd,
              unit_label: row.unit,
              outreach_sent_at: new Date().toISOString(),
            },
          },
          pipelineStage: "route",
          eventMessage: "Renewal offer sent",
          eventStep: "awaiting_response",
        })
      }
    }
  }

  return {
    templateId: "lease_renewal",
    route: workflowRouteForTemplate("lease_renewal"),
    metadata: {
      notice_days: noticeDays,
      no_response_days: noResponseDays,
      template_active: templateConfig?.active ?? true,
      candidates: residents?.length ?? 0,
      started,
      skipped,
      outreach_sent: outreachSent,
    },
  }
}

async function lookupLandlordMainNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ phone: string; id: string; provider: SmsProviderName } | null> {
  const { data } = await supabase
    .from("sms_numbers")
    .select("id, phone_number, provider")
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  if (!data?.phone_number || !data?.id) return null

  const provider = (data.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName
  return {
    phone: String(data.phone_number).trim(),
    id: String(data.id),
    provider,
  }
}

async function sendLeaseRenewalOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    phone: string
    uloNumber: string
    body: string
    runId: string
    provider: SmsProviderName
    smsNumberId: string
  },
): Promise<boolean> {
  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: params.phone,
    landlordId: params.landlordId,
    identityType: "resident",
    residentId: params.residentId,
  })

  if (!identity) return false

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: params.smsNumberId,
    externalPhone: params.phone,
    identity,
    maintenanceRequestId: null,
    conversationStatus: "open",
  })

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.runId,
    templateId: "lease_renewal",
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: params.uloNumber,
    toNumber: params.phone,
    body: params.body,
    provider: params.provider,
    source: "workflow_lease_renewal_outreach",
  })

  return sent.ok
}

export { renewalPrompt }

/**
 * Cron processor: mid-intake silence nudge + unit_entry resolve.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  classifyIntakeSilenceFollowUp,
  type IntakeSilenceSnapshot,
  type IntakeSilenceThresholds,
  type IntakeSilenceUrgencyAlertTier,
} from "../../../../shared/ops/intakeSilenceFollowUp.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { gateResidentAutomatedReminder } from "../gateResidentAutomatedReminder.ts"
import {
  applyQuestionPlan,
  markQuestionAsked,
} from "./determineNextMaintenanceQuestion.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import {
  conversationStatusForStep,
  type SmsIntakeState,
  type UrgencyAlertTier,
} from "./residentIntakeTypes.ts"
import { submitSmsMaintenanceRequest } from "./submitSmsMaintenanceRequest.ts"

export type IntakeSilenceProcessSummary = {
  scanned: number
  nudged: number
  resolved: number
  escalated: number
  skipped: number
  deferredQuietHours: number
  dryRun: boolean
}

type ConvRow = {
  id: string
  landlord_id: string | null
  resident_id: string | null
  external_phone_number: string | null
  status: string | null
  conversation_type: string | null
  intake_state: SmsIntakeState | null
  maintenance_request_id: string | null
  updated_at: string | null
}

function asState(raw: unknown): SmsIntakeState {
  if (!raw || typeof raw !== "object") return {}
  return { ...(raw as SmsIntakeState) }
}

function normalizeAlertTier(
  raw: string | null | undefined,
): IntakeSilenceUrgencyAlertTier | null {
  const t = String(raw ?? "").trim().toLowerCase()
  if (t === "life_safety") return "life_safety"
  if (t === "same_day") return "same_day"
  return null
}

function snapshotFromConversation(
  row: ConvRow,
  draftUrgency?: string | null,
): IntakeSilenceSnapshot {
  const state = asState(row.intake_state)
  // Legacy stuck intakes (pre-stamp) — use conversation updated_at as asked_at.
  const hasOpenQuestion =
    Boolean(state.diagnostic_question?.trim()) ||
    String(state.step ?? "").toLowerCase() === "photo"
  const askedAt =
    state.open_question_asked_at?.trim() ||
    (hasOpenQuestion ? row.updated_at : null)
  // Prefer intake_state (set in applyQuestionPlan before unit_entry); fall back
  // to draft ticket.urgency written by ensureEarlySmsTicket.
  const urgency =
    state.urgency?.trim() ||
    state.recommended_urgency?.trim() ||
    draftUrgency?.trim() ||
    null
  return {
    conversationId: row.id,
    landlordId: String(row.landlord_id ?? ""),
    step: state.step ?? null,
    diagnosticQuestionType: state.diagnostic_question_type ?? null,
    diagnosticQuestion: state.diagnostic_question ?? null,
    openQuestionAskedAt: askedAt ?? null,
    silenceNudgeSentAt: state.intake_silence_nudge_sent_at ?? null,
    silenceResolvedAt: state.intake_silence_resolved_at ?? null,
    draftTicketId: state.draft_ticket_id ?? row.maintenance_request_id ?? null,
    description: state.description ?? state.initial_message ?? null,
    issueHeadline: state.acknowledged_headline ?? null,
    issueType: state.issue_type ?? null,
    vendorTrade: state.vendor_trade ?? null,
    urgency,
    urgencyAlertTier: normalizeAlertTier(state.urgency_alert_tier),
  }
}

async function loadDraftUrgency(
  supabase: SupabaseClient,
  ticketId: string | null,
): Promise<string | null> {
  if (!ticketId?.trim()) return null
  const { data } = await supabase
    .from("maintenance_requests")
    .select("urgency")
    .eq("id", ticketId)
    .maybeSingle()
  const u = (data as { urgency?: string } | null)?.urgency
  return typeof u === "string" && u.trim() ? u.trim() : null
}

async function saveState(
  supabase: SupabaseClient,
  conversationId: string,
  state: SmsIntakeState,
): Promise<void> {
  const step = state.step ?? "issue_type"
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: state,
      status: conversationStatusForStep(step),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

async function sendResidentSms(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    toPhone: string
    body: string
    source: string
  },
): Promise<boolean> {
  const line = await findActiveLandlordMainNumber(supabase, params.landlordId)
  const fromNumber = line?.phone_number?.trim() || ""
  if (!fromNumber) {
    console.warn("[intake-silence] no landlord SMS line", params.landlordId)
    return false
  }
  const sent = await sendInboundAutoReply(supabase, {
    conversationId: params.conversationId,
    landlordId: params.landlordId,
    fromNumber,
    toNumber: params.toPhone,
    body: params.body,
    provider: ((line?.provider as "twilio" | "telnyx") || "twilio"),
    source: params.source,
  })
  return sent.ok
}

export async function processIntakeSilenceFollowUps(
  supabase: SupabaseClient,
  opts?: {
    landlordId?: string | null
    conversationIds?: string[] | null
    dryRun?: boolean
    nowMs?: number
    thresholds?: IntakeSilenceThresholds
  },
): Promise<IntakeSilenceProcessSummary> {
  const nowMs = opts?.nowMs ?? Date.now()
  /** When set, forces every draft onto these thresholds (tests). Otherwise per-draft urgency. */
  const thresholdsOverride = opts?.thresholds ?? null
  const dryRun = opts?.dryRun === true
  const summary: IntakeSilenceProcessSummary = {
    scanned: 0,
    nudged: 0,
    resolved: 0,
    escalated: 0,
    skipped: 0,
    deferredQuietHours: 0,
    dryRun,
  }

  let query = supabase
    .from("sms_conversations")
    .select(
      "id, landlord_id, resident_id, external_phone_number, status, conversation_type, intake_state, maintenance_request_id, updated_at",
    )
    .in("status", ["intake_collecting", "open"])
    .order("updated_at", { ascending: false })
    .limit(400)

  if (opts?.landlordId?.trim()) {
    query = query.eq("landlord_id", opts.landlordId.trim())
  }
  if (opts?.conversationIds?.length) {
    query = query.in("id", opts.conversationIds)
  }

  const { data, error } = await query
  if (error) {
    console.error("[intake-silence] list conversations", error.message)
    return summary
  }

  for (const raw of data ?? []) {
    const row = raw as ConvRow
    const state = asState(row.intake_state)
    const step = String(state.step ?? "").toLowerCase()
    if (step === "submitted" || step === "awaiting_confirm") {
      summary.skipped += 1
      continue
    }
    if (!state.open_question_asked_at && !state.diagnostic_question && step !== "photo") {
      summary.skipped += 1
      continue
    }

    summary.scanned += 1
    const draftId = state.draft_ticket_id ?? row.maintenance_request_id ?? null
    const draftUrgency =
      state.urgency?.trim() || state.recommended_urgency?.trim()
        ? null
        : await loadDraftUrgency(supabase, draftId)
    const snapshot = snapshotFromConversation(row, draftUrgency)
    if (!snapshot.landlordId) {
      summary.skipped += 1
      continue
    }

    const decision = classifyIntakeSilenceFollowUp(
      snapshot,
      nowMs,
      thresholdsOverride,
    )
    if (decision.action === "skip") {
      summary.skipped += 1
      continue
    }

    const residentId = row.resident_id?.trim() || null
    const phone = row.external_phone_number?.trim() || null

    if (decision.action === "nudge") {
      if (!residentId || !phone) {
        summary.skipped += 1
        continue
      }
      const gate = await gateResidentAutomatedReminder(supabase, {
        landlordId: snapshot.landlordId,
        residentId,
        messageType: "intake_silence_nudge",
        recipientPhone: phone,
        ticketId: snapshot.draftTicketId,
        nowMs,
      })
      if (gate.decision.action === "hold_quiet_hours") {
        summary.deferredQuietHours += 1
        continue
      }
      if (gate.decision.action === "suppress") {
        summary.skipped += 1
        continue
      }
      if (dryRun) {
        summary.nudged += 1
        continue
      }
      const ok = await sendResidentSms(supabase, {
        conversationId: row.id,
        landlordId: snapshot.landlordId,
        toPhone: phone,
        body: decision.body,
        source: "intake_silence_nudge",
      })
      if (!ok) {
        summary.skipped += 1
        continue
      }
      const next: SmsIntakeState = {
        ...state,
        // Persist ask time before saveState bumps updated_at — otherwise the
        // updated_at fallback resets silence clocks and resolve never fires.
        open_question_asked_at:
          state.open_question_asked_at?.trim() ||
          snapshot.openQuestionAskedAt ||
          undefined,
        intake_silence_nudge_sent_at: new Date(nowMs).toISOString(),
      }
      await saveState(supabase, row.id, next)
      await recordActivityLog(supabase, {
        landlordId: snapshot.landlordId,
        eventType: "sms.intake_silence_nudge",
        source: "automation",
        actorType: "system",
        residentId,
        maintenanceRequestId: snapshot.draftTicketId,
        conversationId: row.id,
        workflowTemplateId: "maintenance_intake",
        metadata: {
          message: "Reminded the resident about an unanswered intake question.",
          question_type: decision.questionType,
        },
      })
      summary.nudged += 1
      continue
    }

    if (decision.action === "resolve_unit_entry_unconfirmed") {
      if (dryRun) {
        summary.resolved += 1
        continue
      }
      const facts = { ...(state.diagnostic_facts ?? {}), unit_entry: "not_sure" }
      const asked = [...(state.asked_question_types ?? [])]
      if (!asked.includes("unit_entry")) asked.push("unit_entry")
      const alertTier = decision.urgencyAlertTier as UrgencyAlertTier
      let next: SmsIntakeState = applyQuestionPlan({
        ...state,
        diagnostic_facts: facts,
        asked_question_types: asked,
        diagnostic_question: undefined,
        diagnostic_question_type: undefined,
        intake_silence_resolved_at: new Date(nowMs).toISOString(),
        open_question_asked_at: undefined,
        // Persist emergency tier so later paths see the same habitability band.
        urgency: state.urgency?.trim() || snapshot.urgency || undefined,
        recommended_urgency:
          state.recommended_urgency?.trim() || snapshot.urgency || undefined,
        urgency_alert_tier: state.urgency_alert_tier ?? alertTier,
      })

      if (!residentId) {
        await saveState(supabase, row.id, next)
        summary.escalated += 1
        continue
      }

      try {
        // Prefer auto-submit when the plan is ready; otherwise leave at next ask.
        if (next.step === "awaiting_confirm") {
          const { ticketId } = await submitSmsMaintenanceRequest(supabase, {
            landlordId: snapshot.landlordId,
            conversationId: row.id,
            residentId,
            intake: next,
          })
          next = {
            ...next,
            step: "submitted",
            draft_ticket_id: ticketId,
          }
          await saveState(supabase, row.id, next)
          if (phone) {
            const gate = await gateResidentAutomatedReminder(supabase, {
              landlordId: snapshot.landlordId,
              residentId,
              messageType: "intake_silence_nudge",
              recipientPhone: phone,
              ticketId,
              nowMs,
            })
            if (gate.decision.action === "send") {
              await sendResidentSms(supabase, {
                conversationId: row.id,
                landlordId: snapshot.landlordId,
                toPhone: phone,
                body: decision.body,
                source: "intake_silence_resolve",
              })
            } else if (gate.decision.action === "hold_quiet_hours") {
              summary.deferredQuietHours += 1
            }
          }

          if (decision.emergencyAlert) {
            // Distinct idempotency from first-message sms-emergency — silence
            // on a safety ask must not quietly skip the alert tier.
            void notifyLandlordNeedsAttention(supabase, {
              landlordId: snapshot.landlordId,
              kind: "workflow_escalated",
              headline:
                alertTier === "life_safety"
                  ? "Emergency intake stalled — entry permission unanswered"
                  : "Same-day intake stalled — entry permission unanswered",
              detail: (
                snapshot.description ||
                snapshot.issueHeadline ||
                "Urgent maintenance over text"
              )
                .trim()
                .slice(0, 200),
              idempotencyKey:
                `sms-emergency-intake-silence:${row.id}:${ticketId}:${alertTier}`,
              maintenanceRequestId: ticketId,
              residentId,
              whyLine:
                "The resident did not answer whether staff may enter if they are not home. The request was opened with entry unconfirmed.",
            })
            await recordActivityLog(supabase, {
              landlordId: snapshot.landlordId,
              eventType: "sms.emergency_alerted",
              source: "automation",
              actorType: "system",
              residentId,
              maintenanceRequestId: ticketId,
              conversationId: row.id,
              workflowTemplateId: "maintenance_intake",
              metadata: {
                message:
                  alertTier === "life_safety"
                    ? "Alerted the property team about an emergency intake that stalled on entry permission."
                    : "Alerted the property team about a same-day intake that stalled on entry permission.",
                leave_immediately: alertTier === "life_safety",
                resolution: "silence_unit_entry_unconfirmed",
                urgency_alert_tier: alertTier,
              },
            })
          }

          await recordActivityLog(supabase, {
            landlordId: snapshot.landlordId,
            eventType: "sms.intake_silence_resolved",
            source: "automation",
            actorType: "system",
            residentId,
            maintenanceRequestId: ticketId,
            conversationId: row.id,
            workflowTemplateId: "maintenance_intake",
            metadata: {
              message: decision.emergencyAlert
                ? "Opened the urgent request after entry permission went unanswered — property team alerted; entry marked unconfirmed."
                : "Opened the request after entry permission went unanswered — marked unconfirmed for the vendor.",
              unit_entry: "not_sure",
              resolution: decision.emergencyAlert
                ? "urgent_default_unconfirmed_submit"
                : "default_unconfirmed_submit",
              emergency_alert: decision.emergencyAlert,
            },
          })
          summary.resolved += 1
        } else {
          // Still more questions — stamp the next ask and SMS it.
          next = {
            ...next,
            open_question_asked_at: new Date(nowMs).toISOString(),
            intake_silence_nudge_sent_at: undefined,
          }
          await saveState(supabase, row.id, next)
          summary.resolved += 1
        }
      } catch (err) {
        console.error(
          "[intake-silence] unit_entry resolve failed",
          err instanceof Error ? err.message : String(err),
        )
        await saveState(supabase, row.id, next)
        summary.skipped += 1
      }
      continue
    }

    if (decision.action === "resolve_skip_photo") {
      if (dryRun) {
        summary.resolved += 1
        continue
      }
      let next = markQuestionAsked({ ...state }, "photo")
      next = applyQuestionPlan({
        ...next,
        intake_silence_resolved_at: new Date(nowMs).toISOString(),
        open_question_asked_at: undefined,
        intake_silence_nudge_sent_at: undefined,
      })
      if (next.step !== "awaiting_confirm" && next.diagnostic_question) {
        next = {
          ...next,
          open_question_asked_at: new Date(nowMs).toISOString(),
          intake_silence_resolved_at: undefined,
        }
      }
      await saveState(supabase, row.id, next)
      await recordActivityLog(supabase, {
        landlordId: snapshot.landlordId,
        eventType: "sms.intake_silence_resolved",
        source: "automation",
        actorType: "system",
        residentId,
        maintenanceRequestId: snapshot.draftTicketId,
        conversationId: row.id,
        workflowTemplateId: "maintenance_intake",
        metadata: {
          message: "Skipped the photo ask after silence and continued intake.",
          resolution: "skip_photo",
        },
      })
      summary.resolved += 1
      continue
    }

    if (decision.action === "escalate_landlord") {
      if (dryRun) {
        summary.escalated += 1
        continue
      }
      const next: SmsIntakeState = {
        ...state,
        intake_silence_resolved_at: new Date(nowMs).toISOString(),
      }
      await saveState(supabase, row.id, next)
      await recordActivityLog(supabase, {
        landlordId: snapshot.landlordId,
        eventType: "sms.intake_silence_escalated",
        source: "automation",
        actorType: "system",
        residentId,
        maintenanceRequestId: snapshot.draftTicketId,
        conversationId: row.id,
        workflowTemplateId: "maintenance_intake",
        metadata: {
          message:
            "Resident did not answer an intake question after a reminder — property team should follow up.",
          question_type: decision.questionType,
          reason: decision.reason,
        },
      })
      summary.escalated += 1
    }
  }

  return summary
}

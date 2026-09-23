/**
 * Landlord / ops reply APPROVE or DECLINE on an estimate notify thread
 * (or any conversation awaiting an estimate decision).
 *
 * Resolution order:
 * 1. Thread `awaiting_estimate_decision` (or numbered disambiguation reply)
 * 2. Account-level pending estimates for the phone-resolved landlord
 * 3. Status-specific reply when the estimate was already decided elsewhere
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { decideMaintenanceEstimate } from "../maintenanceEstimates.ts"
import { resolveLandlordIdForAccountOrOpsPhone } from "./landlordAccountPhone.ts"
import {
  listPendingEstimatesForLandlord,
  replyForEstimateTerminalStatus,
  sendLandlordEstimateDisambiguationSms,
  type PendingLandlordEstimate,
} from "./landlordEstimateNotify.ts"

export type EstimateDecisionKeyword = "approve" | "reject"

export function parseEstimateDecisionKeyword(
  body: string,
): EstimateDecisionKeyword | null {
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")

  if (!normalized) return null

  if (
    normalized === "APPROVE" ||
    normalized === "APPROVED" ||
    normalized === "YES APPROVE" ||
    normalized === "APPROVE ESTIMATE"
  ) {
    return "approve"
  }

  if (
    normalized === "DECLINE" ||
    normalized === "DECLINED" ||
    normalized === "REJECT" ||
    normalized === "REJECTED" ||
    normalized === "NO DECLINE" ||
    normalized === "DECLINE ESTIMATE"
  ) {
    return "reject"
  }

  return null
}

type AwaitingEstimateDecision = {
  estimateId: string
  actionToken?: string | null
  ticketId?: string | null
}

type DisambiguationOption = {
  estimateId: string
  actionToken: string
  ticketId: string
}

function readAwaitingEstimateDecision(
  intakeState: unknown,
): AwaitingEstimateDecision | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_estimate_decision
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const estimateId =
    (typeof row.estimate_id === "string" && row.estimate_id.trim()) ||
    (typeof row.estimateId === "string" && row.estimateId.trim()) ||
    ""
  if (!estimateId) return null
  const actionToken =
    (typeof row.action_token === "string" && row.action_token.trim()) ||
    (typeof row.actionToken === "string" && row.actionToken.trim()) ||
    null
  const ticketId =
    (typeof row.ticket_id === "string" && row.ticket_id.trim()) ||
    (typeof row.ticketId === "string" && row.ticketId.trim()) ||
    null
  return { estimateId, actionToken, ticketId }
}

function readAwaitingDisambiguation(
  intakeState: unknown,
): DisambiguationOption[] | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw =
    (intakeState as Record<string, unknown>).awaiting_estimate_disambiguation
  if (!raw || typeof raw !== "object") return null
  const options = (raw as Record<string, unknown>).options
  if (!Array.isArray(options) || options.length === 0) return null
  const out: DisambiguationOption[] = []
  for (const item of options) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const estimateId =
      (typeof row.estimate_id === "string" && row.estimate_id.trim()) ||
      (typeof row.estimateId === "string" && row.estimateId.trim()) ||
      ""
    const actionToken =
      (typeof row.action_token === "string" && row.action_token.trim()) ||
      (typeof row.actionToken === "string" && row.actionToken.trim()) ||
      ""
    const ticketId =
      (typeof row.ticket_id === "string" && row.ticket_id.trim()) ||
      (typeof row.ticketId === "string" && row.ticketId.trim()) ||
      ""
    if (!estimateId || !actionToken) continue
    out.push({ estimateId, actionToken, ticketId })
  }
  return out.length > 0 ? out : null
}

function parseDisambiguationIndex(body: string, optionCount: number): number | null {
  const trimmed = body.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 1 || n > optionCount) return null
  return n - 1
}

async function clearAwaitingEstimateDecision(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
): Promise<void> {
  const next = { ...priorIntake }
  delete next.awaiting_estimate_decision
  delete next.awaiting_estimate_disambiguation
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

export function canHandleEstimateDecisionInbound(input: {
  identityType: string
  conversationType?: string | null
  intakeState: unknown
  body?: string
}): boolean {
  if (input.identityType === "vendor") return false
  if (readAwaitingEstimateDecision(input.intakeState) != null) return true
  if (readAwaitingDisambiguation(input.intakeState) != null) {
    const opts = readAwaitingDisambiguation(input.intakeState)!
    if (
      input.body &&
      parseDisambiguationIndex(input.body, opts.length) != null
    ) {
      return true
    }
  }
  if (input.body && parseEstimateDecisionKeyword(input.body) != null) {
    return (
      input.identityType === "landlord" ||
      input.conversationType === "landlord_update"
    )
  }
  return (
    input.identityType === "landlord" ||
    input.conversationType === "landlord_update"
  )
}

async function loadEstimateStatus(
  supabase: SupabaseClient,
  estimateId: string,
  landlordId: string,
): Promise<{
  status: string
  actionToken: string | null
  ticketId: string | null
  landlordId: string
} | null> {
  const { data } = await supabase
    .from("maintenance_estimates")
    .select(
      "id, status, landlord_action_token, maintenance_request_id, landlord_id",
    )
    .eq("id", estimateId)
    .maybeSingle()
  if (!data?.id) return null
  const rowLandlord =
    typeof data.landlord_id === "string" ? data.landlord_id.trim() : ""
  if (rowLandlord && rowLandlord !== landlordId) return null
  return {
    status: String(data.status ?? ""),
    actionToken:
      typeof data.landlord_action_token === "string"
        ? data.landlord_action_token
        : null,
    ticketId:
      typeof data.maintenance_request_id === "string"
        ? data.maintenance_request_id
        : null,
    landlordId: rowLandlord || landlordId,
  }
}

async function applyDecision(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    priorIntake: Record<string, unknown>
    action: EstimateDecisionKeyword
    estimateId: string
    actionToken: string
    ticketId?: string | null
  },
): Promise<{
  handled: true
  action: EstimateDecisionKeyword
  estimateId: string
  status: "approved" | "rejected"
  already?: boolean
  replyBody: string
}> {
  const result = await decideMaintenanceEstimate(supabase, {
    estimateId: params.estimateId,
    actionToken: params.actionToken,
    action: params.action,
    source: "sms_inbound",
  })

  if (!result.ok) {
    const row = await loadEstimateStatus(
      supabase,
      params.estimateId,
      params.landlordId,
    )
    const terminal = row ? replyForEstimateTerminalStatus(row.status) : null
    console.error("[estimateDecisionInbound] decide failed", result.error)
    return {
      handled: true,
      action: params.action,
      estimateId: params.estimateId,
      status: params.action === "approve" ? "approved" : "rejected",
      replyBody:
        terminal ??
        "I couldn't update that estimate. Open the admin dashboard or use the approval link from the earlier text.",
    }
  }

  await clearAwaitingEstimateDecision(
    supabase,
    params.conversationId,
    params.priorIntake,
  )

  if (params.ticketId) {
    const { data: vendorThreads } = await supabase
      .from("sms_conversations")
      .select("id, intake_state")
      .eq("landlord_id", params.landlordId)
      .eq("maintenance_request_id", params.ticketId)
      .eq("conversation_type", "vendor_alert")
      .limit(5)
    for (const thread of vendorThreads ?? []) {
      const intake =
        thread.intake_state && typeof thread.intake_state === "object"
          ? (thread.intake_state as Record<string, unknown>)
          : {}
      if (intake.awaiting_estimate_decision) {
        await clearAwaitingEstimateDecision(
          supabase,
          thread.id as string,
          intake,
        )
      }
    }
  }

  const replyBody = result.already
    ? result.status === "approved"
      ? "This estimate was already approved. The vendor was notified."
      : "This estimate was already declined. The vendor was notified."
    : result.status === "approved"
      ? "Got it — estimate approved. The vendor can proceed with the work."
      : "Got it — estimate declined. The vendor has been notified."

  return {
    handled: true,
    action: params.action,
    estimateId: params.estimateId,
    status: result.status,
    already: result.already,
    replyBody,
  }
}

export async function tryHandleEstimateDecisionInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    identityType: string
    fromPhone?: string | null
  },
): Promise<
  | {
      handled: true
      action: EstimateDecisionKeyword
      estimateId: string
      status: "approved" | "rejected"
      already?: boolean
      replyBody: string
    }
  | { handled: false }
> {
  // Real vendor threads must not approve estimates by SMS.
  if (params.identityType === "vendor") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, maintenance_request_id, conversation_type")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!conv?.id) return { handled: false }

  const priorIntake =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}

  const disambiguation = readAwaitingDisambiguation(priorIntake)
  if (disambiguation) {
    const idx = parseDisambiguationIndex(params.body, disambiguation.length)
    if (idx != null) {
      const chosen = disambiguation[idx]!
      const actionFromState = (() => {
        const raw = priorIntake.awaiting_estimate_disambiguation
        if (!raw || typeof raw !== "object") return null
        const a = (raw as Record<string, unknown>).action
        if (a === "approve" || a === "reject") return a as EstimateDecisionKeyword
        return null
      })()
      const action =
        actionFromState ?? parseEstimateDecisionKeyword(params.body)
      if (!action) {
        return {
          handled: true,
          action: "approve",
          estimateId: chosen.estimateId,
          status: "approved",
          replyBody:
            "Reply APPROVE or DECLINE after picking a number, or send the number again with APPROVE / DECLINE.",
        }
      }
      return await applyDecision(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        priorIntake,
        action,
        estimateId: chosen.estimateId,
        actionToken: chosen.actionToken,
        ticketId: chosen.ticketId,
      })
    }
  }

  const action = parseEstimateDecisionKeyword(params.body)
  if (!action) return { handled: false }

  // Resolve landlord via the same account/ops phone helper used elsewhere.
  let landlordId = params.landlordId
  if (params.fromPhone?.trim()) {
    const phoneLandlordId = await resolveLandlordIdForAccountOrOpsPhone(
      supabase,
      params.fromPhone.trim(),
      { landlordIds: [params.landlordId] },
    )
    if (phoneLandlordId && phoneLandlordId !== params.landlordId) {
      return {
        handled: true,
        action,
        estimateId: "",
        status: action === "approve" ? "approved" : "rejected",
        replyBody:
          "I couldn't match this phone to one property account with confidence. Please approve from the link in your email or the admin dashboard.",
      }
    }
    // Broader resolve when scoped match is null — still refuse ambiguity.
    if (!phoneLandlordId) {
      const broad = await resolveLandlordIdForAccountOrOpsPhone(
        supabase,
        params.fromPhone.trim(),
      )
      if (broad && broad !== params.landlordId) {
        return {
          handled: true,
          action,
          estimateId: "",
          status: action === "approve" ? "approved" : "rejected",
          replyBody:
            "I couldn't match this phone to one property account with confidence. Please approve from the link in your email or the admin dashboard.",
        }
      }
      if (broad) landlordId = broad
    } else {
      landlordId = phoneLandlordId
    }
  }

  let awaiting = readAwaitingEstimateDecision(priorIntake)

  // Mislabeled resident on resident_intake: only honor an explicit pending ask.
  if (params.identityType === "resident" && !awaiting && !disambiguation) {
    return { handled: false }
  }

  const isLandlordThread =
    conv.conversation_type === "landlord_update" ||
    params.identityType === "landlord" ||
    awaiting != null

  if (!isLandlordThread) {
    return { handled: false }
  }

  // Thread WO fallback when awaiting flag missing but ticket is on the conversation.
  if (!awaiting) {
    const ticketId =
      typeof conv.maintenance_request_id === "string"
        ? conv.maintenance_request_id
        : null
    if (ticketId) {
      const { data: pending } = await supabase
        .from("maintenance_estimates")
        .select("id, landlord_action_token, status, landlord_id")
        .eq("maintenance_request_id", ticketId)
        .eq("landlord_id", landlordId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (pending?.id && pending.status === "pending_approval") {
        awaiting = {
          estimateId: pending.id as string,
          actionToken:
            typeof pending.landlord_action_token === "string"
              ? pending.landlord_action_token
              : null,
          ticketId,
        }
      } else if (pending?.id && typeof pending.status === "string") {
        const terminal = replyForEstimateTerminalStatus(String(pending.status))
        if (terminal) {
          return {
            handled: true,
            action,
            estimateId: pending.id as string,
            status: action === "approve" ? "approved" : "rejected",
            already: true,
            replyBody: terminal,
          }
        }
      }
    }
  }

  // Account-level pending lookup when thread has no pending state.
  if (!awaiting) {
    const pending = await listPendingEstimatesForLandlord(supabase, landlordId)
    if (pending.length === 1) {
      const only = pending[0]!
      awaiting = {
        estimateId: only.estimateId,
        actionToken: only.actionToken,
        ticketId: only.ticketId,
      }
    } else if (pending.length > 1) {
      await supabase
        .from("sms_conversations")
        .update({
          updated_at: new Date().toISOString(),
          intake_state: {
            ...priorIntake,
            awaiting_estimate_disambiguation: {
              action,
              options: pending.map((o) => ({
                estimate_id: o.estimateId,
                action_token: o.actionToken,
                ticket_id: o.ticketId,
              })),
            },
          },
        })
        .eq("id", params.conversationId)

      const { sent, body } = await sendLandlordEstimateDisambiguationSms(
        supabase,
        {
          landlordId,
          conversationId: params.conversationId,
          options: pending,
        },
      )
      return {
        handled: true,
        action,
        estimateId: pending[0]!.estimateId,
        status: action === "approve" ? "approved" : "rejected",
        replyBody: sent
          ? body
          : `${body}\n\n(We couldn't deliver that text reliably — reply with the number anyway, or use the approval link in your email.)`,
      }
    } else {
      // No pending — check latest decided estimate for a status-specific reply.
      const { data: latest } = await supabase
        .from("maintenance_estimates")
        .select("id, status")
        .eq("landlord_id", landlordId)
        .in("status", ["approved", "rejected", "superseded", "expired", "withdrawn"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest?.id) {
        const terminal = replyForEstimateTerminalStatus(String(latest.status))
        if (terminal) {
          return {
            handled: true,
            action,
            estimateId: latest.id as string,
            status: action === "approve" ? "approved" : "rejected",
            already: true,
            replyBody: terminal,
          }
        }
      }
      return { handled: false }
    }
  }

  // Thread had awaiting — if already terminal, say so.
  const current = await loadEstimateStatus(
    supabase,
    awaiting.estimateId,
    landlordId,
  )
  if (!current) {
    return {
      handled: true,
      action,
      estimateId: awaiting.estimateId,
      status: action === "approve" ? "approved" : "rejected",
      replyBody:
        "I couldn't find that estimate on this account. Open the admin dashboard or use the approval link from the earlier text.",
    }
  }
  if (current.status !== "pending_approval") {
    const terminal = replyForEstimateTerminalStatus(current.status)
    await clearAwaitingEstimateDecision(
      supabase,
      params.conversationId,
      priorIntake,
    )
    return {
      handled: true,
      action,
      estimateId: awaiting.estimateId,
      status: action === "approve" ? "approved" : "rejected",
      already: true,
      replyBody:
        terminal ??
        "That estimate is no longer waiting for a decision. Open the dashboard if you need details.",
    }
  }

  let actionToken = awaiting.actionToken?.trim() || current.actionToken || ""
  if (!actionToken) {
    return { handled: false }
  }

  return await applyDecision(supabase, {
    landlordId,
    conversationId: params.conversationId,
    priorIntake,
    action,
    estimateId: awaiting.estimateId,
    actionToken,
    ticketId: awaiting.ticketId ?? current.ticketId,
  })
}

/** Test helper — exposed for unit coverage of account-level selection. */
export function pickPendingEstimateForApprove(
  pending: PendingLandlordEstimate[],
):
  | { kind: "one"; estimate: PendingLandlordEstimate }
  | { kind: "many"; estimates: PendingLandlordEstimate[] }
  | { kind: "none" } {
  if (pending.length === 1) return { kind: "one", estimate: pending[0]! }
  if (pending.length > 1) return { kind: "many", estimates: pending }
  return { kind: "none" }
}

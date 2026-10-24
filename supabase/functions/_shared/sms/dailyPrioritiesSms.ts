/**
 * SMS adapter for Ask Ulo daily priorities — same ranking / auth / action
 * bindings as chat; transport-only differences.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isDailyPrioritiesQuestion } from "../ask_ulo/tools/ops/dailyPrioritiesDetect.ts"
import { lookupDailyPriorities } from "../ask_ulo/tools/ops/dailyPrioritiesLookup.ts"
import {
  loadOpenDailyPrioritiesList,
  markDailyPriorityItemExecuted,
  persistDailyPrioritiesList,
  recheckDailyPriorityAction,
  resolveDailyPriorityReply,
} from "../ask_ulo/tools/ops/dailyPrioritiesActions.ts"
import {
  dailyPrioritySelectionMessage,
  resolveDailyPriorityReplyToken,
  type DailyPriorityActorRole,
} from "../ask_ulo/tools/ops/dailyPriorities.ts"

export { isDailyPrioritiesQuestion }

/** Resolve Ask Ulo actor role from SMS identity (fail closed). */
export function dailyPrioritiesRoleFromIdentity(identityType: string | null | undefined): {
  role: DailyPriorityActorRole | "unresolved"
  isLandlordThread: boolean
} {
  const t = (identityType ?? "").trim().toLowerCase()
  if (t === "landlord") return { role: "landlord", isLandlordThread: true }
  if (t === "resident") return { role: "tenant", isLandlordThread: false }
  return { role: "unresolved", isLandlordThread: false }
}

/** Pure gate: free-text daily-priorities ask (landlord or resident). */
export function canHandleDailyPrioritiesAsk(input: {
  body: string
  identityType: string | null | undefined
}): boolean {
  const { role } = dailyPrioritiesRoleFromIdentity(input.identityType)
  if (role === "unresolved") return false
  return isDailyPrioritiesQuestion(input.body)
}

/**
 * Pure gate for reply binding: body looks like a list reply token shape.
 * Full match still requires an open persisted list (checked in try*).
 */
export function canAttemptDailyPrioritiesReply(body: string): boolean {
  const raw = body.trim()
  if (!raw) return false
  return /^(\d+)\s*(YES|APPROVE|OK)?\s*[.)]?$/i.test(raw)
}

export async function answerDailyPrioritiesSms(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    role: DailyPriorityActorRole | "unresolved"
    residentId?: string | null
    userId?: string | null
    conversationId?: string | null
    timeZone?: string | null
    now?: Date
    buildingFilter?: string | null
  },
): Promise<{ text: string; listId: string | null; readOnly: true }> {
  const result = await lookupDailyPriorities(supabase, {
    landlordId: input.landlordId,
    role: input.role,
    residentId: input.residentId ?? null,
    buildingFilter: input.buildingFilter ?? null,
    now: input.now,
    timeZone: input.timeZone ?? null,
  })
  // Briefing is read-only — never assign/approve merely because it was requested.
  let listId: string | null = null
  if (result.items.length > 0 && input.role !== "unresolved") {
    const persisted = await persistDailyPrioritiesList(supabase, {
      landlordId: input.landlordId,
      role: input.role,
      actorUserId: input.userId ?? null,
      actorResidentId: input.residentId ?? null,
      conversationId: input.conversationId ?? null,
      channel: "sms",
      timeZone: input.timeZone ?? "America/New_York",
      result,
    })
    listId = persisted?.listId ?? null
  }
  return { text: result.smsText, listId, readOnly: true }
}

export async function tryHandleDailyPrioritiesAskSms(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    identityType: string | null | undefined
    residentId?: string | null
    userId?: string | null
    conversationId?: string | null
    body: string
    timeZone?: string | null
  },
): Promise<{ handled: false } | { handled: true; replyBody: string; listId: string | null }> {
  if (
    !canHandleDailyPrioritiesAsk({
      body: input.body,
      identityType: input.identityType,
    })
  ) {
    return { handled: false }
  }
  const { role } = dailyPrioritiesRoleFromIdentity(input.identityType)
  const answered = await answerDailyPrioritiesSms(supabase, {
    landlordId: input.landlordId,
    role,
    residentId: input.residentId ?? null,
    userId: input.userId ?? null,
    conversationId: input.conversationId ?? null,
    timeZone: input.timeZone ?? null,
  })
  return { handled: true, replyBody: answered.text, listId: answered.listId }
}

export async function tryHandleDailyPrioritiesReplySms(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    conversationId?: string | null
    body: string
    role: DailyPriorityActorRole | "unresolved"
    residentId?: string | null
  },
): Promise<DailyPriorityReplyHandleResult> {
  return tryHandleDailyPrioritiesReply(supabase, { ...input, channel: "sms" })
}

export type DailyPriorityReplyHandleResult =
  | { handled: false }
  | {
    handled: true
    ok: boolean
    message: string
    itemEntityId?: string
    offeredAction?: string
    alreadyExecuted?: boolean
  }

/**
 * Select one item from the open priorities list for this channel.
 * Selection does not assign a vendor or approve an estimate.
 */
export async function tryHandleDailyPrioritiesReply(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    conversationId?: string | null
    body: string
    role: DailyPriorityActorRole | "unresolved"
    residentId?: string | null
    channel: "sms" | "chat"
  },
): Promise<DailyPriorityReplyHandleResult> {
  if (!canAttemptDailyPrioritiesReply(input.body)) {
    return { handled: false }
  }

  // Pending gate: open list must exist and token must match offered bindings.
  const open = await loadOpenDailyPrioritiesList(supabase, {
    landlordId: input.landlordId,
    conversationId: input.conversationId,
    channel: input.channel,
  })
  if (!open) return { handled: false }
  const tokenMatch = resolveDailyPriorityReplyToken(input.body, open.items)
  if (!tokenMatch.ok) return { handled: false }

  const resolved = await resolveDailyPriorityReply(supabase, {
    landlordId: input.landlordId,
    conversationId: input.conversationId,
    channel: input.channel,
    body: input.body,
    role: input.role,
    residentId: input.residentId,
  })
  if (!resolved.ok) {
    if (resolved.reason === "no_open_list" || resolved.reason === "no_match") {
      return { handled: false }
    }
    return {
      handled: true,
      ok: false,
      message:
        resolved.reason === "unauthorized"
          ? "That action isn't available on this account."
          : "That reply doesn't match the priorities list I sent. Reply with the number shown, or ask again.",
    }
  }

  if (resolved.alreadyExecuted) {
    return {
      handled: true,
      ok: true,
      alreadyExecuted: true,
      message: dailyPrioritySelectionMessage(resolved.item, true),
      itemEntityId: resolved.item.entityId,
      offeredAction: resolved.item.offeredAction,
    }
  }

  if (input.role === "tenant") {
    return {
      handled: true,
      ok: false,
      message: "I can show your requests, but I can't approve or assign work from here.",
    }
  }

  const check = await recheckDailyPriorityAction(
    supabase,
    resolved.item,
    input.role === "unresolved" ? "landlord" : input.role,
  )
  if (!check.ok) {
    return {
      handled: true,
      ok: false,
      message:
        check.reason === "location_required"
          ? `I didn't book anyone for ${resolved.item.title}. I still need the correct address before a vendor can be booked.`
          : check.reason === "stale"
          ? `That item changed since I sent the list. Ask for today's priorities again. Nothing was assigned or approved.`
          : "I couldn't select that item right now. Nothing was assigned or approved.",
      itemEntityId: resolved.item.entityId,
      offeredAction: resolved.item.offeredAction,
    }
  }

  // Mark executed for idempotency. Actual assign/approve still goes through
  // existing confirmation paths (never bypass pest / location gates here).
  const marked = await markDailyPriorityItemExecuted(supabase, {
    listId: resolved.listId,
    position: resolved.item.position,
  })

  if (!marked.ok) {
    return {
      handled: true,
      ok: false,
      message: "I couldn't select that item right now. Nothing was assigned or approved.",
      itemEntityId: resolved.item.entityId,
      offeredAction: resolved.item.offeredAction,
    }
  }

  return {
    handled: true,
    ok: true,
    message: dailyPrioritySelectionMessage(resolved.item, marked.alreadyExecuted),
    itemEntityId: resolved.item.entityId,
    offeredAction: resolved.item.offeredAction,
    alreadyExecuted: marked.alreadyExecuted,
  }
}

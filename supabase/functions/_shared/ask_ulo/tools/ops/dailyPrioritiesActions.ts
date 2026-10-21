/**
 * Persist outbound daily-priority lists and bind follow-up replies to the
 * originally offered items (never re-rank then apply "1").
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  resolveDailyPriorityReplyToken,
  type DailyPriorityActorRole,
  type DailyPriorityListItem,
  type DailyPrioritiesResult,
} from "./dailyPriorities.ts"

export type PersistDailyPrioritiesListInput = {
  landlordId: string
  role: DailyPriorityActorRole
  actorUserId?: string | null
  actorResidentId?: string | null
  conversationId?: string | null
  channel: "sms" | "chat"
  timeZone: string
  result: DailyPrioritiesResult
  /** Validity window for reply binding (default 24h). */
  ttlMs?: number
}

export type PersistedDailyPrioritiesList = {
  listId: string
  items: DailyPriorityListItem[]
}

export async function persistDailyPrioritiesList(
  supabase: SupabaseClient,
  input: PersistDailyPrioritiesListInput,
): Promise<PersistedDailyPrioritiesList | null> {
  if (input.result.items.length === 0) return null
  const landlordId = input.landlordId.trim()
  if (!landlordId) return null

  const now = Date.now()
  const expiresAt = new Date(now + (input.ttlMs ?? 24 * 3600_000)).toISOString()

  // Supersede prior open lists for same conversation/channel/actor.
  if (input.conversationId?.trim()) {
    await supabase
      .from("ask_ulo_priority_lists")
      .update({ status: "superseded", superseded_at: new Date().toISOString() })
      .eq("landlord_id", landlordId)
      .eq("conversation_id", input.conversationId.trim())
      .eq("channel", input.channel)
      .eq("status", "open")
  }

  const { data: listRow, error: listErr } = await supabase
    .from("ask_ulo_priority_lists")
    .insert({
      landlord_id: landlordId,
      actor_role: input.role,
      actor_user_id: input.actorUserId?.trim() || null,
      actor_resident_id: input.actorResidentId?.trim() || null,
      conversation_id: input.conversationId?.trim() || null,
      channel: input.channel,
      time_zone: input.timeZone,
      expires_at: expiresAt,
      status: "open",
      partial_sources: input.result.partialSources,
    })
    .select("id")
    .maybeSingle()

  if (listErr || !listRow?.id) {
    console.error("[dailyPriorities] persist list", listErr?.message)
    return null
  }

  const listId = String(listRow.id)
  const itemRows = input.result.items.map((item) => ({
    list_id: listId,
    position: item.position,
    category: item.category,
    entity_type: item.entityType,
    entity_id: item.entityId,
    display_id: item.displayId,
    offered_action: item.offeredAction,
    reply_token: item.replyToken,
    snapshot: item,
  }))

  const { error: itemErr } = await supabase
    .from("ask_ulo_priority_list_items")
    .insert(itemRows)
  if (itemErr) {
    console.error("[dailyPriorities] persist items", itemErr.message)
    return null
  }

  return { listId, items: input.result.items }
}

export type LoadOpenDailyPrioritiesListResult = {
  listId: string
  landlordId: string
  role: DailyPriorityActorRole
  actorResidentId: string | null
  expiresAt: string
  items: DailyPriorityListItem[]
}

export async function loadOpenDailyPrioritiesList(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    conversationId?: string | null
    channel?: "sms" | "chat"
    recipientPhone?: string | null
  },
): Promise<LoadOpenDailyPrioritiesListResult | null> {
  const landlordId = input.landlordId.trim()
  if (!landlordId) return null

  let q = supabase
    .from("ask_ulo_priority_lists")
    .select(
      "id, landlord_id, actor_role, actor_resident_id, expires_at, status, conversation_id, channel",
    )
    .eq("landlord_id", landlordId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
  if (input.conversationId?.trim()) {
    q = q.eq("conversation_id", input.conversationId.trim())
  }
  if (input.channel) q = q.eq("channel", input.channel)

  const { data: list, error } = await q.maybeSingle()
  if (error || !list) return null

  const expiresAt = typeof list.expires_at === "string" ? list.expires_at : ""
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    await supabase
      .from("ask_ulo_priority_lists")
      .update({ status: "closed" })
      .eq("id", list.id)
    return null
  }

  const { data: items, error: itemErr } = await supabase
    .from("ask_ulo_priority_list_items")
    .select("position, snapshot, executed_at, offered_action, reply_token, entity_id")
    .eq("list_id", list.id)
    .order("position", { ascending: true })
  if (itemErr || !items) return null

  const mapped: DailyPriorityListItem[] = []
  for (const row of items) {
    const snap = row.snapshot as DailyPriorityListItem | null
    if (snap && typeof snap.position === "number") {
      mapped.push(snap)
    }
  }
  if (mapped.length === 0) return null

  return {
    listId: String(list.id),
    landlordId,
    role: (list.actor_role === "tenant" ? "tenant" : "landlord") as DailyPriorityActorRole,
    actorResidentId:
      typeof list.actor_resident_id === "string" ? list.actor_resident_id : null,
    expiresAt,
    items: mapped,
  }
}

export type DailyPriorityReplyResolution =
  | {
    ok: true
    listId: string
    item: DailyPriorityListItem
    alreadyExecuted: boolean
  }
  | {
    ok: false
    reason:
      | "no_open_list"
      | "no_match"
      | "ambiguous"
      | "unauthorized"
      | "expired"
  }

/**
 * Bind a reply to the persisted list. Does not mutate operational state —
 * callers recheck prerequisites then call markDailyPriorityItemExecuted.
 */
export async function resolveDailyPriorityReply(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    conversationId?: string | null
    channel?: "sms" | "chat"
    body: string
    role: DailyPriorityActorRole | "unresolved"
    residentId?: string | null
  },
): Promise<DailyPriorityReplyResolution> {
  if (input.role === "unresolved") {
    return { ok: false, reason: "unauthorized" }
  }

  const open = await loadOpenDailyPrioritiesList(supabase, {
    landlordId: input.landlordId,
    conversationId: input.conversationId,
    channel: input.channel,
  })
  if (!open) return { ok: false, reason: "no_open_list" }

  if (input.role === "tenant") {
    if (
      open.role !== "tenant" ||
      !input.residentId?.trim() ||
      open.actorResidentId !== input.residentId.trim()
    ) {
      return { ok: false, reason: "unauthorized" }
    }
  }

  const bound = resolveDailyPriorityReplyToken(input.body, open.items)
  if (!bound.ok) return { ok: false, reason: bound.reason }

  const { data: row } = await supabase
    .from("ask_ulo_priority_list_items")
    .select("executed_at")
    .eq("list_id", open.listId)
    .eq("position", bound.item.position)
    .maybeSingle()

  return {
    ok: true,
    listId: open.listId,
    item: bound.item,
    alreadyExecuted: Boolean(row?.executed_at),
  }
}

export async function markDailyPriorityItemExecuted(
  supabase: SupabaseClient,
  input: { listId: string; position: number },
): Promise<{ ok: boolean; alreadyExecuted: boolean }> {
  const { data: existing } = await supabase
    .from("ask_ulo_priority_list_items")
    .select("executed_at")
    .eq("list_id", input.listId)
    .eq("position", input.position)
    .maybeSingle()
  if (existing?.executed_at) {
    return { ok: true, alreadyExecuted: true }
  }
  const { error } = await supabase
    .from("ask_ulo_priority_list_items")
    .update({ executed_at: new Date().toISOString() })
    .eq("list_id", input.listId)
    .eq("position", input.position)
    .is("executed_at", null)
  if (error) {
    console.error("[dailyPriorities] mark executed", error.message)
    return { ok: false, alreadyExecuted: false }
  }
  return { ok: true, alreadyExecuted: false }
}

/**
 * Recheck whether the offered action is still valid before mutation.
 * Briefing itself is read-only — execution only happens on an explicit reply.
 */
export async function recheckDailyPriorityAction(
  supabase: SupabaseClient,
  item: DailyPriorityListItem,
  role: DailyPriorityActorRole,
): Promise<
  | { ok: true }
  | { ok: false; reason: "stale" | "unauthorized" | "missing" | "location_required" }
> {
  if (role === "tenant" && item.offeredAction !== "none") {
    // Tenants never inherit landlord assign/approve powers from a shared list.
    if (item.offeredAction === "assign" || item.offeredAction === "approve") {
      return { ok: false, reason: "unauthorized" }
    }
  }

  if (item.offeredAction === "confirm_location") {
    return { ok: false, reason: "location_required" }
  }

  if (
    item.entityType === "maintenance_request" ||
    item.entityType === "estimate" ||
    item.entityType === "appointment"
  ) {
    const { data, error } = await supabase
      .from("maintenance_requests")
      .select("id, vendor_work_status, spend_status, property_id, unit_id")
      .eq("id", item.entityId)
      .maybeSingle()
    if (error || !data) return { ok: false, reason: "missing" }
    const status = String(data.vendor_work_status ?? "")
    if (item.offeredAction === "assign") {
      if (status !== "unassigned") return { ok: false, reason: "stale" }
      if (!data.property_id && !data.unit_id) {
        return { ok: false, reason: "location_required" }
      }
    }
    if (item.offeredAction === "approve") {
      const spend = String(data.spend_status ?? "")
      if (spend === "approved" || status === "cancelled") {
        return { ok: false, reason: "stale" }
      }
    }
  }

  return { ok: true }
}

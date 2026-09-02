/**
 * Thumbtack demand Messages / Requests API — Edge only (never call from the browser).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import {
  thumbtackOpenConversationError,
  thumbtackProviderFromEnv,
  type ThumbtackExternalVendorProvider,
} from "./providers/thumbtack.ts"
import {
  pickMessageId,
  pickNegotiationId,
  pickRequestId,
  type ThumbtackWebhookInbound,
} from "./thumbtackMessageParse.ts"
import { mapThumbtackThreadRow, type ThumbtackVendorThreadRow } from "./thumbtackThreadTypes.ts"

export type { ThumbtackWebhookInbound } from "./thumbtackMessageParse.ts"
export {
  isThumbtackMessageCreatedEvent,
  parseThumbtackWebhookInbound,
  pickMessageId,
  pickNegotiationId,
  pickRequestId,
  pickThumbtackId,
} from "./thumbtackMessageParse.ts"
export { listThumbtackThreadsForTicket } from "./thumbtackThreads.ts"
export type { ThumbtackThreadStatus, ThumbtackVendorThreadRow } from "./thumbtackThreadTypes.ts"

const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Ulo/1.0 (https://ulohome.io; Thumbtack demand partner)",
} as const

export type ThumbtackSendMessageInput = {
  ticketId: string
  landlordId: string
  businessId: string
  vendorName: string
  searchId?: string | null
  categoryId?: string | null
  text: string
  propertyId?: string | null
  unitId?: string | null
}

export type ThumbtackSendMessageResult =
  | { ok: true; thread: ThumbtackVendorThreadRow }
  | { ok: false; error: string; httpStatus?: number }

async function thumbtackFetch(
  provider: ThumbtackExternalVendorProvider,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const token = await provider.getMessagingAccessToken()
  if (!token) {
    return { ok: false, status: 401, json: null, text: "oauth_token_failed" }
  }
  const url = `${provider.apiBase()}${path.startsWith("/") ? path : `/${path}`}`
  const res = await fetch(url, {
    method: init.method,
    headers: {
      ...FETCH_HEADERS,
      Authorization: `Bearer ${token}`,
      ...(init.body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text().catch(() => "")
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function createThumbtackRequest(input: {
  provider: ThumbtackExternalVendorProvider
  searchId: string
  businessId: string
  categoryId: string | null
}): Promise<{ requestId: string | null; negotiationId: string | null; error?: string; status?: number }> {
  const body: Record<string, unknown> = {
    searchID: input.searchId,
    businessIDs: [input.businessId],
    utmData: { utm_source: input.provider.partnerUtmSource() },
  }
  if (input.categoryId) body.categoryID = input.categoryId
  const res = await thumbtackFetch(input.provider, "/v4/requests", {
    method: "POST",
    body,
  })
  if (!res.ok) {
    console.warn("[thumbtack-messages] create request HTTP", res.status, res.text.slice(0, 240))
    return {
      requestId: null,
      negotiationId: null,
      error: thumbtackOpenConversationError(res.status, res.text),
      status: res.status,
    }
  }
  return {
    requestId: pickRequestId(res.json),
    negotiationId: pickNegotiationId(res.json),
  }
}

async function loadNegotiationForBusiness(input: {
  provider: ThumbtackExternalVendorProvider
  businessId: string
}): Promise<string | null> {
  const res = await thumbtackFetch(
    input.provider,
    `/v4/businesses/${encodeURIComponent(input.businessId)}/negotiations`,
    { method: "GET" },
  )
  if (!res.ok) {
    console.warn("[thumbtack-messages] list negotiations HTTP", res.status, res.text.slice(0, 200))
    return null
  }
  return pickNegotiationId(res.json)
}

async function postNegotiationMessage(input: {
  provider: ThumbtackExternalVendorProvider
  negotiationId: string
  text: string
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string; status: number }> {
  const res = await thumbtackFetch(
    input.provider,
    `/v4/negotiations/${encodeURIComponent(input.negotiationId)}/messages`,
    { method: "POST", body: { text: input.text } },
  )
  if (!res.ok) {
    console.warn("[thumbtack-messages] send message HTTP", res.status, res.text.slice(0, 240))
    return {
      ok: false,
      error: thumbtackOpenConversationError(res.status, res.text),
      status: res.status,
    }
  }
  return { ok: true, messageId: pickMessageId(res.json) }
}

export async function sendThumbtackVendorMessage(
  supabase: SupabaseClient,
  input: ThumbtackSendMessageInput,
): Promise<ThumbtackSendMessageResult> {
  const text = input.text.trim()
  if (!text) return { ok: false, error: "Enter a message before sending." }
  const businessId = input.businessId.trim()
  if (!businessId) {
    return { ok: false, error: "This listing is missing a Thumbtack business id." }
  }

  const provider = thumbtackProviderFromEnv()
  if (!provider.isConfigured()) {
    return { ok: false, error: "Thumbtack is not configured on the server." }
  }

  const existing = await supabase
    .from("thumbtack_vendor_threads")
    .select("*")
    .eq("ticket_id", input.ticketId)
    .eq("business_id", businessId)
    .maybeSingle()

  let thread = existing.data ? mapThumbtackThreadRow(existing.data as Record<string, unknown>) : null
  let negotiationId = thread?.negotiation_id?.trim() || null
  let requestId = thread?.request_id?.trim() || null
  const searchId = input.searchId?.trim() || thread?.search_id?.trim() || ""
  const categoryId = input.categoryId?.trim() || thread?.category_id?.trim() || null

  if (!negotiationId) {
    if (searchId) {
      const created = await createThumbtackRequest({
        provider,
        searchId,
        businessId,
        categoryId,
      })
      if (created.error && !created.negotiationId) {
        const fallback = await loadNegotiationForBusiness({ provider, businessId })
        if (!fallback) {
          return { ok: false, error: created.error, httpStatus: created.status }
        }
        negotiationId = fallback
      } else {
        negotiationId = created.negotiationId
        requestId = created.requestId ?? requestId
      }
    }
    if (!negotiationId) {
      negotiationId = await loadNegotiationForBusiness({ provider, businessId })
    }
    if (!negotiationId) {
      return {
        ok: false,
        error:
          "Thumbtack did not return a conversation for this pro. Search again, then try Message Vendor.",
      }
    }
  }

  const sent = await postNegotiationMessage({ provider, negotiationId, text })
  if (!sent.ok) {
    return { ok: false, error: sent.error, httpStatus: sent.status }
  }

  const now = new Date().toISOString()
  const upsert = {
    ticket_id: input.ticketId,
    landlord_id: input.landlordId,
    business_id: businessId,
    vendor_name: input.vendorName.trim() || "Vendor",
    search_id: searchId || null,
    category_id: categoryId,
    request_id: requestId,
    negotiation_id: negotiationId,
    status: "awaiting_response" as const,
    last_outbound_text: text,
    last_outbound_at: now,
    updated_at: now,
  }

  const saved = await supabase
    .from("thumbtack_vendor_threads")
    .upsert(upsert, { onConflict: "ticket_id,business_id" })
    .select("*")
    .maybeSingle()

  if (saved.error || !saved.data) {
    console.warn("[thumbtack-messages] upsert thread", saved.error)
    return { ok: false, error: "Message sent on Thumbtack, but Ulo could not save the thread." }
  }
  thread = mapThumbtackThreadRow(saved.data as Record<string, unknown>)

  await supabase.from("thumbtack_vendor_messages").insert({
    thread_id: thread.id,
    direction: "outbound",
    body: text,
    thumbtack_message_id: sent.messageId,
  })

  void recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: "vendor.thumbtack_message_sent",
    source: "dashboard",
    actorType: "landlord",
    maintenanceRequestId: input.ticketId,
    propertyId: input.propertyId,
    unitId: input.unitId,
    metadata: {
      message: `Messaged ${thread.vendor_name} on Thumbtack. Waiting for a reply.`,
      vendorName: thread.vendor_name,
    },
  })

  return { ok: true, thread }
}

export async function applyThumbtackInboundMessage(
  supabase: SupabaseClient,
  inbound: ThumbtackWebhookInbound,
): Promise<{ applied: boolean; reason?: string }> {
  if (!inbound.fromPro) return { applied: false, reason: "not_from_pro" }
  const text = inbound.text?.trim() ?? ""
  if (!text) return { applied: false, reason: "empty" }

  let query = supabase.from("thumbtack_vendor_threads").select("*")
  if (inbound.negotiationId) {
    query = query.eq("negotiation_id", inbound.negotiationId)
  } else if (inbound.businessId) {
    query = query.eq("business_id", inbound.businessId).order("updated_at", { ascending: false })
  } else {
    return { applied: false, reason: "missing_ids" }
  }

  const { data, error } = await query.limit(1)
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) {
    return { applied: false, reason: "thread_not_found" }
  }
  const thread = mapThumbtackThreadRow(row as Record<string, unknown>)
  const now = new Date().toISOString()

  await supabase
    .from("thumbtack_vendor_threads")
    .update({
      status: "vendor_replied",
      last_inbound_text: text,
      last_inbound_at: now,
      updated_at: now,
    })
    .eq("id", thread.id)

  const inboundInsert = await supabase.from("thumbtack_vendor_messages").insert({
    thread_id: thread.id,
    direction: "inbound",
    body: text,
    thumbtack_message_id: inbound.messageId,
  })
  if (inboundInsert.error) {
    console.warn("[thumbtack-messages] inbound insert", inboundInsert.error.message)
  }

  void recordActivityLog(supabase, {
    landlordId: thread.landlord_id,
    eventType: "vendor.thumbtack_replied",
    source: "edge_function",
    actorType: "vendor",
    maintenanceRequestId: thread.ticket_id,
    metadata: {
      message: `${thread.vendor_name} replied on Thumbtack.`,
      vendorName: thread.vendor_name,
    },
  })

  void notifyLandlordNeedsAttention(supabase, {
    landlordId: thread.landlord_id,
    kind: "external_vendor_replied",
    headline: `${thread.vendor_name} replied`,
    detail: text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text,
    idempotencyKey: `thumbtack-reply:${inbound.messageId || `${thread.id}:${now}`}`,
    maintenanceRequestId: thread.ticket_id,
  })

  return { applied: true }
}

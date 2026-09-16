/**
 * Thumbtack demand Messages / Requests API — Edge only (never call from the browser).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import type { ExternalVendorSearchInput } from "./types.ts"
import {
  extractZipFromLocation,
  thumbtackOpenConversationError,
  thumbtackProviderFromEnv,
  thumbtackSearchContextForBusiness,
  type ThumbtackExternalVendorProvider,
} from "./providers/thumbtack.ts"
import {
  loadLandlordThumbtackOAuth,
  saveLandlordThumbtackRefreshToken,
} from "./thumbtackOauthStore.ts"
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

/** Prefer a searchID minted at send time. Never reuse the listing's ID (wrong OAuth app / expired). */
export function resolveThumbtackRequestSearchIds(input: {
  listingSearchId: string
  listingCategoryId: string
  sameToken?: { searchId: string; categoryId: string } | null
}): { searchId: string; categoryId: string } {
  const listingCategoryId = input.listingCategoryId.trim()
  const freshSearch = input.sameToken?.searchId.trim() ?? ""
  const freshCategory = input.sameToken?.categoryId.trim() ?? ""
  if (freshSearch) {
    return { searchId: freshSearch, categoryId: freshCategory || listingCategoryId }
  }
  return { searchId: "", categoryId: listingCategoryId }
}

export function thumbtackCreateRequestBodies(input: {
  searchId: string
  businessId: string
  categoryId: string
  utmSource: string
  description?: string | null
  zipCode?: string | null
}): Record<string, unknown>[] {
  const utmData = { utm_source: input.utmSource }
  const description = input.description?.trim() || ""
  const zip = input.zipCode?.trim() || ""
  const bodies: Record<string, unknown>[] = []
  if (input.searchId.trim() && input.categoryId.trim()) {
    bodies.push({
      searchID: input.searchId,
      businessIDs: [input.businessId],
      categoryID: input.categoryId,
      utmData,
      ...(description ? { description } : {}),
      ...(zip ? { zipCode: zip } : {}),
    })
    bodies.push({
      searchId: input.searchId,
      businessIds: [input.businessId],
      categoryId: input.categoryId,
      utmData,
    })
  }
  if (input.categoryId.trim() && zip) {
    bodies.push({
      businessIDs: [input.businessId],
      categoryID: input.categoryId,
      utmData,
      zipCode: zip,
      ...(description ? { description } : {}),
    })
  }
  return bodies
}

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
  issueCategory?: string | null
  searchLocation?: string | null
  connectedLandlordId?: string | null
}

export type ThumbtackSendMessageResult =
  | { ok: true; thread: ThumbtackVendorThreadRow }
  | { ok: false; error: string; httpStatus?: number }

async function thumbtackFetch(
  provider: ThumbtackExternalVendorProvider,
  path: string,
  init: { method: string; body?: unknown; token?: string | null; apiBase?: string | null },
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const token = init.token?.trim() || (await provider.getMessagingAccessToken())
  if (!token) {
    return { ok: false, status: 401, json: null, text: "oauth_token_failed" }
  }
  const base = (init.apiBase?.trim() || provider.apiBase()).replace(/\/$/, "")
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`
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
  token: string
  apiBase?: string | null
  searchId: string
  businessId: string
  categoryId: string
  description?: string | null
  zipCode?: string | null
}): Promise<{ requestId: string | null; negotiationId: string | null; error?: string; status?: number }> {
  const bodies = thumbtackCreateRequestBodies({
    searchId: input.searchId,
    businessId: input.businessId,
    categoryId: input.categoryId,
    utmSource: input.provider.partnerUtmSource(),
    description: input.description,
    zipCode: input.zipCode,
  })

  let last = { status: 0, text: "" }
  for (const body of bodies) {
    const res = await thumbtackFetch(input.provider, "/v4/requests", {
      method: "POST",
      body,
      token: input.token,
      apiBase: input.apiBase,
    })
    if (res.ok) {
      return {
        requestId: pickRequestId(res.json),
        negotiationId: pickNegotiationId(res.json),
      }
    }
    last = { status: res.status, text: res.text }
    console.warn("[thumbtack-messages] create request HTTP", res.status, {
      searchId: input.searchId,
      businessId: input.businessId,
      categoryId: input.categoryId,
      body: res.text.slice(0, 400),
    })
    if (res.status !== 400) break
  }
  return {
    requestId: null,
    negotiationId: null,
    error: thumbtackOpenConversationError(last.status, last.text),
    status: last.status,
  }
}

async function loadNegotiationForBusiness(input: {
  provider: ThumbtackExternalVendorProvider
  token?: string | null
  apiBase?: string | null
  businessId: string
}): Promise<string | null> {
  const res = await thumbtackFetch(
    input.provider,
    `/v4/businesses/${encodeURIComponent(input.businessId)}/negotiations`,
    { method: "GET", token: input.token, apiBase: input.apiBase },
  )
  if (!res.ok) {
    console.warn("[thumbtack-messages] list negotiations HTTP", res.status, res.text.slice(0, 200))
    return null
  }
  return pickNegotiationId(res.json)
}

async function postNegotiationMessage(input: {
  provider: ThumbtackExternalVendorProvider
  token?: string | null
  apiBase?: string | null
  negotiationId: string
  text: string
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string; status: number }> {
  const res = await thumbtackFetch(
    input.provider,
    `/v4/negotiations/${encodeURIComponent(input.negotiationId)}/messages`,
    { method: "POST", body: { text: input.text }, token: input.token, apiBase: input.apiBase },
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

function searchInputFromSend(input: ThumbtackSendMessageInput): ExternalVendorSearchInput | null {
  const loc = input.searchLocation?.trim() ?? ""
  if (!extractZipFromLocation(loc)) return null
  const category = (input.issueCategory ?? "").trim().replace(/_/g, " ") || "home repair"
  return {
    issueCategory: input.issueCategory ?? null,
    searchLocation: loc,
    tradeTerms: category,
    textQuery: `${category} ${loc}`,
    jobDescription: input.text.trim().slice(0, 280) || null,
    limit: 12,
  }
}

async function openThumbtackNegotiation(input: {
  provider: ThumbtackExternalVendorProvider
  send: ThumbtackSendMessageInput
  businessId: string
}): Promise<{
  negotiationId: string | null
  requestId: string | null
  searchId: string
  categoryId: string
  token: string | null
  apiBase?: string | null
  error?: string
  status?: number
}> {
  const searchInput = searchInputFromSend(input.send)
  if (!searchInput) {
    return {
      negotiationId: null,
      requestId: null,
      searchId: "",
      categoryId: "",
      token: null,
      error: "Thumbtack needs the property ZIP code to open this conversation.",
    }
  }

  const messageToken = await input.provider.getMessagingAccessToken()
  if (!messageToken) {
    return {
      negotiationId: null,
      requestId: null,
      searchId: "",
      categoryId: "",
      token: null,
      error: thumbtackOpenConversationError(401, "oauth_token_failed"),
      status: 409,
    }
  }

  const searchApi = input.provider.apiBase().replace(/\/$/, "")
  const listingSearchId = input.send.searchId?.trim() || ""
  const listingCategoryId = input.send.categoryId?.trim() || ""
  const sameTokenHits = await input.provider.searchWithAccessToken(
    searchInput,
    messageToken,
    searchApi,
  )
  const sameTokenCtx = thumbtackSearchContextForBusiness(sameTokenHits, input.businessId, {
    requireBusiness: true,
  }) ?? thumbtackSearchContextForBusiness(sameTokenHits, input.businessId)

  let { searchId, categoryId } = resolveThumbtackRequestSearchIds({
    listingSearchId,
    listingCategoryId,
    sameToken: sameTokenCtx,
  })

  if (!categoryId) {
    const zip = extractZipFromLocation(searchInput.searchLocation) ?? ""
    const lookedUp = zip
      ? await input.provider.lookupCategoryId(
        searchInput.tradeTerms || searchInput.issueCategory || "home repair",
        zip,
      )
      : null
    if (lookedUp) categoryId = lookedUp
  }

  if (!categoryId) {
    return {
      negotiationId: null,
      requestId: null,
      searchId,
      categoryId,
      token: messageToken,
      error:
        "Thumbtack needs a service category for this pro. Search for vendors again, then send the message.",
    }
  }

  const created = await createThumbtackRequest({
    provider: input.provider,
    token: messageToken,
    apiBase: searchApi,
    searchId,
    businessId: input.businessId,
    categoryId,
    description: input.send.text,
    zipCode: extractZipFromLocation(searchInput.searchLocation),
  })
  if (created.negotiationId) {
    return {
      negotiationId: created.negotiationId,
      requestId: created.requestId,
      searchId,
      categoryId,
      token: messageToken,
      apiBase: searchApi,
    }
  }
  const fallback = await loadNegotiationForBusiness({
    provider: input.provider,
    token: messageToken,
    apiBase: searchApi,
    businessId: input.businessId,
  })
  if (fallback) {
    return {
      negotiationId: fallback,
      requestId: created.requestId,
      searchId,
      categoryId,
      token: messageToken,
      apiBase: searchApi,
    }
  }
  return {
    negotiationId: null,
    requestId: created.requestId,
    searchId,
    categoryId,
    token: messageToken,
    error: created.error ||
      "Thumbtack did not return a conversation for this pro. Search again, then try Message Vendor.",
    status: created.status === 401 || created.status === 403 ? 409 : created.status,
  }
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

  const fromDb = await loadLandlordThumbtackOAuth(supabase, input.landlordId, [
    input.connectedLandlordId,
  ])
  const oauthLandlordId = fromDb?.landlordId || input.landlordId
  console.warn("[thumbtack-messages] load oauth", JSON.stringify({
    ticket_landlord_id: input.landlordId,
    connected_landlord_id: input.connectedLandlordId ?? null,
    oauth_landlord_id: fromDb?.landlordId ?? null,
    has_refresh_token: Boolean(fromDb?.refreshToken),
    has_access_token: Boolean(fromDb?.accessToken),
  }))
  const provider = thumbtackProviderFromEnv({
    messagingRefreshToken: fromDb?.refreshToken,
    messagingAccessToken: fromDb?.accessToken,
    messagingAccessExpiresAt: fromDb?.accessExpiresAt,
  })
  if (!provider.isConfigured()) {
    return { ok: false, error: "Thumbtack is not configured on the server." }
  }
  if (!provider.isMessagingConfigured()) {
    return {
      ok: false,
      error: "Thumbtack in-app messaging is not configured on the server.",
    }
  }
  if (
    !fromDb?.refreshToken &&
    !fromDb?.accessToken &&
    !Deno.env.get("THUMBTACK_MESSAGING_REFRESH_TOKEN")?.trim()
  ) {
    return {
      ok: false,
      error: thumbtackOpenConversationError(401, "oauth_token_failed"),
      httpStatus: 409,
    }
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
  let searchId = input.searchId?.trim() || thread?.search_id?.trim() || ""
  let categoryId = input.categoryId?.trim() || thread?.category_id?.trim() || ""
  let flowToken: string | null = null
  let flowApiBase: string | null = null

  if (!negotiationId) {
    const opened = await openThumbtackNegotiation({
      provider,
      send: input,
      businessId,
    })
    if (opened.searchId) searchId = opened.searchId
    if (opened.categoryId) categoryId = opened.categoryId
    requestId = opened.requestId ?? requestId
    flowToken = opened.token
    flowApiBase = opened.apiBase ?? null
    negotiationId = opened.negotiationId
    if (!negotiationId) {
      return {
        ok: false,
        error: opened.error ||
          "Thumbtack did not return a conversation for this pro. Search again, then try Message Vendor.",
        httpStatus: opened.status,
      }
    }
  }

  const sent = await postNegotiationMessage({
    provider,
    token: flowToken,
    apiBase: flowApiBase,
    negotiationId,
    text,
  })
  if (!sent.ok) {
    return { ok: false, error: sent.error, httpStatus: sent.status }
  }

  const now = new Date().toISOString()
  const upsert = {
    ticket_id: input.ticketId,
    landlord_id: oauthLandlordId,
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

  const rotated = provider.lastRotatedRefreshToken?.trim()
  if (rotated) {
    await saveLandlordThumbtackRefreshToken(supabase, oauthLandlordId, rotated)
  }
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
): Promise<{
  applied: boolean
  reason?: string
  landlordId?: string
  ticketId?: string
  vendorName?: string
  threadId?: string
  text?: string
  messageId?: string | null
}> {
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

  return {
    applied: true,
    landlordId: thread.landlord_id,
    ticketId: thread.ticket_id,
    vendorName: thread.vendor_name,
    threadId: thread.id,
    text,
    messageId: inbound.messageId,
  }
}

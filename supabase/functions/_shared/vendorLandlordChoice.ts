/**
 * Landlord must acknowledge by SMS before Ulo assigns any vendor.
 * One option → reply YES. Two options → reply 1 or 2.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { getSMSProviderForSend } from "./sms/providerFactory.ts"
import { resolveLandlordOpsPhones } from "./sms/tenantActivationAdminAlert.ts"
import type { VendorAssignmentOption } from "./vendor_assignment.ts"

export const AWAITING_LANDLORD_VENDOR_CHOICE = "Awaiting landlord vendor choice"

export function ticketIsAwaitingLandlordVendorChoice(
  vendorNotifyError?: string | null,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_LANDLORD_VENDOR_CHOICE)
}

export function vendorChoiceOptionIdsEqual(a: string[], b: string[]): boolean {
  const left = [...a].map((id) => id.trim()).filter(Boolean).sort()
  const right = [...b].map((id) => id.trim()).filter(Boolean).sort()
  if (left.length !== right.length) return false
  return left.every((id, i) => id === right[i])
}

export async function loadStoredAwaitingVendorChoiceForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<AwaitingVendorChoice | null> {
  const id = ticketId.trim()
  if (!id) return null
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("maintenance_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(25)
  if (error) {
    console.error("[vendor-choice] load stored awaiting choice", error)
    return null
  }
  for (const row of data ?? []) {
    const awaiting = readAwaitingVendorChoice(row.intake_state)
    if (awaiting?.ticketId === id) return awaiting
  }
  return null
}

/** Landlord SMS can switch vendors while Ulo is still waiting for accept. */
export function canReplaceAssignedVendorForLandlordChoice(
  vendorWorkStatus?: string | null,
): boolean {
  const status = (vendorWorkStatus ?? "").trim().toLowerCase()
  return (
    status === "" ||
    status === "unassigned" ||
    status === "pending_accept" ||
    status === "declined"
  )
}

export type VendorChoiceOption = {
  id: string
  name: string
  role: "specialist" | "generalist" | "external"
  source?: "roster" | "external"
  searchId?: string | null
  categoryId?: string | null
}

export type AwaitingVendorChoice = {
  ticketId: string
  options: VendorChoiceOption[]
  searchLocation?: string | null
  issueCategory?: string | null
  issueSummary?: string | null
  urgency?: string | null
}

function asRole(raw: unknown, source?: unknown): "specialist" | "generalist" | "external" {
  if (raw === "external" || source === "external") return "external"
  return raw === "generalist" ? "generalist" : "specialist"
}

export function isExternalVendorChoice(option: VendorChoiceOption): boolean {
  return option.role === "external" || option.source === "external"
}

export function readAwaitingVendorChoice(
  intakeState: unknown,
): AwaitingVendorChoice | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_vendor_choice
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  if (!ticketId) return null

  const options: VendorChoiceOption[] = []
  if (Array.isArray(row.options)) {
    for (const item of row.options) {
      if (!item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      const id = typeof rec.id === "string" ? rec.id.trim() : ""
      const name = typeof rec.name === "string" ? rec.name.trim() : ""
      if (!id) continue
      const source =
        rec.source === "external"
          ? ("external" as const)
          : rec.source === "roster"
            ? ("roster" as const)
            : undefined
      const role = asRole(rec.role, rec.source ?? source)
      options.push({
        id,
        name: name || "the vendor",
        role,
        source: source ?? (role === "external" ? "external" : "roster"),
        searchId:
          typeof rec.search_id === "string"
            ? rec.search_id
            : typeof rec.searchId === "string"
              ? rec.searchId
              : null,
        categoryId:
          typeof rec.category_id === "string"
            ? rec.category_id
            : typeof rec.categoryId === "string"
              ? rec.categoryId
              : null,
      })
    }
  }
  if (options.length === 0) {
    const specialistId =
      typeof row.specialist_id === "string" ? row.specialist_id.trim() : ""
    const generalistId =
      typeof row.generalist_id === "string" ? row.generalist_id.trim() : ""
    const specialistName =
      typeof row.specialist_name === "string" ? row.specialist_name.trim() : ""
    const generalistName =
      typeof row.generalist_name === "string" ? row.generalist_name.trim() : ""
    if (specialistId) {
      options.push({
        id: specialistId,
        name: specialistName || "the specialist",
        role: "specialist",
      })
    }
    if (generalistId) {
      options.push({
        id: generalistId,
        name: generalistName || "the handyman",
        role: "generalist",
      })
    }
  }
  if (options.length === 0) return null
  return {
    ticketId,
    options,
    searchLocation:
      typeof row.search_location === "string" ? row.search_location : null,
    issueCategory:
      typeof row.issue_category === "string" ? row.issue_category : null,
    issueSummary:
      typeof row.issue_summary === "string" ? row.issue_summary : null,
    urgency: typeof row.urgency === "string" ? row.urgency : null,
  }
}

export function serializeAwaitingVendorChoice(
  awaiting: AwaitingVendorChoice,
): Record<string, unknown> {
  return {
    ticket_id: awaiting.ticketId,
    search_location: awaiting.searchLocation ?? null,
    issue_category: awaiting.issueCategory ?? null,
    issue_summary: awaiting.issueSummary ?? null,
    urgency: awaiting.urgency ?? null,
    options: awaiting.options.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      source: row.source ?? (row.role === "external" ? "external" : "roster"),
      search_id: row.searchId ?? null,
      category_id: row.categoryId ?? null,
    })),
  }
}

export function formatExternalVendorSmsLine(row: {
  name: string
  rating?: number | null
  reviewCount?: number | null
}): string {
  const name = row.name.trim() || "Vendor"
  const rating =
    typeof row.rating === "number" && Number.isFinite(row.rating)
      ? Math.round(row.rating * 10) / 10
      : null
  const reviews =
    typeof row.reviewCount === "number" && Number.isFinite(row.reviewCount)
      ? Math.max(0, Math.round(row.reviewCount))
      : null
  const stars =
    rating == null
      ? null
      : `${Number.isInteger(rating) ? String(rating) : rating.toFixed(1)} ${
          rating === 1 ? "star" : "stars"
        }`
  const reviewBit =
    reviews == null
      ? null
      : `(${reviews.toLocaleString("en-US")} ${reviews === 1 ? "review" : "reviews"})`
  const social = [stars, reviewBit].filter(Boolean).join(" ")
  return social ? `${name} · ${social}` : name
}

export function choiceOptionsFromExternalSuggestions(
  rows: Array<{
    name: string
    providerRef?: string | null
    searchId?: string | null
    categoryId?: string | null
  }>,
  limit = 3,
): VendorChoiceOption[] {
  const options: VendorChoiceOption[] = []
  for (const row of rows) {
    if (options.length >= limit) break
    const name = row.name.trim()
    if (!name) continue
    const providerRef = row.providerRef?.trim() || ""
    options.push({
      id: providerRef || `mock:${name}`,
      name,
      role: "external",
      source: "external",
      searchId: row.searchId ?? null,
      categoryId: row.categoryId ?? null,
    })
  }
  return options
}

export function landlordNumberedChoiceReplyHint(count: number): string {
  if (count <= 0) return ""
  if (count === 1) return "Reply 1 and we'll contact them."
  if (count === 2) return "Reply 1 or 2 and we'll contact them."
  const nums = Array.from({ length: count }, (_, i) => String(i + 1))
  return `Reply ${nums.slice(0, -1).join(", ")}, or ${nums[nums.length - 1]} and we'll contact them.`
}

export function canHandleLandlordVendorChoice(input: {
  identityType: string
  conversationType?: string | null
  intakeState: unknown
}): boolean {
  if (input.identityType === "resident") return false
  return readAwaitingVendorChoice(input.intakeState) != null
}

export function landlordChoiceReplyHint(count: number): string {
  if (count <= 1) return "Reply YES"
  const nums = Array.from({ length: count }, (_, i) => String(i + 1))
  if (nums.length === 2) return `Reply ${nums[0]} or ${nums[1]}`
  return `Reply ${nums.slice(0, -1).join(", ")}, or ${nums[nums.length - 1]}`
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

export function parseLandlordVendorChoice(
  body: string,
  options: VendorChoiceOption[],
): VendorChoiceOption | null {
  const raw = body.trim()
  if (!raw || options.length === 0) return null
  const normalized = raw.toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ")
  const first = options[0]
  if (!first) return null

  if (options.length === 1) {
    if (
      /^(yes|y|ok|okay|assign|send it|send|1|one|reply 1|option 1)$/i.test(normalized)
    ) {
      return first
    }
    if (first.name && normalized.includes(first.name.toLowerCase())) return first
    return null
  }

  const numbered = normalized.match(/^(?:option |reply )?(\d+)$/)
  if (numbered) {
    const index = Number(numbered[1]) - 1
    return options[index] ?? null
  }
  const wordIndex = NUMBER_WORDS[normalized]
  if (typeof wordIndex === "number") {
    return options[wordIndex - 1] ?? null
  }

  for (const option of options) {
    if (option.name && normalized.includes(option.name.toLowerCase())) return option
  }
  const generalists = options.filter((row) => row.role === "generalist")
  if (/\b(handyman|general)\b/.test(normalized) && generalists.length === 1) {
    return generalists[0] ?? null
  }
  return null
}

export function unclearVendorChoiceReply(options: VendorChoiceOption[]): string {
  if (options.length === 1) {
    const name = options[0]?.name || "this vendor"
    return `Please reply YES to send this to ${name}.`
  }
  const names = options.map((row, index) => `${index + 1} for ${row.name}`)
  if (names.length === 2) {
    return `Please reply ${names[0]} or ${names[1]}.`
  }
  return `Please reply ${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}.`
}

export function buildLandlordVendorChoiceSms(input: {
  landlordFirstName?: string | null
  companyName?: string | null
  workOrderRef: string
  unit?: string | null
  tradeLabel: string
  options: VendorChoiceOption[]
  adminUrl?: string | null
  /** Why we're asking — rematch copy when the current vendor didn't respond. */
  reason?: "assign" | "no_response" | "declined" | "noshow"
}): string {
  const first = input.landlordFirstName?.trim()
  const greeting = first ? `Hi ${first},` : "Hi,"
  const company = input.companyName?.trim()
  const who = company
    ? `This is the property management team at ${company}.`
    : "This is Ulo."
  const wo = input.workOrderRef.trim() || "this work order"
  const unit = input.unit?.trim()
  const where = unit ? ` (${unit})` : ""
  const trade = input.tradeLabel.trim() || "this"
  const lines = [
    greeting,
    "",
    who,
    "",
    `Work order ${wo}${where} is a ${trade} repair.`,
    "",
  ]

  if (input.reason === "no_response") {
    lines.push("The assigned vendor hasn't responded in time.", "")
  } else if (input.reason === "declined") {
    lines.push("The assigned vendor isn't able to take this job.", "")
  } else if (input.reason === "noshow") {
    lines.push("The assigned vendor didn't make the visit.", "")
  }

  if (input.options.length === 1) {
    const only = input.options[0]
    const name = only?.name || "your vendor"
    const kind = only?.role === "generalist" ? "handyman" : trade
    lines.push(
      `${name} (${kind}) can take this job.`,
      "",
      `Reply YES if you want us to send this to ${name}.`,
    )
  } else {
    lines.push("These vendors on your roster can take this job:")
    input.options.forEach((option, index) => {
      const kind = option.role === "generalist" ? "handyman" : trade
      lines.push(`${index + 1}. ${option.name} (${kind})`)
    })
    lines.push(
      "",
      `${landlordChoiceReplyHint(input.options.length)} and we'll send them the work order.`,
    )
  }

  const adminUrl = input.adminUrl?.trim() ?? ""
  if (adminUrl) {
    lines.push("", adminUrl)
  }
  return lines.join("\n")
}

function tradeLabelFromCategory(issueCategory: string | null): string {
  const raw = (issueCategory ?? "").trim().toLowerCase().replace(/_/g, " ")
  if (!raw || raw === "other" || raw === "general") return "maintenance"
  return raw
}

function optionsFromAssignment(
  rows: VendorAssignmentOption[],
): VendorChoiceOption[] {
  return rows.map((row) => ({
    id: row.vendor.id,
    name: row.vendor.name,
    role: row.role,
  }))
}

export async function persistLandlordChoiceSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    phone: string
    body: string
    awaiting: AwaitingVendorChoice
    providerMessageSid: string
    provider: string
    fromNumber: string
  },
): Promise<void> {
  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.phone,
    identityType: "landlord",
  })
  if (!identity) return

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!main?.id) return

  const ticketId = params.awaiting.ticketId
  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: main.id,
    externalPhone: params.phone,
    identity,
    maintenanceRequestId: ticketId,
    conversationStatus: "open",
  })

  await supabase.from("sms_messages").insert({
    conversation_id: conversationId,
    landlord_id: params.landlordId,
    direction: "outbound",
    from_number: normalizeSmsPhone(params.fromNumber),
    to_number: normalizeSmsPhone(params.phone),
    body: params.body,
    media_urls: [],
    provider: params.provider,
    provider_message_sid: params.providerMessageSid,
    provider_status: "sent",
    raw_payload: {
      source: "landlord_vendor_choice",
      ticket_id: ticketId,
    },
  })

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}

  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      conversation_type: "landlord_update",
      maintenance_request_id: ticketId,
      intake_state: {
        ...prior,
        awaiting_vendor_choice: serializeAwaitingVendorChoice(params.awaiting),
      },
    })
    .eq("id", conversationId)
}

export async function notifyLandlordVendorChoice(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    unit: string
    issueCategory: string | null
    options: VendorAssignmentOption[]
    reason?: "assign" | "no_response" | "declined" | "noshow"
  },
): Promise<{ sent: number }> {
  const choiceOptions = optionsFromAssignment(params.options)
  if (choiceOptions.length === 0) return { sent: 0 }

  const { data: landlord } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", params.landlordId)
    .maybeSingle()
  const companyName =
    typeof landlord?.name === "string" ? landlord.name.trim() : ""
  const landlordFirstName = companyName.split(/\s+/)[0] || null
  const wo = formatWorkOrderRef(params.ticketId)
  const smsBody = buildLandlordVendorChoiceSms({
    landlordFirstName,
    companyName: companyName || null,
    workOrderRef: wo,
    unit: params.unit,
    tradeLabel: tradeLabelFromCategory(params.issueCategory),
    options: choiceOptions,
    adminUrl: uloAppUrl.admin(),
    reason: params.reason ?? "assign",
  })

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  const provider = getSMSProviderForSend({
    landlordId: params.landlordId,
    lineProvider: main?.provider,
  })
  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  let sent = 0
  for (const phone of phones) {
    const sendResult = await provider.sendMessage({
      to: phone,
      body: smsBody,
      from: main?.phone_number,
    })
    if (sendResult.error) {
      console.error("[vendor-choice] landlord SMS", phone, sendResult.error)
      continue
    }
    sent += 1
    try {
      await persistLandlordChoiceSms(supabase, {
        landlordId: params.landlordId,
        phone,
        body: smsBody,
        awaiting: { ticketId: params.ticketId, options: choiceOptions },
        providerMessageSid:
          sendResult.providerMessageSid ??
          sendResult.messageId ??
          `landlord-vendor-choice:${params.ticketId}:${phone}`,
        provider: sendResult.provider ?? "twilio",
        fromNumber: main?.phone_number ?? "unknown",
      })
    } catch (e) {
      console.error("[vendor-choice] persist landlord SMS thread", e)
    }
  }

  const names = choiceOptions.map((row) => row.name).join(" or ")
  const rematch =
    params.reason === "no_response" ||
    params.reason === "declined" ||
    params.reason === "noshow"
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_choice_asked",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    metadata: {
      message: rematch
        ? `Asked the landlord to confirm a replacement vendor for ${wo}: ${names}.`
        : `Asked the landlord to confirm vendor assignment for ${wo}: ${names}.`,
      option_ids: choiceOptions.map((row) => row.id),
      reason: params.reason ?? "assign",
    },
  })

  return { sent }
}

async function clearAwaitingVendorChoice(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
): Promise<void> {
  const next = { ...priorIntake }
  delete next.awaiting_vendor_choice
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

export async function tryHandleLandlordVendorChoiceInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    fromPhone?: string | null
  },
): Promise<
  | { handled: false }
  | { handled: true; ticketId: string; vendorId: string | null; replyBody: string }
> {
  if (params.identityType === "resident") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, conversation_type, maintenance_request_id, external_phone_number")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!conv?.id) return { handled: false }

  let conversationId = conv.id
  let priorIntake =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  let awaiting = readAwaitingVendorChoice(priorIntake)

  if (!awaiting) {
    const phone = normalizeSmsPhone(
      params.fromPhone?.trim() ||
        (typeof conv.external_phone_number === "string"
          ? conv.external_phone_number
          : ""),
    )
    if (phone) {
      const { data: others } = await supabase
        .from("sms_conversations")
        .select("id, intake_state")
        .eq("landlord_id", params.landlordId)
        .eq("external_phone_number", phone)
        .order("updated_at", { ascending: false })
        .limit(25)
      const match = (others ?? []).find((row) =>
        readAwaitingVendorChoice(row.intake_state) != null
      )
      if (match?.id) {
        conversationId = match.id
        priorIntake =
          match.intake_state && typeof match.intake_state === "object"
            ? (match.intake_state as Record<string, unknown>)
            : {}
        awaiting = readAwaitingVendorChoice(priorIntake)
      }
    }
  }

  if (!awaiting) return { handled: false }

  const chosen = parseLandlordVendorChoice(params.body, awaiting.options)
  if (!chosen) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody: unclearVendorChoiceReply(awaiting.options),
    }
  }

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "id, priority, unit, description, due_at, estimated_minutes, resident_availability_text, assigned_vendor_id, vendor_work_status",
    )
    .eq("id", awaiting.ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!ticket?.id) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody:
        "I couldn't find that work order. Open the dashboard if you still need to assign a vendor.",
    }
  }

  const assignedId =
    typeof ticket.assigned_vendor_id === "string" && ticket.assigned_vendor_id.trim()
      ? ticket.assigned_vendor_id.trim()
      : ""
  const workStatus =
    typeof ticket.vendor_work_status === "string" ? ticket.vendor_work_status : ""

  if (assignedId && !isExternalVendorChoice(chosen)) {
    if (assignedId === chosen.id) {
      await clearAwaitingVendorChoice(supabase, conversationId, priorIntake)
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: assignedId,
        replyBody: `Got it — we'll keep ${chosen.name} on this job and wait for them to reply.`,
      }
    }
    if (!canReplaceAssignedVendorForLandlordChoice(workStatus)) {
      await clearAwaitingVendorChoice(supabase, conversationId, priorIntake)
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: assignedId,
        replyBody: "That work order already has a vendor. We'll text you when they reply.",
      }
    }
    const { reassignVendorByIdAndNotify } = await import(
      "../submit-maintenance-request/vendor_notify.ts"
    )
    const reassigned = await reassignVendorByIdAndNotify(
      supabase,
      awaiting.ticketId,
      chosen.id,
    )
    if ("error" in reassigned) {
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: null,
        replyBody:
          `I couldn't send this to ${chosen.name} just now. Try again, or assign them from the dashboard.`,
      }
    }
    await clearAwaitingVendorChoice(supabase, conversationId, priorIntake)
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.vendor_choice_selected",
      source: "sms",
      actorType: "landlord",
      vendorId: chosen.id,
      maintenanceRequestId: awaiting.ticketId,
      conversationId,
      metadata: {
        message: `Assigned ${chosen.name} after the landlord confirmed.`,
      },
    })
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: chosen.id,
      replyBody: `Got it — we'll send this to ${chosen.name} now and ask them to take the job. We'll text you when they reply.`,
    }
  }

  if (isExternalVendorChoice(chosen)) {
    const businessId = chosen.id.startsWith("mock:") ? "" : chosen.id.trim()
    if (!businessId) {
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: null,
        replyBody:
          "Open Ulo to contact that vendor — I couldn't reach them over text from here.",
      }
    }
    const { sendThumbtackVendorMessage } = await import(
      "./external_vendor/thumbtackMessages.ts"
    )
    const { buildThumbtackVendorOutreachMessage } = await import(
      "./external_vendor/thumbtackOutreachCopy.ts"
    )
    const text = buildThumbtackVendorOutreachMessage({
      propertyAddress: awaiting.searchLocation,
      jobCategory: awaiting.issueCategory,
      issueSummary: awaiting.issueSummary,
      urgency: awaiting.urgency,
    })
    const sent = await sendThumbtackVendorMessage(supabase, {
      ticketId: awaiting.ticketId,
      landlordId: params.landlordId,
      businessId,
      vendorName: chosen.name,
      searchId: chosen.searchId,
      categoryId: chosen.categoryId,
      text,
      issueCategory: awaiting.issueCategory,
      searchLocation: awaiting.searchLocation,
    })
    if (!sent.ok) {
      return {
        handled: true,
        ticketId: awaiting.ticketId,
        vendorId: null,
        replyBody:
          `I couldn't reach ${chosen.name} just now. Try again, or open Ulo to message them.`,
      }
    }
    await clearAwaitingVendorChoice(supabase, conversationId, priorIntake)
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.vendor_choice_selected",
      source: "sms",
      actorType: "landlord",
      maintenanceRequestId: awaiting.ticketId,
      conversationId,
      metadata: {
        message: `Asked ${chosen.name} about this job after the landlord chose them.`,
        source: "external",
        business_id: businessId,
      },
    })
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody: `Got it — we'll contact ${chosen.name} about this job now. We'll text you when they reply.`,
    }
  }

  const { assignVendorAndNotify } = await import(
    "../submit-maintenance-request/vendor_notify.ts"
  )
  const result = await assignVendorAndNotify(supabase, {
    ticketId: awaiting.ticketId,
    priority: typeof ticket.priority === "string" && ticket.priority.trim()
      ? ticket.priority
      : "normal",
    unit: typeof ticket.unit === "string" ? ticket.unit : "",
    description: typeof ticket.description === "string" ? ticket.description : "",
    dueAt: typeof ticket.due_at === "string" ? ticket.due_at : null,
    estimatedMinutes: typeof ticket.estimated_minutes === "number"
      ? ticket.estimated_minutes
      : null,
    landlordId: params.landlordId,
    preferVendorId: chosen.id,
    landlordAcknowledged: true,
    residentAvailabilityText:
      typeof ticket.resident_availability_text === "string"
        ? ticket.resident_availability_text
        : null,
    retryIfUnassigned: true,
  })

  if (!result.assigned) {
    return {
      handled: true,
      ticketId: awaiting.ticketId,
      vendorId: null,
      replyBody:
        `I couldn't send this to ${chosen.name} just now. Try again, or assign them from the dashboard.`,
    }
  }

  await clearAwaitingVendorChoice(supabase, conversationId, priorIntake)
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_choice_selected",
    source: "sms",
    actorType: "landlord",
    vendorId: chosen.id,
    maintenanceRequestId: awaiting.ticketId,
    conversationId,
    metadata: {
      message: `Assigned ${chosen.name} after the landlord confirmed.`,
    },
  })

  return {
    handled: true,
    ticketId: awaiting.ticketId,
    vendorId: chosen.id,
    replyBody: `Got it — we'll send this to ${chosen.name} now and ask them to take the job. We'll text you when they reply.`,
  }
}

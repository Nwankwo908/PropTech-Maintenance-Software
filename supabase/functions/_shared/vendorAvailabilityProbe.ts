/**
 * Pre-assignment availability probe.
 *
 * Before the landlord picks a vendor, Ulo texts matchable roster vendors the
 * work-order summary and asks for an arrival window (optional estimate).
 * When vendors reply with a slot, the landlord chooses among responders —
 * then the existing assign → accept → schedule → complete path continues.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  AWAITING_LANDLORD_VENDOR_CHOICE,
  notifyLandlordVendorChoice,
} from "./vendorLandlordChoice.ts"
import type {
  VendorAssignmentOption,
  VendorAssignmentRow,
} from "./vendor_assignment.ts"
import {
  formatWorkOrderRef,
  vendorCompanyName,
} from "./vendor_outreach_copy.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import {
  resolveVendorAvailability,
  type ResolvedAvailability,
} from "./vendor_availability_parse.ts"

export const AWAITING_VENDOR_AVAILABILITY_PROBE =
  "Awaiting vendor availability before landlord choice"

export type VendorProbeOffer = {
  vendorId: string
  name: string
  role: "specialist" | "generalist"
  windowLabel: string
  scheduledAt: string | null
  endAt: string | null
  estimateNote: string | null
  receivedAt: string
}

export type VendorAvailabilityProbe = {
  ticketId: string
  landlordId: string
  unit: string
  issueCategory: string | null
  description: string
  residentAvailabilityText: string | null
  candidates: Array<{
    vendorId: string
    name: string
    role: "specialist" | "generalist"
    phone: string | null
  }>
  offers: VendorProbeOffer[]
  declinedVendorIds: string[]
  status: "probing" | "awaiting_landlord"
  startedAt: string
  landlordNotifiedAt: string | null
}

export type AwaitingVendorProbe = {
  ticketId: string
  vendorId: string
  sentAt: string
}

export function ticketIsAwaitingVendorAvailabilityProbe(
  vendorNotifyError?: string | null,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_VENDOR_AVAILABILITY_PROBE)
}

export function readAwaitingVendorProbe(
  intakeState: unknown,
): AwaitingVendorProbe | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_vendor_probe
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  const vendorId = typeof row.vendor_id === "string" ? row.vendor_id.trim() : ""
  if (!ticketId || !vendorId) return null
  return {
    ticketId,
    vendorId,
    sentAt: typeof row.sent_at === "string" ? row.sent_at : "",
  }
}

export function canHandleVendorAvailabilityProbe(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType !== "vendor") return false
  return readAwaitingVendorProbe(input.intakeState) != null
}

export function buildVendorAvailabilityProbeSms(input: {
  vendorName: string
  companyName?: string | null
  workOrderRef: string
  unit?: string | null
  description: string
  residentAvailabilityText?: string | null
  jobDetailUrl?: string | null
}): string {
  const company = vendorCompanyName(input.vendorName)
  const who = input.companyName?.trim()
    ? `This is the property management team at ${input.companyName.trim()}.`
    : "This is Ulo."
  const wo = input.workOrderRef.trim() || "this work order"
  const unit = input.unit?.trim()
  const where = unit ? ` at ${unit}` : ""
  const issue = input.description.trim().replace(/\s+/g, " ") ||
    "See the work order for details."
  const avail = input.residentAvailabilityText?.trim()

  const lines = [
    `Hi ${company},`,
    "",
    who,
    "",
    `Work order ${wo}${where} may be available:`,
    issue,
  ]
  if (avail) {
    lines.push("", `Resident availability: ${avail}`)
  }
  lines.push(
    "",
    "If you can take this, reply with your earliest day and arrival window",
    "(for example: Wed 9am–12pm). Add an estimate amount if you have one.",
    "",
    `If you can't take it, reply NO ${wo}.`,
  )
  const url = input.jobDetailUrl?.trim()
  if (url) {
    lines.push("", "Details:", url)
  }
  return lines.join("\n")
}

export function buildVendorProbeAckSms(input: {
  windowLabel: string
  workOrderRef: string
}): string {
  const when = input.windowLabel.trim() || "that window"
  const wo = input.workOrderRef.trim() || "this work order"
  return [
    `Thanks — we have you down for ${when} on ${wo}.`,
    "",
    "We'll text you if the property team selects you for this job.",
  ].join("\n")
}

function serializeProbe(probe: VendorAvailabilityProbe): Record<string, unknown> {
  return {
    ticket_id: probe.ticketId,
    landlord_id: probe.landlordId,
    unit: probe.unit,
    issue_category: probe.issueCategory,
    description: probe.description,
    resident_availability_text: probe.residentAvailabilityText,
    candidates: probe.candidates.map((c) => ({
      vendor_id: c.vendorId,
      name: c.name,
      role: c.role,
      phone: c.phone,
    })),
    offers: probe.offers.map((o) => ({
      vendor_id: o.vendorId,
      name: o.name,
      role: o.role,
      window_label: o.windowLabel,
      scheduled_at: o.scheduledAt,
      end_at: o.endAt,
      estimate_note: o.estimateNote,
      received_at: o.receivedAt,
    })),
    declined_vendor_ids: probe.declinedVendorIds,
    status: probe.status,
    started_at: probe.startedAt,
    landlord_notified_at: probe.landlordNotifiedAt,
  }
}

export function readVendorAvailabilityProbe(
  intakeState: unknown,
): VendorAvailabilityProbe | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).vendor_availability_probe
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticket_id === "string" ? row.ticket_id.trim() : ""
  const landlordId = typeof row.landlord_id === "string" ? row.landlord_id.trim() : ""
  if (!ticketId || !landlordId) return null
  const candidatesRaw = Array.isArray(row.candidates) ? row.candidates : []
  const offersRaw = Array.isArray(row.offers) ? row.offers : []
  const declinedRaw = Array.isArray(row.declined_vendor_ids)
    ? row.declined_vendor_ids
    : []
  return {
    ticketId,
    landlordId,
    unit: typeof row.unit === "string" ? row.unit : "",
    issueCategory: typeof row.issue_category === "string" ? row.issue_category : null,
    description: typeof row.description === "string" ? row.description : "",
    residentAvailabilityText:
      typeof row.resident_availability_text === "string"
        ? row.resident_availability_text
        : null,
    candidates: candidatesRaw.flatMap((c) => {
      if (!c || typeof c !== "object") return []
      const item = c as Record<string, unknown>
      const vendorId = typeof item.vendor_id === "string" ? item.vendor_id.trim() : ""
      if (!vendorId) return []
      return [{
        vendorId,
        name: typeof item.name === "string" ? item.name : "Vendor",
        role: item.role === "generalist" ? "generalist" as const : "specialist" as const,
        phone: typeof item.phone === "string" ? item.phone : null,
      }]
    }),
    offers: offersRaw.flatMap((o) => {
      if (!o || typeof o !== "object") return []
      const item = o as Record<string, unknown>
      const vendorId = typeof item.vendor_id === "string" ? item.vendor_id.trim() : ""
      if (!vendorId) return []
      return [{
        vendorId,
        name: typeof item.name === "string" ? item.name : "Vendor",
        role: item.role === "generalist" ? "generalist" as const : "specialist" as const,
        windowLabel: typeof item.window_label === "string" ? item.window_label : "",
        scheduledAt: typeof item.scheduled_at === "string" ? item.scheduled_at : null,
        endAt: typeof item.end_at === "string" ? item.end_at : null,
        estimateNote: typeof item.estimate_note === "string" ? item.estimate_note : null,
        receivedAt: typeof item.received_at === "string" ? item.received_at : "",
      }]
    }),
    declinedVendorIds: declinedRaw
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim()),
    status: row.status === "awaiting_landlord" ? "awaiting_landlord" : "probing",
    startedAt: typeof row.started_at === "string" ? row.started_at : "",
    landlordNotifiedAt:
      typeof row.landlord_notified_at === "string" ? row.landlord_notified_at : null,
  }
}

async function loadLandlordProbeConversation(
  supabase: SupabaseClient,
  landlordId: string,
  ticketId: string,
): Promise<{ conversationId: string; intake: Record<string, unknown> } | null> {
  const main = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!main?.id) return null
  const { phones } = await import("./sms/tenantActivationAdminAlert.ts").then((m) =>
    m.resolveLandlordOpsPhones(supabase, landlordId)
  )
  const phone = phones[0]
  if (!phone) return null
  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId,
    phone,
    identityType: "landlord",
  })
  if (!identity) return null
  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId,
    smsNumberId: main.id,
    externalPhone: phone,
    identity,
    maintenanceRequestId: ticketId,
    conversationStatus: "open",
  })
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const intake =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  return { conversationId, intake }
}

async function saveProbeOnLandlordThread(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
  probe: VendorAvailabilityProbe,
): Promise<void> {
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: {
        ...priorIntake,
        vendor_availability_probe: serializeProbe(probe),
      },
      maintenance_request_id: probe.ticketId,
      conversation_type: "landlord_update",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

export async function loadVendorAvailabilityProbeForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<VendorAvailabilityProbe | null> {
  const id = ticketId.trim()
  if (!id) return null
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("maintenance_request_id", id)
    .order("updated_at", { ascending: false })
    .limit(40)
  if (error) {
    console.error("[vendor-probe] load probe", error.message)
    return null
  }
  for (const row of data ?? []) {
    const probe = readVendorAvailabilityProbe(row.intake_state)
    if (probe?.ticketId === id) return probe
  }
  return null
}

function probeOffersToChoiceNames(offers: VendorProbeOffer[]): VendorAssignmentOption[] {
  return offers.map((offer) => {
    const slot = offer.windowLabel.trim()
    const estimate = offer.estimateNote?.trim()
    const suffix = [slot, estimate].filter(Boolean).join(" · ")
    return {
      vendor: {
        id: offer.vendorId,
        name: suffix ? `${offer.name} — ${suffix}` : offer.name,
        email: null,
        phone: null,
        notification_channel: "sms",
        active: true,
        category: null,
        portal_api_key: null,
        last_assigned_at: null,
        created_at: "",
      } satisfies VendorAssignmentRow,
      role: offer.role,
    }
  })
}

/**
 * Soft-offer every matchable vendor. Landlord choice waits until at least one
 * returns a slot (or all decline → fall through elsewhere).
 */
export async function startVendorAvailabilityProbe(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    unit: string
    issueCategory: string | null
    description: string
    residentAvailabilityText?: string | null
    options: VendorAssignmentOption[]
  },
): Promise<{ probed: number; skipReason?: string }> {
  const candidates = params.options
    .map((opt) => ({
      vendorId: opt.vendor.id,
      name: opt.vendor.name,
      role: opt.role,
      phone: opt.vendor.phone?.trim() || null,
    }))
    .filter((c) => Boolean(c.vendorId))

  if (candidates.length === 0) {
    return { probed: 0, skipReason: "no_vendor" }
  }

  const { data: landlord } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", params.landlordId)
    .maybeSingle()
  const companyName =
    typeof landlord?.name === "string" ? landlord.name.trim() : ""

  const wo = formatWorkOrderRef(params.ticketId)
  const probe: VendorAvailabilityProbe = {
    ticketId: params.ticketId,
    landlordId: params.landlordId,
    unit: params.unit,
    issueCategory: params.issueCategory,
    description: params.description,
    residentAvailabilityText: params.residentAvailabilityText?.trim() || null,
    candidates,
    offers: [],
    declinedVendorIds: [],
    status: "probing",
    startedAt: new Date().toISOString(),
    landlordNotifiedAt: null,
  }

  const host = await loadLandlordProbeConversation(
    supabase,
    params.landlordId,
    params.ticketId,
  )
  if (host) {
    await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
  }

  let probed = 0
  for (const candidate of candidates) {
    if (!candidate.phone) continue
    const body = buildVendorAvailabilityProbeSms({
      vendorName: candidate.name,
      companyName: companyName || null,
      workOrderRef: wo,
      unit: params.unit,
      description: params.description,
      residentAvailabilityText: params.residentAvailabilityText,
    })
    const sent = await sendVendorJobAlert(supabase, {
      ticketId: params.ticketId,
      vendorId: candidate.vendorId,
      vendorPhone: candidate.phone,
      body,
      landlordId: params.landlordId,
    })
    if (!sent.ok) {
      console.warn("[vendor-probe] soft offer failed", candidate.vendorId, sent.error)
      continue
    }
    probed += 1

    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", sent.conversationId)
      .maybeSingle()
    const prior =
      conv?.intake_state && typeof conv.intake_state === "object"
        ? { ...(conv.intake_state as Record<string, unknown>) }
        : {}
    await supabase
      .from("sms_conversations")
      .update({
        intake_state: {
          ...prior,
          awaiting_vendor_probe: {
            ticket_id: params.ticketId,
            vendor_id: candidate.vendorId,
            sent_at: new Date().toISOString(),
          },
        },
        maintenance_request_id: params.ticketId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sent.conversationId)
  }

  await supabase
    .from("maintenance_requests")
    .update({ vendor_notify_error: AWAITING_VENDOR_AVAILABILITY_PROBE })
    .eq("id", params.ticketId)

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_availability_probed",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    metadata: {
      message:
        probed === 1
          ? `Asked 1 vendor for availability on ${wo} before assigning.`
          : `Asked ${probed} vendors for availability on ${wo} before assigning.`,
      probed,
      candidate_ids: candidates.map((c) => c.vendorId),
    },
  })

  if (probed === 0) {
    return { probed: 0, skipReason: "no_vendor" }
  }
  return { probed }
}

function extractEstimateNote(body: string): string | null {
  const money = body.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/)
  if (money?.[0]) return money[0].replace(/\s+/g, "")
  const approx = body.match(
    /\b(?:about|around|estimate(?:d)?|quote(?:d)?)\s*\$?\s?\d[\d,]*(?:\.\d{1,2})?\b/i,
  )
  return approx?.[0]?.trim() || null
}

function looksLikeProbeDecline(body: string): boolean {
  const t = body.trim()
  if (/^(n|no|nope|nah|decline|can't|cannot|unable)\b/i.test(t)) return true
  if (/\b(can't take|cannot take|unable to take|not available|pass on this)\b/i.test(t)) {
    return true
  }
  return false
}

async function notifyLandlordOfProbeOffers(
  supabase: SupabaseClient,
  probe: VendorAvailabilityProbe,
): Promise<void> {
  if (probe.offers.length === 0) return
  const enriched = probeOffersToChoiceNames(probe.offers)

  await notifyLandlordVendorChoice(supabase, {
    landlordId: probe.landlordId,
    ticketId: probe.ticketId,
    unit: probe.unit,
    issueCategory: probe.issueCategory,
    options: enriched,
    reason: "availability",
  })

  await supabase
    .from("maintenance_requests")
    .update({ vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE })
    .eq("id", probe.ticketId)
}

export async function tryHandleVendorAvailabilityProbeInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    identityType: string
    vendorId?: string | null
  },
): Promise<
  | { handled: false }
  | { handled: true; replyBody: string }
> {
  if (params.identityType !== "vendor") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const intake =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  const pending = readAwaitingVendorProbe(intake)
  if (!pending) return { handled: false }

  const vendorId = params.vendorId?.trim() || pending.vendorId
  const probe = await loadVendorAvailabilityProbeForTicket(supabase, pending.ticketId)
  if (!probe) {
    delete intake.awaiting_vendor_probe
    await supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", params.conversationId)
    return {
      handled: true,
      replyBody:
        "Thanks — that availability request is no longer open. We'll text you if a new job comes up.",
    }
  }

  const wo = formatWorkOrderRef(probe.ticketId)
  const candidate = probe.candidates.find((c) => c.vendorId === vendorId)
  const vendorName = candidate?.name || "Vendor"
  const role = candidate?.role || "specialist"

  if (looksLikeProbeDecline(params.body)) {
    if (!probe.declinedVendorIds.includes(vendorId)) {
      probe.declinedVendorIds.push(vendorId)
    }
    delete intake.awaiting_vendor_probe
    await supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", params.conversationId)

    const host = await loadLandlordProbeConversation(
      supabase,
      probe.landlordId,
      probe.ticketId,
    )
    if (host) await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)

    await recordActivityLog(supabase, {
      landlordId: probe.landlordId,
      eventType: "maintenance.vendor_probe_declined",
      source: "sms",
      actorType: "vendor",
      actorId: vendorId,
      vendorId,
      maintenanceRequestId: probe.ticketId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      metadata: {
        message: `${vendorName} declined the availability ask for ${wo}.`,
      },
    })

    const allDeclined =
      probe.offers.length === 0 &&
      probe.candidates.length > 0 &&
      probe.candidates.every((c) => probe.declinedVendorIds.includes(c.vendorId))
    if (allDeclined) {
      const fallbackOptions: VendorAssignmentOption[] = probe.candidates.map((c) => ({
        vendor: {
          id: c.vendorId,
          name: c.name,
          email: null,
          phone: c.phone,
          notification_channel: "sms",
          active: true,
          category: null,
          portal_api_key: null,
          last_assigned_at: null,
          created_at: "",
        } satisfies VendorAssignmentRow,
        role: c.role,
      }))
      await notifyLandlordVendorChoice(supabase, {
        landlordId: probe.landlordId,
        ticketId: probe.ticketId,
        unit: probe.unit,
        issueCategory: probe.issueCategory,
        options: fallbackOptions,
        reason: "declined",
      })
      await supabase
        .from("maintenance_requests")
        .update({ vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE })
        .eq("id", probe.ticketId)
    }

    return {
      handled: true,
      replyBody: `Got it — thanks for letting us know about ${wo}.`,
    }
  }

  const resolved = await resolveVendorAvailability(params.body, {
    conversationContext: undefined,
    clarifyAttempts: 0,
  })

  if (resolved.status === "needs_clarification") {
    return {
      handled: true,
      replyBody: resolved.softPrompt ||
        "Thanks — what day and time works best? For example: Tomorrow 9am–12pm.",
    }
  }

  const value: ResolvedAvailability = resolved.value
  const windowLabel =
    value.entity?.display_text?.trim() ||
    value.windowLabel?.trim() ||
    "the window you shared"
  const estimateNote = extractEstimateNote(params.body)

  const existingIdx = probe.offers.findIndex((o) => o.vendorId === vendorId)
  const offer: VendorProbeOffer = {
    vendorId,
    name: vendorName,
    role,
    windowLabel,
    scheduledAt: value.scheduledAt,
    endAt: value.endAt,
    estimateNote,
    receivedAt: new Date().toISOString(),
  }
  if (existingIdx >= 0) probe.offers[existingIdx] = offer
  else probe.offers.push(offer)

  const firstOffer = probe.offers.length === 1 && !probe.landlordNotifiedAt
  probe.status = "awaiting_landlord"
  if (firstOffer) probe.landlordNotifiedAt = new Date().toISOString()

  delete intake.awaiting_vendor_probe
  await supabase
    .from("sms_conversations")
    .update({ intake_state: intake, updated_at: new Date().toISOString() })
    .eq("id", params.conversationId)

  const host = await loadLandlordProbeConversation(
    supabase,
    probe.landlordId,
    probe.ticketId,
  )
  if (host) {
    await saveProbeOnLandlordThread(supabase, host.conversationId, host.intake, probe)
  }

  await recordActivityLog(supabase, {
    landlordId: probe.landlordId,
    eventType: "maintenance.vendor_probe_offer",
    source: "sms",
    actorType: "vendor",
    actorId: vendorId,
    vendorId,
    maintenanceRequestId: probe.ticketId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    metadata: {
      message: `${vendorName} offered ${windowLabel} for ${wo}.`,
      window_label: windowLabel,
      estimate_note: estimateNote,
    },
  })

  // First offer (or refreshed set) → ask landlord to authorize one vendor.
  await notifyLandlordOfProbeOffers(supabase, probe)

  return {
    handled: true,
    replyBody: buildVendorProbeAckSms({ windowLabel, workOrderRef: wo }),
  }
}

/** Look up a stored probe offer for the vendor the landlord just picked. */
export async function findProbeOfferForVendor(
  supabase: SupabaseClient,
  ticketId: string,
  vendorId: string,
): Promise<VendorProbeOffer | null> {
  const probe = await loadVendorAvailabilityProbeForTicket(supabase, ticketId)
  if (!probe) return null
  return probe.offers.find((o) => o.vendorId === vendorId) ?? null
}

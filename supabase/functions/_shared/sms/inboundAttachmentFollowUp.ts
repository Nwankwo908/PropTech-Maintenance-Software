/**
 * Resident photos and videos that arrive after intake, or with no caption.
 * One message, one outcome: attach, ask which repair, or acknowledge receipt.
 * Staff takeover saves the file and does not text back.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  buildAttachmentAddedAck,
  buildAttachmentChoiceAck,
  buildAttachmentReceivedAck,
  decideFollowUpAttachment,
  mergeAttachmentPaths,
  type FollowUpRepair,
} from "../../../../shared/sms/attachmentFollowUp.ts"
import { isStorageMediaPath } from "./media.ts"
import { phoneLookupVariants } from "./inbound_db.ts"
import { isActiveMaintenanceTicketStatus } from "./maintenanceTicketContext.ts"
import { inboundIsEmergency } from "./staffReplyPending.ts"
import { parseTenantRentReply } from "./tenantRentReplyParse.ts"
import { classifyTenantComplianceKeyword } from "./tenantMessaging.ts"
import type {
  InboundSmsHandlerContext,
  InboundSmsHandlerResult,
} from "./inboundHandlerTypes.ts"

const CHOICE_KEY = "pending_attachment_choice"
const PENDING_PHOTO_KEY = "pending_attachment_repair_id"

type ChoiceState = {
  repairIds: string[]
  mediaPaths: string[]
}

function storagePaths(urls: string[]): string[] {
  return urls.map((url) => url.trim()).filter((url) => isStorageMediaPath(url))
}

function repairLabel(row: { description?: string | null; issue_headline?: string | null }): string {
  const headline = (row.issue_headline ?? "").trim()
  if (headline) return headline.slice(0, 80)
  const first = (row.description ?? "").trim().split("\n")[0]?.trim() ?? ""
  return first.slice(0, 80) || "Repair"
}

function readChoice(intake: Record<string, unknown>): ChoiceState | null {
  const raw = intake[CHOICE_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const repairIds = Array.isArray(obj.repairIds)
    ? obj.repairIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : []
  const mediaPaths = Array.isArray(obj.mediaPaths)
    ? obj.mediaPaths.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : []
  if (repairIds.length < 2 || mediaPaths.length === 0) return null
  return { repairIds, mediaPaths }
}

function explicitOtherReply(body: string): boolean {
  if (classifyTenantComplianceKeyword(body)) return true
  if (parseTenantRentReply(body)) return true
  return /^(yes|y|no|n|questions)[.!]?$/i.test(body.trim())
}

async function loadRepairs(
  supabase: SupabaseClient,
  landlordId: string,
  residentId: string | null,
  phone: string,
  conversationRepairId: string | null,
): Promise<FollowUpRepair[]> {
  const variants = phoneLookupVariants(phone)
  const rows = new Map<string, FollowUpRepair>()
  const absorb = (data: unknown) => {
    if (!Array.isArray(data)) return
    for (const raw of data) {
      if (!raw || typeof raw !== "object") continue
      const row = raw as {
        id?: string
        description?: string | null
        issue_headline?: string | null
        vendor_work_status?: string | null
        landlord_id?: string | null
      }
      if (!row.id || row.landlord_id && row.landlord_id !== landlordId) continue
      rows.set(row.id, {
        id: row.id,
        label: repairLabel(row),
        open: isActiveMaintenanceTicketStatus(row.vendor_work_status),
      })
    }
  }

  if (residentId) {
    const { data } = await supabase
      .from("maintenance_requests")
      .select("id, description, issue_headline, vendor_work_status, landlord_id")
      .eq("landlord_id", landlordId)
      .or(`resident_user_id.eq.${residentId},resident_id.eq.${residentId}`)
      .order("created_at", { ascending: false })
      .limit(12)
    absorb(data)
  }
  if (variants.length > 0) {
    const { data } = await supabase
      .from("maintenance_requests")
      .select("id, description, issue_headline, vendor_work_status, landlord_id")
      .eq("landlord_id", landlordId)
      .in("resident_phone", variants)
      .order("created_at", { ascending: false })
      .limit(12)
    absorb(data)
  }
  if (conversationRepairId && !rows.has(conversationRepairId)) {
    const { data } = await supabase
      .from("maintenance_requests")
      .select("id, description, issue_headline, vendor_work_status, landlord_id")
      .eq("id", conversationRepairId)
      .eq("landlord_id", landlordId)
      .maybeSingle()
    if (data) absorb([data])
  }
  return [...rows.values()]
}

async function appendToRepair(
  supabase: SupabaseClient,
  landlordId: string,
  repairId: string,
  paths: string[],
): Promise<{ ok: boolean; added: number }> {
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("photo_paths, landlord_id")
    .eq("id", repairId)
    .eq("landlord_id", landlordId)
    .maybeSingle()
  if (error || !data || data.landlord_id !== landlordId) {
    return { ok: false, added: 0 }
  }
  const existing = Array.isArray(data.photo_paths)
    ? data.photo_paths.filter((item): item is string => typeof item === "string")
    : []
  const next = mergeAttachmentPaths(existing, paths)
  if (next.length === existing.length) return { ok: true, added: 0 }
  const { error: updateError } = await supabase
    .from("maintenance_requests")
    .update({ photo_paths: next })
    .eq("id", repairId)
    .eq("landlord_id", landlordId)
  if (updateError) return { ok: false, added: 0 }
  return { ok: true, added: next.length - existing.length }
}

export async function tryInboundAttachmentFollowUp(
  ctx: InboundSmsHandlerContext,
  options?: { sendReply?: boolean },
): Promise<InboundSmsHandlerResult> {
  const sendReply = options?.sendReply !== false
  const incoming = storagePaths(ctx.inbound.mediaUrls)
  if (incoming.length === 0 && !ctx.inbound.body.trim()) {
    // A blank text with no file is not an attachment. Media URLs that failed
    // to rehost still count so the resident is not left in silence.
  }
  const mediaCount = ctx.inbound.mediaUrls.filter((url) => url.trim()).length
  if (mediaCount === 0) {
    const { data: peek } = await ctx.supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", ctx.conversationId)
      .eq("landlord_id", ctx.landlordId)
      .maybeSingle()
    const intake = peek?.intake_state && typeof peek.intake_state === "object"
      ? peek.intake_state as Record<string, unknown>
      : {}
    if (!readChoice(intake)) return { handled: false }
  }

  const { data: conv } = await ctx.supabase
    .from("sms_conversations")
    .select("intake_state, maintenance_request_id")
    .eq("id", ctx.conversationId)
    .eq("landlord_id", ctx.landlordId)
    .maybeSingle()
  const intake = conv?.intake_state && typeof conv.intake_state === "object"
    ? { ...(conv.intake_state as Record<string, unknown>) }
    : {}
  const step = typeof intake.step === "string" ? intake.step : ""
  const intakeActive = Boolean(step && step !== "submitted")
  const pendingPhoto = typeof intake[PENDING_PHOTO_KEY] === "string"
    ? intake[PENDING_PHOTO_KEY].trim()
    : ""
  const repairs = await loadRepairs(
    ctx.supabase,
    ctx.landlordId,
    ctx.identity.resident_id,
    ctx.inbound.from,
    typeof conv?.maintenance_request_id === "string" ? conv.maintenance_request_id : null,
  )
  const pendingIsOpen = pendingPhoto
    ? repairs.some((repair) => repair.id === pendingPhoto && repair.open)
    : false

  const decision = decideFollowUpAttachment({
    mediaCount,
    body: ctx.inbound.body,
    repairs,
    pendingPhotoRepairId: pendingIsOpen ? pendingPhoto : null,
    awaitingChoice: readChoice(intake),
    intakeActive,
    explicitOtherWorkflowReply: explicitOtherReply(ctx.inbound.body),
    emergency: inboundIsEmergency(ctx.inbound.body),
  })

  if (decision.action === "skip") return { handled: false }

  const paths = decision.action === "attach" && decision.mediaPaths.length > 0
    ? decision.mediaPaths
    : incoming

  if (decision.action === "attach") {
    const saved = await appendToRepair(ctx.supabase, ctx.landlordId, decision.repairId, paths)
    const repair = repairs.find((row) => row.id === decision.repairId)
    delete intake[CHOICE_KEY]
    await ctx.supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", ctx.conversationId)
      .eq("landlord_id", ctx.landlordId)
    if (saved.ok) {
      await recordActivityLog(ctx.supabase, {
        landlordId: ctx.landlordId,
        eventType: "maintenance.attachment_added",
        source: "sms",
        actorType: "resident",
        residentId: ctx.identity.resident_id,
        maintenanceRequestId: decision.repairId,
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        metadata: {
          message: saved.added > 0
            ? "Added the resident's file to the repair."
            : "The resident's file was already on the repair.",
          added: saved.added,
        },
      })
    }
    const body = saved.ok
      ? buildAttachmentAddedAck({
        count: Math.max(paths.length, 1),
        repairLabel: repair?.label ? `the ${repair.label}` : "that repair",
      })
      : buildAttachmentReceivedAck(Math.max(paths.length, 1))
    return {
      handled: true,
      workflowRoute: "attachment_follow_up",
      maintenanceRequestId: decision.repairId,
      reply: sendReply
        ? { body, source: "attachment_follow_up", skipGenericFallback: true }
        : undefined,
    }
  }

  if (decision.action === "ask") {
    const mediaPaths = mergeAttachmentPaths(decision.mediaPaths, incoming)
    intake[CHOICE_KEY] = { repairIds: decision.repairIds, mediaPaths }
    await ctx.supabase
      .from("sms_conversations")
      .update({ intake_state: intake, updated_at: new Date().toISOString() })
      .eq("id", ctx.conversationId)
      .eq("landlord_id", ctx.landlordId)
    return {
      handled: true,
      workflowRoute: "attachment_follow_up",
      reply: sendReply
        ? {
          body: buildAttachmentChoiceAck({
            count: Math.max(mediaPaths.length, 1),
            repairs,
            repairIds: decision.repairIds,
          }),
          source: "attachment_follow_up",
          skipGenericFallback: true,
        }
        : undefined,
    }
  }

  return {
    handled: true,
    workflowRoute: "attachment_follow_up",
    reply: sendReply
      ? {
        body: buildAttachmentReceivedAck(Math.max(incoming.length, mediaCount, 1)),
        source: "attachment_follow_up",
        skipGenericFallback: true,
      }
      : undefined,
  }
}

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getEstimatedMinutes } from "../sla_rules.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { updateWorkflowRun } from "../engine/workflowRuns.ts"
import { startMaintenanceRequestWorkflow } from "../engine/startMaintenanceRequestWorkflow.ts"
import { assignVendorAndNotify } from "../../submit-maintenance-request/vendor_notify.ts"
import { notifyResidentSubmitted } from "../../submit-maintenance-request/resident_notify.ts"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"
import {
  buildIntakeDescription,
  resolveIntakeIssueCategory,
  severityToDb,
} from "./residentIntakeTypes.ts"
import { issueCategoryToVendorTrade } from "../vendor_trades.ts"

type ResidentRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  unit: string | null
}

function notificationChannelFromPreference(
  pref: string | undefined,
): "email" | "sms" | "both" {
  const p = (pref ?? "").trim().toLowerCase()
  if (p === "email") return "email"
  if (p === "text" || p === "sms") return "sms"
  return "both"
}

function extFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes("png")) return "png"
  if (ct.includes("gif")) return "gif"
  if (ct.includes("webp")) return "webp"
  if (ct.includes("heic")) return "heic"
  if (ct.includes("heif")) return "heif"
  return "jpg"
}

/**
 * Download SMS/MMS media and rehost into the private `maintenance-uploads`
 * bucket so it renders through the same signed-URL path as web uploads.
 * Best-effort: any failing item is skipped and never blocks submission.
 * Twilio media requires Basic Auth; Telnyx URLs are fetched directly.
 */
async function rehostSmsPhotos(
  supabase: SupabaseClient,
  ticketId: string,
  mediaUrls: string[] | undefined,
  provider: string | undefined,
): Promise<string[]> {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return []

  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim()
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim()
  const paths: string[] = []
  let idx = 0

  for (const rawUrl of mediaUrls) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) continue
    const url = rawUrl.trim()
    try {
      const headers: Record<string, string> = {}
      const isTwilio = provider === "twilio" || url.includes("api.twilio.com")
      if (isTwilio && twilioSid && twilioToken) {
        headers.Authorization = `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`
      }

      const res = await fetch(url, { headers })
      if (!res.ok) {
        console.error("[sms-intake] media fetch failed", url, res.status)
        continue
      }

      const contentType = res.headers.get("content-type") || "image/jpeg"
      if (!contentType.toLowerCase().startsWith("image/")) {
        console.warn("[sms-intake] skipping non-image media", url, contentType)
        continue
      }

      const bytes = new Uint8Array(await res.arrayBuffer())
      const path = `sms/${ticketId}/${Date.now()}-${idx}.${extFromContentType(contentType)}`
      const { error } = await supabase.storage
        .from("maintenance-uploads")
        .upload(path, bytes, { contentType, upsert: false })

      if (error) {
        console.error("[sms-intake] media upload failed", path, error.message)
        continue
      }

      paths.push(path)
      idx += 1
    } catch (e) {
      console.error("[sms-intake] media rehost error", url, e)
    }
  }

  return paths
}

async function resolveExistingDraftTicketId(
  supabase: SupabaseClient,
  conversationId: string,
  intake: SmsIntakeState,
): Promise<string | null> {
  const fromIntake = intake.draft_ticket_id?.trim()
  if (fromIntake) return fromIntake

  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("maintenance_request_id")
    .eq("id", conversationId)
    .maybeSingle()

  const linked =
    typeof convo?.maintenance_request_id === "string"
      ? convo.maintenance_request_id.trim()
      : ""
  if (!linked) return null

  // Only reuse if still an open unassigned draft (not a prior completed job).
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("id, vendor_work_status")
    .eq("id", linked)
    .maybeSingle()

  const status = String(ticket?.vendor_work_status ?? "").toLowerCase()
  if (ticket?.id && (status === "unassigned" || status === "")) {
    return ticket.id as string
  }
  return null
}

export async function submitSmsMaintenanceRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    residentId: string
    intake: SmsIntakeState
  },
): Promise<{ ticketId: string }> {
  const { data: resident, error: residentErr } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit")
    .eq("id", params.residentId)
    .maybeSingle()

  if (residentErr || !resident) {
    console.error("[sms-intake] resident lookup failed", residentErr?.message)
    throw new Error("Could not load resident for maintenance request")
  }

  const row = resident as ResidentRow
  const unit = row.unit?.trim()
  if (!unit) {
    throw new Error("Resident has no unit assigned")
  }

  const priority = params.intake.urgency?.trim() || "normal"
  const issueCategory = issueCategoryToVendorTrade(
    resolveIntakeIssueCategory(params.intake),
  )
  const dbSeverity = severityToDb(params.intake.severity)
  const estimatedMinutes = getEstimatedMinutes(issueCategory, dbSeverity)
  const dueAt = new Date(Date.now() + estimatedMinutes * 60_000)
  const description = buildIntakeDescription(params.intake)
  const notificationChannel = notificationChannelFromPreference(
    params.intake.preferred_contact_method,
  )

  const ticketFields = {
    landlord_id: params.landlordId,
    priority,
    urgency: priority,
    resident_name: row.full_name?.trim() || "Resident",
    email: row.email?.trim() || `${params.residentId}@sms-resident.ulohome.local`,
    resident_phone: row.phone,
    resident_notification_channel: notificationChannel,
    unit,
    description,
    resident_user_id: null as string | null,
    issue_category: issueCategory,
    severity: dbSeverity,
    estimated_minutes: estimatedMinutes,
    due_at: dueAt.toISOString(),
    vendor_work_status: "unassigned",
  }

  const existingTicketId = await resolveExistingDraftTicketId(
    supabase,
    params.conversationId,
    params.intake,
  )

  let ticketId: string
  let created = false

  if (existingTicketId) {
    const { error: updateErr } = await supabase
      .from("maintenance_requests")
      .update(ticketFields)
      .eq("id", existingTicketId)

    if (updateErr) {
      console.error("[sms-intake] maintenance_requests update", updateErr.message)
      throw new Error("Failed to finalize maintenance request")
    }
    ticketId = existingTicketId
  } else {
    const { data: ticket, error: insertErr } = await supabase
      .from("maintenance_requests")
      .insert({
        ...ticketFields,
        photo_paths: [],
      })
      .select("id")
      .single()

    if (insertErr || !ticket?.id) {
      console.error("[sms-intake] maintenance_requests insert", insertErr?.message)
      throw new Error("Failed to create maintenance request")
    }
    ticketId = ticket.id as string
    created = true
  }

  let photoPaths: string[] = []
  try {
    photoPaths = await rehostSmsPhotos(
      supabase,
      ticketId,
      params.intake.photo_urls,
      params.intake.photo_provider,
    )
    if (photoPaths.length > 0) {
      const { error: photoErr } = await supabase
        .from("maintenance_requests")
        .update({ photo_paths: photoPaths })
        .eq("id", ticketId)
      if (photoErr) {
        console.error("[sms-intake] photo_paths update failed", photoErr.message)
      }
    }
  } catch (e) {
    console.error("[sms-intake] photo rehost failed", e)
  }

  await supabase
    .from("sms_conversations")
    .update({
      maintenance_request_id: ticketId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  const { data: conversation } = await supabase
    .from("sms_conversations")
    .select("workflow_run_id")
    .eq("id", params.conversationId)
    .maybeSingle()

  const intakeRunId = conversation?.workflow_run_id ?? null

  if (intakeRunId) {
    await updateWorkflowRun(supabase, intakeRunId, {
      status: "completed",
      currentStep: "submitted",
      entityType: "maintenance_request",
      entityId: ticketId,
      completedAt: new Date().toISOString(),
      metadata: {
        intake_state: params.intake as Record<string, unknown>,
        submitted_at: new Date().toISOString(),
        early_ticket: !created,
      },
      pipelineStage: "act",
      eventMessage: created
        ? "Ticket created from SMS intake"
        : "Early SMS ticket finalized from intake",
      eventStep: "submitted",
    })
  }

  const descPrev =
    description.length > 200 ? `${description.slice(0, 197)}…` : description

  try {
    await notifyResidentSubmitted(supabase, {
      ticketId,
      recipientName: row.full_name?.trim() || "Resident",
      recipientEmail: row.email,
      recipientPhone: row.phone,
      notificationChannel,
      unit,
      priority,
      descriptionPreview: descPrev,
    })
  } catch (e) {
    console.error("[sms-intake] resident notify failed", e)
  }

  let vendorAssigned = false
  try {
    const assignResult = await assignVendorAndNotify(supabase, {
      ticketId,
      priority,
      unit,
      description,
      dueAt: dueAt.toISOString(),
      estimatedMinutes,
      landlordId: params.landlordId,
    })
    vendorAssigned = assignResult.assigned
  } catch (e) {
    console.error("[sms-intake] vendor notify failed", e)
  }

  let maintenanceWorkflowRunId: string | null = null
  try {
    const started = await startMaintenanceRequestWorkflow(supabase, {
      landlordId: params.landlordId,
      ticketId,
      residentId: params.residentId,
      triggerType: "sms_inbound",
      dueAt: dueAt.toISOString(),
      issueCategory,
      severity: dbSeverity,
      unitLabel: unit,
      source: "sms_intake",
      intakeRunId,
      conversationId: params.conversationId,
      vendorAssigned,
    })
    maintenanceWorkflowRunId = started.workflowRunId
  } catch (e) {
    console.error("[sms-intake] maintenance_request workflow", e)
  }

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.request_submitted",
    source: "sms",
    actor_type: "resident",
    actor_id: params.residentId,
    resident_id: params.residentId,
    maintenance_request_id: ticketId,
    conversation_id: params.conversationId,
    workflow_run_id: maintenanceWorkflowRunId ?? intakeRunId,
    workflow_template_id: maintenanceWorkflowRunId
      ? "maintenance_request"
      : "maintenance_intake",
    metadata: {
      unit,
      priority,
      issue_category: issueCategory,
      severity: dbSeverity,
      issue_type: params.intake.issue_type,
      room_or_area: params.intake.room_or_area,
      preferred_contact_method: params.intake.preferred_contact_method,
      photo_count: photoPaths.length,
      source: "sms_intake",
      early_ticket_finalized: !created,
    },
  })

  console.info("[sms-intake] maintenance request submitted", {
    ticketId,
    conversationId: params.conversationId,
    residentId: params.residentId,
    unit,
    priority,
    issueCategory,
    earlyTicketFinalized: !created,
  })

  return { ticketId }
}

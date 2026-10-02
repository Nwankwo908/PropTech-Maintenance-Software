/**
 * Remediates orphaned maintenance tickets (row exists, no maintenance_request run,
 * dispatch never ran). Used by the remediate-maintenance-ticket Edge Function and
 * any future backfill that mints tickets outside SMS/web submit.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { dispatchConfirmedMaintenanceTicket } from "./confirmedMaintenanceDispatch.ts"
import { startMaintenanceRequestWorkflow } from "./engine/startMaintenanceRequestWorkflow.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { sendInboundAutoReply } from "./sms/inboundReply.ts"
import {
  findActiveLandlordMainNumber,
  landlordSmsRowFromNumber,
} from "./sms/landlordSmsOnboarding.ts"

export type RemediateMaintenanceTicketInput = {
  ticketId: string
  /** When set, send this body to the resident before vendor matching. */
  residentCloseLoopSms?: string | null
  /** Skip vendor matching / probe (workflow + optional SMS only). */
  skipDispatch?: boolean
}

export type RemediateMaintenanceTicketResult = {
  ok: boolean
  ticketId: string
  workflowRunId: string | null
  workflowCreated: boolean
  residentSmsSent: boolean
  residentSmsError?: string
  dispatchKind?: string
  vendorAssigned?: boolean
  error?: string
}

function firstName(fullName: string | null | undefined): string {
  const part = String(fullName ?? "").trim().split(/\s+/)[0]
  return part || "there"
}

/** Default close-the-loop copy when a ticket sat without resident update. */
export function buildOrphanTicketCloseLoopSms(params: {
  residentName?: string | null
  issueLabel?: string | null
}): string {
  const name = firstName(params.residentName)
  const issue = (params.issueLabel ?? "the repair").trim() || "the repair"
  return [
    `Hi ${name},`,
    "",
    "This is the property management team.",
    "",
    `Sorry for the delay getting back to you about ${issue}. We've opened the work order and are matching a vendor now — we'll text you as soon as we have a visit window to confirm.`,
    "",
    "Thank you for your patience.",
  ].join("\n")
}

export async function remediateOrphanedMaintenanceTicket(
  supabase: SupabaseClient,
  input: RemediateMaintenanceTicketInput,
): Promise<RemediateMaintenanceTicketResult> {
  const ticketId = input.ticketId.trim()
  if (!ticketId) {
    return {
      ok: false,
      ticketId: "",
      workflowRunId: null,
      workflowCreated: false,
      residentSmsSent: false,
      error: "missing_ticket_id",
    }
  }

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, property_id, unit_id, unit, resident_user_id, resident_name, resident_phone, issue_category, issue_headline, description, vendor_work_status, assigned_vendor_id, due_at, priority, urgency, estimated_minutes",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (tErr || !ticket?.id) {
    return {
      ok: false,
      ticketId,
      workflowRunId: null,
      workflowCreated: false,
      residentSmsSent: false,
      error: tErr?.message ?? "ticket_not_found",
    }
  }

  const landlordId = String(ticket.landlord_id ?? "").trim()
  if (!landlordId) {
    return {
      ok: false,
      ticketId,
      workflowRunId: null,
      workflowCreated: false,
      residentSmsSent: false,
      error: "ticket_missing_landlord",
    }
  }

  // Resolve conversation for SMS + workflow metadata.
  let conversationId: string | null = null
  let residentId =
    typeof ticket.resident_user_id === "string" && ticket.resident_user_id.trim()
      ? ticket.resident_user_id.trim()
      : null

  const { data: convByTicket } = await supabase
    .from("sms_conversations")
    .select("id, resident_id, external_phone_number")
    .eq("maintenance_request_id", ticketId)
    .eq("conversation_type", "resident_intake")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (convByTicket?.id) {
    conversationId = String(convByTicket.id)
    if (!residentId && convByTicket.resident_id) {
      residentId = String(convByTicket.resident_id)
    }
  }

  if (!residentId && ticket.resident_phone) {
    const { data: byPhone } = await supabase
      .from("users")
      .select("id")
      .eq("landlord_id", landlordId)
      .eq("phone", ticket.resident_phone)
      .limit(1)
      .maybeSingle()
    if (byPhone?.id) residentId = String(byPhone.id)
  }

  // Heal missing resident_user_id so later lookups stay scoped.
  if (residentId && !ticket.resident_user_id) {
    await supabase
      .from("maintenance_requests")
      .update({ resident_user_id: residentId })
      .eq("id", ticketId)
      .is("resident_user_id", null)
  }

  const { data: existingRun } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("template_id", "maintenance_request")
    .eq("entity_type", "maintenance_request")
    .eq("entity_id", ticketId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let workflowRunId = existingRun?.id ? String(existingRun.id) : null
  let workflowCreated = false

  if (!workflowRunId) {
    const dueAt =
      (typeof ticket.due_at === "string" && ticket.due_at) ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const issueCategory =
      (typeof ticket.issue_category === "string" && ticket.issue_category.trim()) ||
      "general"
    const severity =
      (typeof ticket.urgency === "string" && ticket.urgency.trim()) ||
      (typeof ticket.priority === "string" && ticket.priority.trim()) ||
      "normal"
    const vendorAssigned = Boolean(ticket.assigned_vendor_id) ||
      String(ticket.vendor_work_status ?? "").toLowerCase() === "pending_accept"

    try {
      const started = await startMaintenanceRequestWorkflow(supabase, {
        landlordId,
        ticketId,
        residentId,
        unitId: ticket.unit_id == null ? null : String(ticket.unit_id),
        propertyId: ticket.property_id == null ? null : String(ticket.property_id),
        triggerType: "automation",
        dueAt,
        issueCategory,
        severity,
        unitLabel: ticket.unit == null ? null : String(ticket.unit),
        source: "backfill",
        conversationId,
        vendorAssigned,
        needsVendorEscalation: !vendorAssigned,
      })
      workflowRunId = started.workflowRunId
      workflowCreated = Boolean(workflowRunId)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        ticketId,
        workflowRunId: null,
        workflowCreated: false,
        residentSmsSent: false,
        error: `workflow_start_failed:${message}`,
      }
    }
  }

  let residentSmsSent = false
  let residentSmsError: string | undefined
  const smsBody = input.residentCloseLoopSms?.trim() || null
  if (smsBody) {
    const toPhone =
      (typeof ticket.resident_phone === "string" && ticket.resident_phone.trim()) ||
      (convByTicket?.external_phone_number
        ? String(convByTicket.external_phone_number)
        : "")
    if (!conversationId || !toPhone) {
      residentSmsError = "missing_conversation_or_phone"
    } else {
      const line = await findActiveLandlordMainNumber(supabase, landlordId)
      const fromNumber = landlordSmsRowFromNumber(line)
      if (!fromNumber) {
        residentSmsError = "no_landlord_main_sms"
      } else {
        const sent = await sendInboundAutoReply(supabase, {
          conversationId,
          landlordId,
          fromNumber,
          toNumber: toPhone,
          body: smsBody,
          provider: ((line?.provider as "twilio" | "telnyx") || "twilio"),
          source: "orphan_ticket_close_loop",
        })
        residentSmsSent = sent.ok
        if (!sent.ok) residentSmsError = sent.error ?? "sms_send_failed"
        else {
          await supabase
            .from("sms_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
          try {
            await recordActivityLog(supabase, {
              landlordId,
              eventType: "maintenance.resident_close_loop_sent",
              source: "automation",
              actorType: "system",
              residentId,
              propertyId: ticket.property_id == null
                ? null
                : String(ticket.property_id),
              unitId: ticket.unit_id == null ? null : String(ticket.unit_id),
              maintenanceRequestId: ticketId,
              conversationId,
              workflowRunId,
              workflowTemplateId: "maintenance_request",
              metadata: {
                message:
                  "Told the resident the repair is open and a vendor is being matched.",
              },
            })
          } catch (e) {
            console.error("[remediate-ticket] activity log close-loop", e)
          }
        }
      }
    }
  }

  let dispatchKind: string | undefined
  let vendorAssignedOut = Boolean(ticket.assigned_vendor_id)
  if (!input.skipDispatch && !vendorAssignedOut) {
    const description = String(ticket.description ?? ticket.issue_headline ?? "")
    const unit = ticket.unit == null ? null : String(ticket.unit)
    const priority =
      (typeof ticket.priority === "string" && ticket.priority.trim()) || "normal"
    const dueAt =
      (typeof ticket.due_at === "string" && ticket.due_at) ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const estimatedMinutes =
      typeof ticket.estimated_minutes === "number" &&
        Number.isFinite(ticket.estimated_minutes)
        ? ticket.estimated_minutes
        : 60

    try {
      const outcome = await dispatchConfirmedMaintenanceTicket(supabase, {
        ticketId,
        priority,
        unit,
        description,
        dueAt,
        estimatedMinutes,
        landlordId,
      })
      dispatchKind = outcome.kind
      vendorAssignedOut = outcome.vendorAssigned
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      dispatchKind = "dispatch_error"
      return {
        ok: false,
        ticketId,
        workflowRunId,
        workflowCreated,
        residentSmsSent,
        residentSmsError,
        dispatchKind,
        vendorAssigned: false,
        error: `dispatch_failed:${message}`,
      }
    }
  }

  try {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "maintenance.orphan_ticket_remediated",
      source: "automation",
      actorType: "system",
      residentId,
      propertyId: ticket.property_id == null ? null : String(ticket.property_id),
      unitId: ticket.unit_id == null ? null : String(ticket.unit_id),
      maintenanceRequestId: ticketId,
      conversationId,
      workflowRunId,
      workflowTemplateId: "maintenance_request",
      metadata: {
        message: workflowCreated
          ? "Started the maintenance workflow for a ticket that had no Active Tasks run."
          : "Re-ran dispatch for an existing maintenance workflow.",
        workflow_created: workflowCreated,
        resident_sms_sent: residentSmsSent,
        dispatch_kind: dispatchKind ?? null,
      },
    })
  } catch (e) {
    console.error("[remediate-ticket] activity log remediated", e)
  }

  return {
    ok: true,
    ticketId,
    workflowRunId,
    workflowCreated,
    residentSmsSent,
    residentSmsError,
    dispatchKind,
    vendorAssigned: vendorAssignedOut,
  }
}

/**
 * Property team records a visit they already agreed with the resident.
 * Locks the schedule, closes open asks, and texts the vendor once.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { closeOpenAsksForTicket } from "../closeOpenAsksForTicket.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { uloAppUrl } from "../uloAppUrl.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"
import {
  buildManualVisitTimeVendorSms,
  vendorJobDecisionFromWorkStatus,
} from "./workOrderAdminStatusSms.ts"

export function composeManualVisitWindow(input: {
  visitDate: string
  windowText: string
}): { scheduledAt: string; scheduledWindowText: string } | { error: string } {
  const day = input.visitDate.trim()
  const windowText = input.windowText.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { error: "Choose a visit date." }
  }
  if (!windowText) return { error: "Enter an arrival window." }
  const scheduledAt = new Date(`${day}T16:00:00.000Z`)
  if (Number.isNaN(scheduledAt.getTime())) return { error: "Choose a visit date." }
  return {
    scheduledAt: scheduledAt.toISOString(),
    scheduledWindowText: `${day} ${windowText}`,
  }
}

export async function setManualVisitTime(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    visitDate: string
    windowText: string
  },
  deps?: {
    sendVendor?: (input: {
      ticketId: string
      vendorId: string
      vendorPhone: string
      body: string
      landlordId: string
    }) => Promise<{ ok: boolean }>
  },
): Promise<
  | { ok: true; scheduledAt: string; scheduledWindowText: string; vendorTexted: boolean }
  | { ok: false; error: string; status: number }
> {
  const composed = composeManualVisitWindow(params)
  if ("error" in composed) return { ok: false, error: composed.error, status: 400 }

  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, vendor_work_status, vendor_action_token",
    )
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  if (error || !ticket) {
    return { ok: false, error: "Work order not found", status: 404 }
  }

  const nowIso = new Date().toISOString()
  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({
      scheduled_at: composed.scheduledAt,
      scheduled_window_text: composed.scheduledWindowText,
      schedule_status: "scheduled",
      schedule_confirmed_at: nowIso,
      resident_confirmation_status: "confirmed",
      resident_confirmed_at: nowIso,
    })
    .eq("id", params.ticketId)

  if (upErr) {
    return { ok: false, error: upErr.message, status: 500 }
  }

  await closeOpenAsksForTicket(supabase, params.ticketId, "manual_visit_time")

  const vendorId =
    typeof ticket.assigned_vendor_id === "string"
      ? ticket.assigned_vendor_id.trim()
      : ""
  const decision = vendorJobDecisionFromWorkStatus(
    typeof ticket.vendor_work_status === "string" ? ticket.vendor_work_status : null,
  )
  let vendorTexted = false
  if (vendorId && decision !== "declined") {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name, phone")
      .eq("id", vendorId)
      .maybeSingle()
    const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
    const token =
      typeof ticket.vendor_action_token === "string"
        ? ticket.vendor_action_token.trim()
        : ""
    const body = buildManualVisitTimeVendorSms({
      vendorName: typeof vendor?.name === "string" ? vendor.name : "",
      workOrderRef: formatWorkOrderRef(params.ticketId),
      windowText: composed.scheduledWindowText,
      vendorDecision: decision,
      jobLink: token ? uloAppUrl.workOrder(token, { fallback: "" }) : null,
    })
    if (body && phone) {
      const send = deps?.sendVendor ?? (async (input) => {
        const { sendVendorJobAlert } = await import("./vendorSmsRouting.ts")
        return sendVendorJobAlert(supabase, input)
      })
      const alert = await send({
        ticketId: params.ticketId,
        vendorId,
        vendorPhone: phone,
        body,
        landlordId: params.landlordId,
      })
      vendorTexted = alert.ok
    }
  }

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.visit_time_set",
    source: "dashboard",
    actorType: "landlord",
    vendorId: vendorId || null,
    maintenanceRequestId: params.ticketId,
    metadata: {
      message: `Visit set for ${composed.scheduledWindowText}.`,
      scheduled_at: composed.scheduledAt,
      scheduled_window_text: composed.scheduledWindowText,
      vendor_texted: vendorTexted,
    },
  }).catch(() => {})

  return {
    ok: true,
    scheduledAt: composed.scheduledAt,
    scheduledWindowText: composed.scheduledWindowText,
    vendorTexted,
  }
}

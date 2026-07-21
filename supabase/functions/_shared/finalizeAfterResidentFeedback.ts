/**
 * After resident rates a repair, finalize completion (both ends) and — on a
 * positive rating — text the landlord invoice payment options.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { notifyLandlordInvoicePaymentOptions } from "./invoicePaymentSms.ts"
import { markMaintenanceJobCompleted } from "./maintenanceSpend.ts"
import { notifyResidentCompleted } from "../submit-maintenance-request/resident_notify.ts"

const POSITIVE_RATING_MIN = 4

export async function finalizeJobAfterResidentFeedback(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
    rating: number
  },
): Promise<void> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, resident_name, email, resident_phone, resident_notification_channel, priority, vendor_work_status, assigned_vendor_id, completion_photo_paths, landlord_id",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (error || !ticket) {
    console.error(
      "[finalize-feedback] load ticket",
      error?.message ?? "missing",
    )
    return
  }

  const current = String(ticket.vendor_work_status ?? "")
  if (current !== "completed") {
    const { error: upErr } = await supabase
      .from("maintenance_requests")
      .update({ vendor_work_status: "completed" })
      .eq("id", params.ticketId)
    if (upErr) {
      console.error("[finalize-feedback] set completed", upErr.message)
      return
    }
    try {
      await markMaintenanceJobCompleted(supabase, params.ticketId)
    } catch (e) {
      console.error("[finalize-feedback] markMaintenanceJobCompleted", e)
    }

    try {
      await supabase.from("vendor_status_events").insert({
        ticket_id: params.ticketId,
        from_status: current || "in_progress",
        to_status: "completed",
        source: "resident_feedback",
        vendor_id: params.vendorId,
      })
    } catch (e) {
      console.error("[finalize-feedback] status event", e)
    }
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name")
    .eq("id", params.vendorId)
    .maybeSingle()
  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "Vendor"

  const photoCount = Array.isArray(ticket.completion_photo_paths)
    ? (ticket.completion_photo_paths as string[]).filter(
      (p) => typeof p === "string" && p.trim(),
    ).length
    : 0

  try {
    await notifyResidentCompleted(supabase, {
      ticketId: params.ticketId,
      recipientName: String(ticket.resident_name ?? ""),
      recipientEmail: typeof ticket.email === "string" ? ticket.email.trim() : "",
      recipientPhone:
        typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
      notificationChannel:
        typeof ticket.resident_notification_channel === "string"
          ? ticket.resident_notification_channel
          : null,
      unit: typeof ticket.unit === "string" ? ticket.unit : undefined,
      priority: typeof ticket.priority === "string" ? ticket.priority : undefined,
      vendorName,
      completionPhotoCount: photoCount,
    })
  } catch (e) {
    console.error("[finalize-feedback] resident completed notify", e)
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.work_status_changed",
      source: "sms",
      actor_type: "resident",
      vendor_id: params.vendorId,
      maintenance_request_id: params.ticketId,
      metadata: {
        action: "completed_after_feedback",
        rating: params.rating,
        positive: params.rating >= POSITIVE_RATING_MIN,
      },
    })
  } catch (e) {
    console.error("[finalize-feedback] graph", e)
  }

  // Positive rating → landlord invoice payment options (card / BNPL / ACH).
  if (params.rating < POSITIVE_RATING_MIN) return

  const { data: invoice } = await supabase
    .from("maintenance_invoices")
    .select("id, total_cost")
    .eq("maintenance_request_id", params.ticketId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const totalCost = Number(invoice?.total_cost) || 0
  if (totalCost <= 0) {
    console.info(
      "[finalize-feedback] skip payment SMS — no invoice total",
      params.ticketId,
    )
    return
  }

  try {
    await notifyLandlordInvoicePaymentOptions(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorName,
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
      totalCost,
      invoiceId: typeof invoice?.id === "string" ? invoice.id : null,
    })
  } catch (e) {
    console.error("[finalize-feedback] invoice payment SMS", e)
  }
}

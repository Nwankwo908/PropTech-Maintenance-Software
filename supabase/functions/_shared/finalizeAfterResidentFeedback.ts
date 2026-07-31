/**
 * After resident rates a repair, finalize completion (both ends) and — on a
 * positive rating — ensure the invoice is ready for Needs Your Attention
 * (admin pay / approve). Landlords are alerted by text and/or email.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { notifyLandlordNeedsAttention } from "./landlordAttentionNotify.ts"
import {
  ensureInvoiceFromApprovedEstimate,
  markMaintenanceJobCompleted,
} from "./maintenanceSpend.ts"
import { notifyResidentCompleted } from "../submit-maintenance-request/resident_notify.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"

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

  // Positive rating → ensure invoice exists for Needs Your Attention (+ alert).
  if (params.rating < POSITIVE_RATING_MIN) return

  let invoiceId: string | null = null
  let totalCost = 0
  try {
    const ensured = await ensureInvoiceFromApprovedEstimate(supabase, {
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      source: "sms",
    })
    if ("invoiceId" in ensured) {
      invoiceId = ensured.invoiceId
      totalCost = ensured.totalCost
    } else if ("error" in ensured) {
      console.error("[finalize-feedback] ensure invoice", ensured.error)
    } else {
      console.info(
        "[finalize-feedback] skip invoice attention —",
        ensured.skipped,
        params.ticketId,
      )
    }
  } catch (e) {
    console.error("[finalize-feedback] ensure invoice", e)
  }

  if (!invoiceId || totalCost <= 0) {
    const { data: invoice } = await supabase
      .from("maintenance_invoices")
      .select("id, total_cost")
      .eq("maintenance_request_id", params.ticketId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    invoiceId = typeof invoice?.id === "string" ? invoice.id : null
    totalCost = Number(invoice?.total_cost) || 0
  }

  if (!invoiceId || totalCost <= 0) {
    console.info(
      "[finalize-feedback] no invoice for attention queue",
      params.ticketId,
    )
    return
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.invoice_ready_for_attention",
      source: "sms",
      actor_type: "system",
      vendor_id: params.vendorId,
      maintenance_request_id: params.ticketId,
      metadata: {
        invoice_id: invoiceId,
        total_cost: totalCost,
        rating: params.rating,
        channel: "needs_your_attention",
      },
    })
  } catch (e) {
    console.error("[finalize-feedback] invoice attention graph", e)
  }

  // ensureInvoice may have already notified on create; idempotency covers retries.
  try {
    const unit =
      typeof ticket.unit === "string" && ticket.unit.trim() ? ticket.unit.trim() : ""
    const amount = totalCost.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    })
    await notifyLandlordNeedsAttention(supabase, {
      landlordId: params.landlordId,
      kind: "invoice_ready",
      headline: "Invoice ready to pay",
      detail: `${formatWorkOrderRef(params.ticketId)}${unit ? ` · Unit ${unit}` : ""} · ${vendorName} · ${amount}`,
      idempotencyKey: `invoice:${invoiceId}`,
      maintenanceRequestId: params.ticketId,
      vendorId: params.vendorId,
    })
  } catch (e) {
    console.error("[finalize-feedback] attention notify", e)
  }
}

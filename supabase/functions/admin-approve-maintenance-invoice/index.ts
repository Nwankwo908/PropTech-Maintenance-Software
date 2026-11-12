import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { approveMaintenanceInvoice } from "../_shared/maintenanceSpend.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }


  let body: {
    invoiceId?: string
    landlordId?: string
    action?: string
    rejectionReason?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const invoiceId =
    typeof body.invoiceId === "string" ? body.invoiceId.trim() : ""
  const landlordId =
    typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const action = typeof body.action === "string" ? body.action.trim() : "approve"

  if (!invoiceId || !uuidRe.test(invoiceId)) {
    return jsonResponse({ error: "Missing or invalid invoiceId" }, 400)
  }
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: invoice, error: fetchErr } = await supabase
    .from("maintenance_invoices")
    .select("id, landlord_id, maintenance_request_id, status, metadata")
    .eq("id", invoiceId)
    .eq("landlord_id", landlordId)
    .maybeSingle()
  if (fetchErr) return jsonResponse({ error: "Load invoice failed" }, 500)
  if (!invoice || String(invoice.landlord_id) !== landlordId) {
    return jsonResponse({ error: "Invoice not found" }, 404)
  }
  const { data: ticket, error: ticketErr } = await supabase
    .from("maintenance_requests")
    .select("id, landlord_id")
    .eq("id", invoice.maintenance_request_id)
    .eq("landlord_id", landlordId)
    .maybeSingle()
  if (ticketErr) return jsonResponse({ error: "Load work order failed" }, 500)
  if (!ticket || String(ticket.landlord_id) !== landlordId) {
    return jsonResponse({ error: "Work order not found" }, 404)
  }

  if (action === "reject") {
    const reason =
      typeof body.rejectionReason === "string"
        ? body.rejectionReason.trim()
        : "Rejected by property manager"

    const now = new Date().toISOString()
    const existingMeta =
      invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata)
        ? invoice.metadata as Record<string, unknown>
        : {}

    await supabase
      .from("maintenance_invoices")
      .update({
        status: "rejected",
        rejection_reason: reason,
        updated_at: now,
        metadata: {
          ...existingMeta,
          billing_event: "rejected",
          billing_logged_at: now,
          rejection_reason: reason,
        },
      })
      .eq("id", invoiceId)
      .eq("landlord_id", landlordId)

    await supabase
      .from("maintenance_requests")
      .update({ spend_status: "rejected" })
      .eq("id", invoice.maintenance_request_id)
      .eq("landlord_id", landlordId)

    return jsonResponse({ ok: true, invoiceId, status: "rejected" })
  }

  const result = await approveMaintenanceInvoice(supabase, {
    invoiceId,
    landlordId,
    source: "dashboard",
  })

  if ("error" in result) {
    const status =
      result.error === "forbidden"
        ? 403
        : result.error === "invoice_not_found"
        ? 404
        : 409
    return jsonResponse({ error: result.error }, status)
  }

  return jsonResponse({
    ok: true,
    invoiceId,
    recognizedAmount: result.recognizedAmount,
    spend_status: "recognized",
  })
})

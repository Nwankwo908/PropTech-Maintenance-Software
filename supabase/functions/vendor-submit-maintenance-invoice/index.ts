import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  submitMaintenanceInvoice,
  type MaintenanceInvoiceInput,
} from "../_shared/maintenanceSpend.ts"
import { bearerLooksLikeJwt } from "../_shared/vendor_portal_bearer.ts"
import { getVendorFromPortalApiKey } from "../_shared/vendor_portal_api_key.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function bearerKey(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}

function parseInvoice(raw: unknown): MaintenanceInvoiceInput | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const labor = Number(o.laborCost ?? o.labor_cost ?? 0)
  const material = Number(o.materialCost ?? o.material_cost ?? 0)
  const tax = Number(o.taxAmount ?? o.tax_amount ?? 0)
  if (![labor, material, tax].every((n) => Number.isFinite(n))) return null
  return {
    laborCost: labor,
    materialCost: material,
    taxAmount: tax,
    invoiceNumber:
      typeof o.invoiceNumber === "string"
        ? o.invoiceNumber
        : typeof o.invoice_number === "string"
        ? o.invoice_number
        : null,
    documentPath:
      typeof o.documentPath === "string"
        ? o.documentPath
        : typeof o.document_path === "string"
        ? o.document_path
        : null,
    vendorNotes:
      typeof o.vendorNotes === "string"
        ? o.vendorNotes
        : typeof o.vendor_notes === "string"
        ? o.vendor_notes
        : null,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: { ticketId?: string; invoice?: unknown; token?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const invoice = parseInvoice(body.invoice)
  if (!ticketId || !invoice) {
    return jsonResponse({ error: "Missing ticketId or invoice" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: row, error: rowErr } = await supabase
    .from("maintenance_requests")
    .select("id, assigned_vendor_id, vendor_work_status, vendor_action_token")
    .eq("id", ticketId)
    .maybeSingle()

  if (rowErr || !row) return jsonResponse({ error: "Ticket not found" }, 404)

  const accessToken = bearerKey(req)
  const token =
    typeof body.token === "string" && body.token.trim()
      ? body.token.trim()
      : null

  let vendorId: string | null = null

  if (accessToken && bearerLooksLikeJwt(accessToken)) {
    const { data: authData, error: authErr } = await supabase.auth.getUser(
      accessToken,
    )
    if (authErr || !authData.user) {
      return jsonResponse({ error: "Unauthorized" }, 401)
    }
    const email = authData.user.email?.trim().toLowerCase()
    if (!email) return jsonResponse({ error: "Unauthorized" }, 401)

    const { data: vendorRow } = await supabase
      .from("vendors")
      .select("id")
      .or(`auth_user_id.eq.${authData.user.id},email.ilike.${email}`)
      .limit(1)
      .maybeSingle()

    if (!vendorRow?.id || vendorRow.id !== row.assigned_vendor_id) {
      return jsonResponse({ error: "Forbidden" }, 403)
    }
    vendorId = String(vendorRow.id)
  } else if (accessToken) {
    const portalVendor = await getVendorFromPortalApiKey(supabase, accessToken)
    if (portalVendor && portalVendor.id === row.assigned_vendor_id) {
      vendorId = portalVendor.id
    } else if (row.vendor_action_token === accessToken) {
      vendorId = row.assigned_vendor_id as string
    } else {
      return jsonResponse({ error: "Invalid Authorization token" }, 401)
    }
  } else if (token && row.vendor_action_token === token) {
    vendorId = row.assigned_vendor_id as string
  } else {
    return jsonResponse({ error: "Missing valid Authorization bearer or token" }, 401)
  }

  if (!vendorId) return jsonResponse({ error: "Forbidden" }, 403)

  const result = await submitMaintenanceInvoice(supabase, {
    maintenanceRequestId: ticketId,
    vendorId,
    invoice,
    source: "vendor_portal",
  })

  if ("error" in result) {
    const status = result.error === "forbidden" ? 403 : 409
    return jsonResponse({ error: result.error }, status)
  }

  return jsonResponse({
    ok: true,
    ticketId,
    invoiceId: result.invoiceId,
    totalCost: result.totalCost,
    spend_status: "pending_approval",
  })
})

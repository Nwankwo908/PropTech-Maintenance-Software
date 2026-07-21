/**
 * Public tokenized invoice submit (`/invoice/:token`) + portal invoice API.
 * Auth: maintenance_requests.vendor_action_token or portal bearer.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  loadInvoiceContextForJobToken,
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

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  let body: {
    token?: string
    action?: string
    ticketId?: string
    invoice?: unknown
    laborCost?: number
    materialCost?: number
    taxAmount?: number
    invoiceNumber?: string
    vendorNotes?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const action = (body.action ?? "submit").trim().toLowerCase()
  const token = typeof body.token === "string" ? body.token.trim() : ""

  if (action === "resolve") {
    if (!token || !uuidRe.test(token)) {
      return jsonResponse({ error: "Invalid job token" }, 400)
    }
    const ctx = await loadInvoiceContextForJobToken(supabase, token)
    if (!ctx.ok) {
      return jsonResponse({ error: ctx.error }, ctx.status)
    }
    return jsonResponse({
      ok: true,
      ticketId: ctx.ticketId,
      workOrderRef: ctx.workOrderRef,
      unit: ctx.unit,
      description: ctx.description,
      vendorWorkStatus: ctx.vendorWorkStatus,
      completionPhotoCount: ctx.completionPhotoCount,
      canSubmit: ctx.canSubmit,
      approvedEstimate: ctx.approvedEstimate,
      existingInvoice: ctx.existingInvoice,
    })
  }

  // Token-only public submit (job details → /invoice/:token)
  if (token && uuidRe.test(token) && !body.ticketId) {
    const ctx = await loadInvoiceContextForJobToken(supabase, token)
    if (!ctx.ok) {
      return jsonResponse({ error: ctx.error }, ctx.status)
    }
    if (!ctx.canSubmit) {
      return jsonResponse(
        {
          error:
            "Upload completion photos before submitting an invoice for this job.",
        },
        409,
      )
    }
    if (ctx.existingInvoice && ctx.existingInvoice.status !== "rejected") {
      return jsonResponse({
        ok: true,
        ticketId: ctx.ticketId,
        invoiceId: ctx.existingInvoice.id,
        totalCost: ctx.existingInvoice.totalCost,
        spend_status: "pending_approval",
        already: true,
        message: "Invoice already submitted for this job.",
      })
    }

    const fromBody = parseInvoice(body.invoice) ?? {
      laborCost: Number(body.laborCost ?? 0),
      materialCost: Number(body.materialCost ?? 0),
      taxAmount: Number(body.taxAmount ?? 0),
      invoiceNumber: body.invoiceNumber ?? null,
      vendorNotes: body.vendorNotes ?? null,
    }
    if (
      !Number.isFinite(fromBody.laborCost) ||
      !Number.isFinite(fromBody.materialCost) ||
      !Number.isFinite(fromBody.taxAmount)
    ) {
      return jsonResponse({ error: "Invalid invoice amounts" }, 400)
    }

    // Default to approved estimate when amounts are all zero.
    let invoice: MaintenanceInvoiceInput = fromBody
    const total =
      invoice.laborCost + invoice.materialCost + invoice.taxAmount
    if (total <= 0 && ctx.approvedEstimate) {
      invoice = {
        laborCost: ctx.approvedEstimate.laborCost,
        materialCost: ctx.approvedEstimate.partsCost,
        taxAmount: 0,
        vendorNotes: invoice.vendorNotes ?? "From approved estimate",
      }
    }

    const result = await submitMaintenanceInvoice(supabase, {
      maintenanceRequestId: ctx.ticketId,
      vendorId: ctx.vendorId,
      invoice,
      source: "edge_function",
    })

    if ("error" in result) {
      const status = result.error === "forbidden" ? 403 : 409
      return jsonResponse({ error: result.error }, status)
    }

    return jsonResponse({
      ok: true,
      ticketId: ctx.ticketId,
      invoiceId: result.invoiceId,
      totalCost: result.totalCost,
      spend_status: "pending_approval",
      message:
        "Invoice submitted. The property team will review it in Needs Your Attention.",
    })
  }

  // Portal / bearer path (legacy)
  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const invoice = parseInvoice(body.invoice)
  if (!ticketId || !invoice) {
    return jsonResponse({ error: "Missing ticketId or invoice" }, 400)
  }

  const { data: row, error: rowErr } = await supabase
    .from("maintenance_requests")
    .select("id, assigned_vendor_id, vendor_work_status, vendor_action_token")
    .eq("id", ticketId)
    .maybeSingle()

  if (rowErr || !row) return jsonResponse({ error: "Ticket not found" }, 404)

  const accessToken = bearerKey(req)
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

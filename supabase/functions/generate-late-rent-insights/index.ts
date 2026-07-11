/**
 * POST generate-late-rent-insights — AI (or fallback) insight cards for late rent review.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret (same as other admin edges).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import {
  generateLateRentInsights,
  type LateRentInsightsAccountInput,
} from "../_shared/late_rent_insights.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function asBool(value: unknown): boolean {
  return value === true
}

function parseAccount(body: Record<string, unknown>): LateRentInsightsAccountInput | null {
  const account =
    body.account && typeof body.account === "object" && !Array.isArray(body.account)
      ? (body.account as Record<string, unknown>)
      : body

  const residentName = asString(account.residentName) ?? asString(account.resident_name)
  const locationLabel = asString(account.locationLabel) ?? asString(account.location_label)
  const daysOverdue = asNumber(account.daysOverdue) ?? asNumber(account.days_overdue)
  if (!residentName || !locationLabel || daysOverdue == null || daysOverdue < 0) {
    return null
  }

  const riskRaw = (asString(account.riskLevel) ?? asString(account.risk_level) ?? "medium")
    .toLowerCase()
  const riskLevel =
    riskRaw === "high" || riskRaw === "low" || riskRaw === "medium"
      ? riskRaw
      : "medium"

  return {
    residentName,
    locationLabel,
    daysOverdue: Math.floor(daysOverdue),
    balanceDue: asNumber(account.balanceDue) ?? asNumber(account.balance_due),
    monthlyRent: asNumber(account.monthlyRent) ?? asNumber(account.monthly_rent),
    workflowStatus:
      asString(account.workflowStatus) ??
      asString(account.workflow_status) ??
      "active",
    rentClassification:
      asString(account.rentClassification) ?? asString(account.rent_classification),
    paymentIntent: asString(account.paymentIntent) ?? asString(account.payment_intent),
    paymentStatus: asString(account.paymentStatus) ?? asString(account.payment_status),
    reminderSent: asBool(account.reminderSent) || asBool(account.reminder_sent),
    reminderSmsSent: asBool(account.reminderSmsSent) || asBool(account.reminder_sms_sent),
    reminderEmailSent:
      asBool(account.reminderEmailSent) || asBool(account.reminder_email_sent),
    leaseStatus: asString(account.leaseStatus) ?? asString(account.lease_status),
    moveInDate: asString(account.moveInDate) ?? asString(account.move_in_date),
    riskLevel,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[generate-late-rent-insights] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const account = parseAccount(body)
  if (!account) {
    return jsonResponse(
      {
        error:
          "Missing account fields (residentName, locationLabel, daysOverdue required)",
      },
      400,
    )
  }

  const result = await generateLateRentInsights(account)
  return jsonResponse(result)
})

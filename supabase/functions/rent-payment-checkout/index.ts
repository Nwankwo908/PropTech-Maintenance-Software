/**
 * Public Stripe Checkout for resident rent payments.
 *
 * Actions:
 * - create: start Checkout for a rent_collection workflow run
 * - complete: verify a paid session and close the run / clear balance
 *
 * Edge secrets: STRIPE_SECRET_KEY, APP_URL (or RENT_PAYMENT_BASE_URL)
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  completeRentCheckoutFromSession,
  createRentCheckoutSession,
  isRentStripeConfigured,
  stampRentCheckoutOnRun,
} from "../_shared/engine/rentStripeCheckout.ts"
import { runAmountDue, runBillingPeriod } from "../_shared/engine/workflowRuns.ts"
import { landlordHasPayments } from "../../../shared/landlordCapabilities.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

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

  if (!isRentStripeConfigured()) {
    return jsonResponse(
      {
        error:
          "Rent payment is not configured. Set STRIPE_SECRET_KEY and APP_URL Edge secrets.",
      },
      503,
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = typeof body.action === "string" ? body.action.trim() : "create"
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (action === "complete") {
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : ""
    if (!sessionId) {
      return jsonResponse({ error: "Missing sessionId" }, 400)
    }
    const result = await completeRentCheckoutFromSession(supabase, sessionId)
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status ?? 500)
    }
    return jsonResponse({
      ok: true,
      runId: result.runId,
      residentId: result.residentId,
      amountPaid: result.amountPaid,
      alreadyCompleted: result.alreadyCompleted === true,
    })
  }

  // action === create
  const runId = typeof body.runId === "string" ? body.runId.trim() : ""
  const residentId =
    typeof body.residentId === "string" ? body.residentId.trim() : ""
  if (!runId || !uuidRe.test(runId)) {
    return jsonResponse({ error: "Missing or invalid runId" }, 400)
  }
  if (!residentId || !uuidRe.test(residentId)) {
    return jsonResponse({ error: "Missing or invalid residentId" }, 400)
  }

  const { data: run, error: runErr } = await supabase
    .from("workflow_runs")
    .select(
      "id, status, landlord_id, resident_id, metadata, template_id",
    )
    .eq("id", runId)
    .eq("template_id", "rent_collection")
    .maybeSingle()

  if (runErr || !run) {
    return jsonResponse({ error: "Rent payment link is not valid." }, 404)
  }
  if (!landlordHasPayments(String(run.landlord_id ?? ""))) {
    return jsonResponse({ error: "Payments are not available on this account." }, 403)
  }
  if (String(run.resident_id ?? "") !== residentId) {
    return jsonResponse({ error: "Rent payment link is not valid." }, 403)
  }
  if (run.status === "completed") {
    return jsonResponse(
      { error: "This rent balance has already been paid." },
      409,
    )
  }

  const landlordId = String(run.landlord_id)
  const runForHelpers = {
    ...run,
    metadata:
      run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? run.metadata as Record<string, unknown>
        : {},
  }
  const amountDue = runAmountDue(runForHelpers as never) ?? 0
  const billingPeriod = runBillingPeriod(runForHelpers as never) ?? ""
  const metadata = runForHelpers.metadata
  const unitLabel =
    typeof metadata.unit_label === "string" ? metadata.unit_label : null

  const { data: resident } = await supabase
    .from("users")
    .select("full_name, balance_due")
    .eq("id", residentId)
    .maybeSingle()

  const chargeAmount = amountDue > 0
    ? amountDue
    : Number(resident?.balance_due ?? 0)

  const created = await createRentCheckoutSession(supabase, {
    landlordId,
    runId,
    residentId,
    billingPeriod: billingPeriod || new Date().toISOString().slice(0, 7),
    amountDue: chargeAmount,
    residentName: resident?.full_name ? String(resident.full_name) : null,
    unitLabel,
  })

  if (!created.ok) {
    return jsonResponse({ error: created.error }, 502)
  }

  await stampRentCheckoutOnRun(supabase, {
    runId,
    sessionId: created.sessionId,
    paymentLink: created.url,
  })

  return jsonResponse({
    ok: true,
    url: created.url,
    sessionId: created.sessionId,
    runId,
  })
})

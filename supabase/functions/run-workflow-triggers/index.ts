/**
 * Cron or manual POST: runs property operations workflow triggers
 * (lease renewal outreach, overdue escalation, etc.).
 *
 * Pattern: trigger → classify → route → act → escalate → log
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEngine } from "../_shared/engine/runner.ts"
import {
  fetchWorkflowTemplateConfig,
  leaseRenewalTimingFromConfig,
  rentCollectionTimingFromConfig,
} from "../_shared/engine/templateConfig.ts"

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

function authorized(req: Request): boolean {
  const secret = Deno.env.get("RUN_WORKFLOW_TRIGGERS_SECRET")?.trim()
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}

function resolveLandlordId(body: Record<string, unknown>): string | null {
  const fromBody = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  if (fromBody) return fromBody

  return Deno.env.get("DEFAULT_LANDLORD_ID")?.trim() ?? null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!authorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const landlordId = resolveLandlordId(body)
  if (!landlordId) {
    return jsonResponse({ error: "landlord_id required" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const leaseRenewalConfig = await fetchWorkflowTemplateConfig(
    supabase,
    "lease_renewal",
  )
  const defaultTiming = leaseRenewalTimingFromConfig(leaseRenewalConfig)

  const noticeDays = typeof body.notice_days === "number"
    ? body.notice_days
    : defaultTiming.noticeDays

  const noResponseDays = typeof body.no_response_days === "number"
    ? body.no_response_days
    : defaultTiming.noResponseDays

  const leaseRenewal = await runWorkflowEngine(supabase, {
    trigger: "cron",
    landlordId,
    cron: {
      templateId: "lease_renewal",
      noticeDays,
      noResponseDays,
    },
  })

  const rentCollectionConfig = await fetchWorkflowTemplateConfig(
    supabase,
    "rent_collection",
  )
  const rentTiming = rentCollectionTimingFromConfig(rentCollectionConfig)

  const rentDueDay = typeof body.rent_due_day === "number"
    ? body.rent_due_day
    : rentTiming.rentDueDay

  const latePaymentGraceDays = typeof body.late_payment_grace_days === "number"
    ? body.late_payment_grace_days
    : rentTiming.latePaymentGraceDays

  const rentCollection = await runWorkflowEngine(supabase, {
    trigger: "cron",
    landlordId,
    cron: {
      templateId: "rent_collection",
      rentDueDay,
      noResponseDays: latePaymentGraceDays,
    },
  })

  return jsonResponse({
    ok: true,
    landlord_id: landlordId,
    timing: {
      notice_days: noticeDays,
      no_response_days: noResponseDays,
      source: leaseRenewalConfig ? "workflow_templates" : "defaults",
    },
    results: {
      lease_renewal: {
        template_id: leaseRenewal.templateId,
        route: leaseRenewal.route,
        metadata: leaseRenewal.metadata,
        stages: leaseRenewal.stages,
      },
      rent_collection: {
        template_id: rentCollection.templateId,
        route: rentCollection.route,
        metadata: rentCollection.metadata,
        stages: rentCollection.stages,
      },
    },
  })
})

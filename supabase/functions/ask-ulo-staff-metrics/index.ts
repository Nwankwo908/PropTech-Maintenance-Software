/**
 * POST ask-ulo-staff-metrics — Ulo staff ask plain-English questions about
 * company-wide metrics. Answers come only from public.get_staff_metrics, read
 * with the caller's own access token (database refuses non-staff).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { answerStaffMetricsQuestion } from "../_shared/staffMetrics/askStaffMetrics.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const result = await answerStaffMetricsQuestion(req, body)
  return jsonResponse(result.body, result.status)
})

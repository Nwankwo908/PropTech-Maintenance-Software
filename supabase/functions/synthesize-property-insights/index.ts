/**
 * POST synthesize-property-insights — one recommendation synthesis per Overview refresh.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { synthesizePropertyInsightRecommendations } from "../_shared/propertyInsightSynthesis.ts"
import type { PortfolioInsightFinding } from "../../../shared/portfolioIntelligence/types.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function parseFindings(raw: unknown): PortfolioInsightFinding[] {
  if (!Array.isArray(raw)) return []
  const out: PortfolioInsightFinding[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const tag = String(row.tag ?? "").trim()
    const text = String(row.text ?? "").trim()
    const score = typeof row.score === "number" ? row.score : Number(row.score)
    if (!tag || !text || !Number.isFinite(score)) continue
    const ticketSummaries = Array.isArray(row.ticketSummaries)
      ? row.ticketSummaries
          .map((t) => {
            if (!t || typeof t !== "object") return null
            const id = String((t as { id?: unknown }).id ?? "").trim()
            const description = String(
              (t as { description?: unknown }).description ?? "",
            ).trim()
            if (!id) return null
            return { id, description: description || "Maintenance request" }
          })
          .filter((t): t is { id: string; description: string } => Boolean(t))
      : []
    const ticketIds = Array.isArray(row.ticketIds)
      ? row.ticketIds.map((id) => String(id).trim()).filter(Boolean)
      : ticketSummaries.map((t) => t.id)
    out.push({
      tag: tag as PortfolioInsightFinding["tag"],
      text,
      score,
      building: typeof row.building === "string" ? row.building : null,
      categoryLabel: typeof row.categoryLabel === "string" ? row.categoryLabel : null,
      unitLabel: typeof row.unitLabel === "string" ? row.unitLabel : null,
      unitId: typeof row.unitId === "string" ? row.unitId : null,
      requestCount: typeof row.requestCount === "number" ? row.requestCount : null,
      responseRate: typeof row.responseRate === "number" ? row.responseRate : null,
      assignedCount: typeof row.assignedCount === "number" ? row.assignedCount : null,
      ticketIds,
      ticketSummaries,
    })
  }
  return out
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  const auth = requireAdminReassignAuth(req, "[synthesize-property-insights]")
  if (!auth.ok) {
    return auth.response
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const findings = parseFindings(body.findings)
  if (findings.length === 0) {
    return jsonResponse({ cards: [], mode: "fallback" })
  }

  try {
    const result = await synthesizePropertyInsightRecommendations(findings)
    return jsonResponse(result)
  } catch (err) {
    console.error("[synthesize-property-insights]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})

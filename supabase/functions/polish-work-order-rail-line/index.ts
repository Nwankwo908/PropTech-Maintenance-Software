/**
 * POST polish-work-order-rail-line
 * Best-effort gpt-6-luna rewrite for Active Tasks Overview / next-step /
 * Activity Timeline / Issue details drafts (one batched request).
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { polishWorkOrderRailLine } from "../_shared/ops/polishWorkOrderRailLine.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type LineIn = {
  id?: string
  draft?: string
  mustKeep?: unknown
  kind?: unknown
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  // session-scoped: caller-supplied content
  const auth = await requireAdminReassignAuth(req, "[polish-work-order-rail-line]")
  if (!auth.ok) return auth.response

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const rawLines = Array.isArray(body.lines) ? (body.lines as LineIn[]) : []
  if (rawLines.length === 0) return jsonResponse({ lines: [] })
  if (rawLines.length > 8) return jsonResponse({ error: "Too many lines" }, 400)

  const skipLlm = body.skipLlm === true
  const polished = await Promise.all(
    rawLines.map(async (row, index) => {
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `line-${index}`
      const draft = typeof row.draft === "string" ? row.draft : ""
      const mustKeep = Array.isArray(row.mustKeep)
        ? row.mustKeep.map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
        : []
      const kind = row.kind === "issue_description" ? "issue_description" : "status"
      const result = await polishWorkOrderRailLine({
        draft,
        mustKeep,
        kind,
        skipLlm,
      })
      return { id, line: result.line, method: result.method }
    }),
  )

  return jsonResponse({ lines: polished })
})

/**
 * POST ask-ulo — RAG answer for Ask Ulo panel, or counsel handoff action.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret (same as other admin edges).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { runAskUlo } from "../_shared/ask_ulo/runAskUlo.ts"
import { parseAskUloAgentMode } from "../_shared/ask_ulo/agentMode.ts"
import { recordCounselHandoff } from "../_shared/ask_ulo/recordCounselHandoff.ts"
import {
  markEvalCounselHandoff,
  recordAskUloFeedback,
} from "../_shared/ask_ulo/evalRecord.ts"

/**
 * Explicit CORS for browser → Edge (localhost and deployed admin UI).
 * Includes x-admin-reassign-secret so preflight accepts the admin auth header.
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-reassign-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

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

serve(async (req) => {
  // Preflight must succeed before auth / body parsing.
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders })
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
      console.error("[ask-ulo] ADMIN_REASSIGN_SECRET not set")
      return jsonResponse({ error: "Server misconfiguration" }, 500)
    }

    if (!adminReassignSecretAuthorized(req)) {
      console.warn("[ask-ulo] 401 Unauthorized: x-admin-reassign-secret mismatch")
      return jsonResponse({ error: "Unauthorized" }, 401)
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    if (!supabaseUrl || !serviceKey) {
      console.error("[ask-ulo] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
      return jsonResponse({ error: "Server misconfiguration" }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const action = asString(body.action)

    if (action === "counsel_handoff") {
      const landlordId = asString(body.landlordId) ?? asString(body.landlord_id)
      const expertRole = asString(body.expertRole) ?? asString(body.expert_role)
      if (!landlordId) return jsonResponse({ error: "landlordId is required" }, 400)
      if (!expertRole) return jsonResponse({ error: "expertRole is required" }, 400)

      const topicsRaw = body.sensitiveTopicIds ?? body.sensitive_topics
      const sensitiveTopicIds: string[] = []
      if (Array.isArray(topicsRaw)) {
        for (const t of topicsRaw) {
          if (typeof t === "string" && t.trim()) sensitiveTopicIds.push(t.trim())
        }
      }

      try {
        const result = await recordCounselHandoff(supabase, {
          landlordId,
          expertRole,
          conversationId: asString(body.conversationId) ?? asString(body.conversation_id),
          messageId: asString(body.messageId) ?? asString(body.message_id),
          question: asString(body.question),
          answerExcerpt: asString(body.answerExcerpt) ?? asString(body.answer_excerpt),
          sensitiveTopicIds,
          note: asString(body.note),
          stateCode: asString(body.stateCode) ?? asString(body.state_code),
          cityLabel: asString(body.cityLabel) ?? asString(body.city_label),
        })
        if (!result.ok) {
          return jsonResponse({ error: result.error }, 400)
        }
        await markEvalCounselHandoff(supabase, {
          evalId: asString(body.evalId) ?? asString(body.eval_id),
          landlordId,
        })
        return jsonResponse(result)
      } catch (err) {
        console.error("[ask-ulo] counsel_handoff failed", err)
        return jsonResponse(
          { error: err instanceof Error ? err.message : "Counsel handoff failed" },
          500,
        )
      }
    }

    if (action === "feedback") {
      const landlordId = asString(body.landlordId) ?? asString(body.landlord_id)
      const evalId = asString(body.evalId) ?? asString(body.eval_id)
      const ratingRaw = asString(body.rating)
      if (!landlordId) return jsonResponse({ error: "landlordId is required" }, 400)
      if (!evalId) return jsonResponse({ error: "evalId is required" }, 400)
      if (ratingRaw !== "up" && ratingRaw !== "down") {
        return jsonResponse({ error: "rating must be up or down" }, 400)
      }
      try {
        const result = await recordAskUloFeedback(supabase, {
          evalId,
          landlordId,
          rating: ratingRaw,
          overrideReason: asString(body.overrideReason) ?? asString(body.override_reason),
          note: asString(body.note),
          conversationId: asString(body.conversationId) ?? asString(body.conversation_id),
          messageId: asString(body.messageId) ?? asString(body.message_id),
        })
        if (!result.ok) return jsonResponse({ error: result.error }, 400)
        return jsonResponse(result)
      } catch (err) {
        console.error("[ask-ulo] feedback failed", err)
        return jsonResponse(
          { error: err instanceof Error ? err.message : "Feedback failed" },
          500,
        )
      }
    }

    const question = asString(body.question)
    const landlordId = asString(body.landlordId) ?? asString(body.landlord_id)
    const conversationId = asString(body.conversationId) ?? asString(body.conversation_id)
    const agentMode = parseAskUloAgentMode(body.agentMode ?? body.agent_mode)
    if (!question) {
      return jsonResponse({ error: "question is required" }, 400)
    }
    if (!landlordId) {
      return jsonResponse({ error: "landlordId is required" }, 400)
    }
    if (question.length > 4000) {
      return jsonResponse({ error: "question is too long" }, 400)
    }

    const historyRaw = body.messages ?? body.history
    const history: Array<{ role: "user" | "assistant"; content: string }> = []
    if (Array.isArray(historyRaw)) {
      for (const item of historyRaw) {
        if (!item || typeof item !== "object") continue
        const row = item as Record<string, unknown>
        const role = asString(row.role)
        const content = asString(row.content) ?? asString(row.text)
        if (!content) continue
        if (role !== "user" && role !== "assistant") continue
        history.push({ role, content: content.slice(0, 4000) })
        if (history.length >= 24) break
      }
    }

    try {
      const result = await runAskUlo(supabase, {
        question,
        landlordId,
        history,
        conversationId,
        agentMode,
      })
      return jsonResponse({
        answer: result.answer,
        citations: result.citations,
        toolsUsed: result.toolsUsed,
        mode: result.mode,
        model: result.model,
        intent: result.intent,
        agentMode: result.agentMode,
        evalId: result.evalId,
        jurisdiction: result.jurisdiction,
        visualContext: result.visualContext,
        legalAudit: result.legalAudit,
        safetyBoundary: result.safetyBoundary,
      })
    } catch (err) {
      console.error("[ask-ulo] failed", err)
      return jsonResponse(
        { error: err instanceof Error ? err.message : "Ask Ulo failed" },
        500,
      )
    }
  } catch (err) {
    // Catch-all so unexpected failures still return CORS headers (avoids Failed to fetch).
    console.error("[ask-ulo] unhandled", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Ask Ulo failed" },
      500,
    )
  }
})

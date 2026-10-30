/**
 * POST ask-ulo — RAG answer for Ask Ulo panel, or counsel handoff action.
 * Auth: ADMIN_REASSIGN_SECRET + user JWT with landlord access check
 * (shared secret alone is never proof of landlord scope).
 */
import { createAskUloTiming } from "../_shared/ask_ulo/core/timing.ts"
import { validateAskUloRequest } from "../_shared/ask_ulo/core/validateRequest.ts"
import { withDeadline } from '../_shared/ai/deadline.ts'
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { assertAskUloLandlordAccess } from "../_shared/ask_ulo/auth/assertAskUloLandlordAccess.ts"
import { runAskUlo } from "../_shared/ask_ulo/runAskUlo.ts"
import { parseAskUloAgentMode } from "../_shared/ask_ulo/routing/selectMode.ts"
import { recordCounselHandoff } from "../_shared/ask_ulo/audit/recordCounselHandoff.ts"
import {
  markEvalCounselHandoff,
  recordAskUloFeedback,
} from "../_shared/ask_ulo/audit/buildAuditRecord.ts"

/**
 * Explicit CORS for browser → Edge (localhost and deployed admin UI).
 * Includes x-admin-reassign-secret + x-ulo-access-token for preflight.
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-reassign-secret, x-ulo-access-token, x-ulo-trace-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "Server-Timing, X-Ulo-Trace-Id",
}


function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

serve(async (req) => {
  const timing = createAskUloTiming(undefined, undefined, req.headers.get('x-ulo-trace-id'))
  const requestSignal = AbortSignal.timeout(25000)
  function jsonResponse(body: unknown, status = 200): Response {
    const serialized = timing.measureSync('serialization', () => JSON.stringify(body))
    const measured = timing.emit(status)
    return new Response(serialized, {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json',
        'X-Ulo-Trace-Id': measured.traceId,
        'Server-Timing': `total;dur=${measured.totalMs.toFixed(1)},` + Object.entries(measured.stagesMs).map(([stage, ms]) => `${stage};dur=${ms.toFixed(1)}`).join(',') },
    })
  }
  // Preflight must succeed before auth / body parsing.
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders })
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }
    const adminAuth = requireAdminReassignAuth(req, "[ask-ulo]", corsHeaders)
    if (!adminAuth.ok) { timing.emit(adminAuth.response.status); return adminAuth.response }

    let body: Record<string, unknown>
    try {
      body = await timing.measure('parse', async () => {
        const value = await req.json()
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body')
        return value as Record<string, unknown>
      })
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const invalid = await timing.measure('input_validation', () => validateAskUloRequest(body))
    if (invalid) return jsonResponse({ error: invalid }, 400)

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim()
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error("[ask-ulo] missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY")
      return jsonResponse({ error: "Server misconfiguration" }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { fetch: (url, init) => timing.measure('database_http', () => fetch(url, { ...init, signal: AbortSignal.any([
        requestSignal, AbortSignal.timeout(8000), ...(init?.signal ? [init.signal] : []),
      ]) })) },
    })
    const action = asString(body.action)
    const landlordIdEarly =
      asString(body.landlordId) ?? asString(body.landlord_id)

    if (!landlordIdEarly) {
      return jsonResponse({ error: "landlordId is required" }, 400)
    }

    const access = await timing.measure('auth', () => assertAskUloLandlordAccess({
      req,
      supabase,
      supabaseUrl,
      anonKey,
      landlordId: landlordIdEarly,
      signal: requestSignal,
    }))
    if (!access.ok) {
      return jsonResponse({ error: access.error }, access.status)
    }

    const landlordId = access.landlordId
    const authUserId = access.user.id

    if (action === "counsel_handoff") {
      const expertRole = asString(body.expertRole) ?? asString(body.expert_role)
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
      const evalId = asString(body.evalId) ?? asString(body.eval_id)
      const ratingRaw = asString(body.rating)
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
    const conversationId = asString(body.conversationId) ?? asString(body.conversation_id)
    const agentMode = parseAskUloAgentMode(body.agentMode ?? body.agent_mode)
    if (!question) {
      return jsonResponse({ error: "question is required" }, 400)
    }
    if (question.length > 4000) {
      return jsonResponse({ error: "question is too long" }, 400)
    }

    const historyRaw = body.messages ?? body.history
    const history: Array<{ role: "user" | "assistant"; content: string }> = []
    if (Array.isArray(historyRaw)) {
      for (const item of historyRaw.slice(-24)) {
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
      const result = await withDeadline(Math.max(1, 25000 - timing.snapshot().totalMs), () => runAskUlo(supabase, {
        question,
        timing,
        landlordId,
        userId: authUserId,
        history,
        conversationId,
        agentMode,
      }))
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
        supportTicket: result.supportTicket ?? null,
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        return jsonResponse({ answer: "I couldn't finish verifying the result before the response limit. I can't confirm an answer or action outcome. Please check the current record before retrying.", citations: [], toolsUsed: ['request_deadline'], mode: 'fallback', model: null, intent: 'general', agentMode, evalId: null, visualContext: null, legalAudit: null, safetyBoundary: null, supportTicket: null })
      }
      console.error("[ask-ulo] failed", err)
      return jsonResponse(
        { error: err instanceof Error ? err.message : "Ask Ulo failed" },
        500,
      )
    }
  } catch (err) {
    // Catch-all so unexpected failures still return CORS headers (avoids Failed to fetch).
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return jsonResponse({ error: 'Ask Ulo could not verify the request in time. Please retry.' }, 503)
    }
    console.error("[ask-ulo] unhandled", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Ask Ulo failed" },
      500,
    )
  }
})

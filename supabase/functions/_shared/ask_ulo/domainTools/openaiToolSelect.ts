/**
 * Bounded OpenAI tool selection — LLM chooses among an allowlisted set only.
 * Never grants unrestricted registry access. Fail closed → empty selection.
 */
/// <reference lib="deno.ns" />

import {
  DOMAIN_TOOL_REGISTRY,
  getDomainTool,
  type DomainToolId,
} from "./registry.ts"
import type { RankVendorsMetric } from "./rankVendors.ts"

const SELECT_MODEL = "gpt-4o-mini"
const MAX_TOOLS = 3

export type PlannedDomainToolCall = {
  name: DomainToolId
  arguments: Record<string, unknown>
}

export type DomainToolSelectResult = {
  ok: boolean
  source: "openai" | "skipped" | "error" | "empty"
  tools: PlannedDomainToolCall[]
  /** True when OpenAI was called but returned no valid allowlisted tool. */
  noToolMatched: boolean
  error?: string
  model?: string
  latencyMs?: number
}

type OpenAiToolDef = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const RANK_METRICS: RankVendorsMetric[] = [
  "response_time",
  "response_rate",
  "acceptance_rate",
  "completion_rate",
  "completed_jobs",
  "active_jobs",
  "decline_rate",
  "overall_quality",
  "inactive",
  "workload",
]

const TOOL_PARAMETER_SCHEMAS: Partial<Record<DomainToolId, Record<string, unknown>>> = {
  search_work_orders: {
    type: "object",
    properties: {
      category: { type: "string", description: "Issue category (plumbing, HVAC, etc.)." },
      status: { type: "string", description: "Workflow or vendor status filter." },
      query: { type: "string", description: "Free-text search terms." },
      approvalRequired: { type: "boolean" },
      slaExpired: { type: "boolean" },
      includeCompleted: { type: "boolean" },
      sortBy: { type: "string", enum: ["created_at", "days_open", "priority"] },
      sortOrder: { type: "string", enum: ["asc", "desc"] },
      dateRangeDays: { type: "integer", minimum: 1, maximum: 365 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  rank_vendors: {
    type: "object",
    properties: {
      metric: {
        type: "string",
        enum: RANK_METRICS,
        description: "Which vendor metric to rank by.",
      },
      trade: { type: "string", description: "Trade / category filter (electrician, plumber)." },
      order: { type: "string", enum: ["asc", "desc"] },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    required: ["metric"],
    additionalProperties: false,
  },
  get_property_insights: {
    type: "object",
    properties: {
      insightTypes: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "recurring_issues",
            "needs_attention",
            "vendor_response",
            "preventive_repairs",
          ],
        },
      },
      dateRangeDays: { type: "integer", minimum: 1, maximum: 365 },
    },
    additionalProperties: false,
  },
  get_awaiting_decisions: {
    type: "object",
    properties: {
      priorities: { type: "array", items: { type: "string" } },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  list_active_workflows: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  search_residents: {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: [
          "late_rent",
          "outstanding_balance",
          "lease_ending",
          "high_maintenance_activity",
          "move_in",
          "move_out",
          "message_nonresponse",
        ],
      },
      sortOrder: { type: "string", enum: ["asc", "desc"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  draft_communication: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [
          "water_shutoff_notice",
          "scheduled_maintenance_message",
          "vendor_update_email",
          "lease_renewal_reminder",
          "move_out_checklist",
          "resident_complaint_response",
          "team_activity_summary",
          "generic_notice",
        ],
      },
    },
    additionalProperties: false,
  },
  get_weather_alerts: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  get_landlord_incentives: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
}

function isLiveDomainToolId(id: string): id is DomainToolId {
  const meta = getDomainTool(id as DomainToolId)
  return Boolean(meta && meta.status === "live")
}

/** Build OpenAI function defs strictly from the caller's allowlist. */
export function buildOpenAiToolDefs(allowlist: DomainToolId[]): OpenAiToolDef[] {
  const out: OpenAiToolDef[] = []
  for (const id of allowlist) {
    if (!isLiveDomainToolId(id)) continue
    const meta = DOMAIN_TOOL_REGISTRY.find((t) => t.id === id)
    if (!meta) continue
    const parameters = TOOL_PARAMETER_SCHEMAS[id] ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    }
    out.push({
      type: "function",
      function: {
        name: id,
        description: `${meta.label}: ${meta.description}`,
        parameters,
      },
    })
  }
  return out
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
  }
  return {}
}

/** Keep only allowlisted live tools; drop duplicates; cap count. */
export function filterPlannedTools(
  calls: PlannedDomainToolCall[],
  allowlist: ReadonlySet<DomainToolId>,
  max = MAX_TOOLS,
): PlannedDomainToolCall[] {
  const seen = new Set<DomainToolId>()
  const out: PlannedDomainToolCall[] = []
  for (const call of calls) {
    if (!allowlist.has(call.name)) continue
    if (!isLiveDomainToolId(call.name)) continue
    if (seen.has(call.name)) continue
    seen.add(call.name)
    out.push({
      name: call.name,
      arguments: call.arguments && typeof call.arguments === "object"
        ? call.arguments
        : {},
    })
    if (out.length >= max) break
  }
  return out
}

/**
 * Ask OpenAI which allowlisted tools to run. Never executes tools.
 * On missing key / empty allowlist / API failure → ok:false or empty tools.
 */
export async function selectDomainToolsWithOpenAI(input: {
  question: string
  allowlist: DomainToolId[]
  subject: string
  capability: string
  apiKey?: string | null
}): Promise<DomainToolSelectResult> {
  const apiKey = (input.apiKey ?? Deno.env.get("OPENAI_API_KEY") ?? "").trim()
  const allowlist = [...new Set(input.allowlist.filter(isLiveDomainToolId))]
  if (!apiKey) {
    return {
      ok: false,
      source: "skipped",
      tools: [],
      noToolMatched: false,
      error: "missing_openai_api_key",
    }
  }
  if (allowlist.length === 0) {
    return {
      ok: false,
      source: "skipped",
      tools: [],
      noToolMatched: true,
      error: "empty_allowlist",
    }
  }

  const tools = buildOpenAiToolDefs(allowlist)
  if (tools.length === 0) {
    return {
      ok: false,
      source: "skipped",
      tools: [],
      noToolMatched: true,
      error: "no_live_tool_schemas",
    }
  }

  const allowSet = new Set(allowlist)
  const started = Date.now()
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SELECT_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You route property-operations questions to retrieval tools.\n" +
              "Call only the tools needed to answer the landlord's question.\n" +
              "You may call 0–3 tools. Prefer required operational tools over speculative ones.\n" +
              "If none of the tools fit, call none.\n" +
              `Subject=${input.subject}; capability=${input.capability}.`,
          },
          { role: "user", content: input.question.trim() },
        ],
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
      }),
    })

    const data = (await res.json()) as Record<string, unknown>
    const latencyMs = Date.now() - started
    if (!res.ok) {
      const errObj = data?.error as { message?: string } | undefined
      return {
        ok: false,
        source: "error",
        tools: [],
        noToolMatched: false,
        error: errObj?.message ?? `openai_http_${res.status}`,
        model: SELECT_MODEL,
        latencyMs,
      }
    }

    const choices = data?.choices as unknown
    const first =
      Array.isArray(choices) && choices.length > 0
        ? (choices[0] as Record<string, unknown>)
        : null
    const message = first?.message as Record<string, unknown> | undefined
    const toolCallsRaw = message?.tool_calls
    const rawCalls: PlannedDomainToolCall[] = []
    if (Array.isArray(toolCallsRaw)) {
      for (const tc of toolCallsRaw) {
        if (!tc || typeof tc !== "object") continue
        const fn = (tc as Record<string, unknown>).function as
          | Record<string, unknown>
          | undefined
        const name = typeof fn?.name === "string" ? fn.name : ""
        if (!name) continue
        rawCalls.push({
          name: name as DomainToolId,
          arguments: parseArgs(fn?.arguments),
        })
      }
    }

    const toolsPlanned = filterPlannedTools(rawCalls, allowSet)
    return {
      ok: true,
      source: toolsPlanned.length > 0 ? "openai" : "empty",
      tools: toolsPlanned,
      noToolMatched: toolsPlanned.length === 0,
      model: SELECT_MODEL,
      latencyMs,
    }
  } catch (e) {
    return {
      ok: false,
      source: "error",
      tools: [],
      noToolMatched: false,
      error: e instanceof Error ? e.message : String(e),
      model: SELECT_MODEL,
      latencyMs: Date.now() - started,
    }
  }
}

export function isOpenAiToolSelectEnabled(): boolean {
  const flag = (Deno.env.get("ASK_ULO_OPENAI_TOOL_SELECT") ?? "").trim().toLowerCase()
  if (flag === "0" || flag === "false" || flag === "off") return false
  if (flag === "1" || flag === "true" || flag === "on") return true
  // Default on when OpenAI is available — opt out via ASK_ULO_OPENAI_TOOL_SELECT=false.
  return Boolean((Deno.env.get("OPENAI_API_KEY") ?? "").trim())
}

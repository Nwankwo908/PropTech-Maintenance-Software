/**
 * Alternative vendor suggestions for tickets stuck in `pending_accept`.
 * Uses OpenAI when OPENAI_API_KEY is set; otherwise first N category-matched vendors by name.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { vendorTradeMatchesFlexible } from "./vendor_trades.ts"

export type AlternativeVendor = { id: string; name: string }

/** Same match rule as vendor_assignment.ts. */
function categoryMatches(
  vendorCategory: string | null,
  issueCategory: string | null,
): boolean {
  return vendorTradeMatchesFlexible(vendorCategory, issueCategory)
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

export async function loadAlternativeVendorCandidates(
  supabase: SupabaseClient,
  ticket: {
    assigned_vendor_id: string | null
    issue_category: string | null
  },
): Promise<AlternativeVendor[]> {
  const { data: vendors, error } = await supabase
    .from("vendors")
    .select("id, name, category, active")
    .eq("active", true)

  if (error || !vendors) {
    console.error("[recommend-vendor-alt] load vendors", error)
    return []
  }

  const issueCat =
    ticket.issue_category == null || String(ticket.issue_category).trim() === ""
      ? null
      : String(ticket.issue_category)
  const aid = ticket.assigned_vendor_id

  const candidates: AlternativeVendor[] = []
  for (const v of vendors) {
    const id = String(v.id ?? "")
    const name = typeof v.name === "string" ? v.name.trim() : ""
    if (!id || !name) continue
    if (aid && id === aid) continue
    const cat = v.category == null ? null : String(v.category)
    if (!categoryMatches(cat, issueCat)) continue
    candidates.push({ id, name })
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name))
  return candidates
}

async function rankWithOpenAI(
  apiKey: string,
  description: string,
  priority: string,
  candidates: AlternativeVendor[],
  limit: number,
): Promise<AlternativeVendor[]> {
  if (candidates.length === 0) return []
  const lines = candidates
    .map((c) => `- name: ${JSON.stringify(c.name)} id: ${c.id}`)
    .join("\n")
  const prompt =
    `You help property managers pick alternative vendors for a maintenance ticket.\n` +
    `Return ONLY valid JSON (no markdown, no prose) with exactly this shape:\n` +
    `{"vendor_ids":["uuid",...]}\n` +
    `Include at most ${limit} vendor ids from the candidate list only, best match first for the job.\n\n` +
    `Priority: ${JSON.stringify(priority)}\n` +
    `Description:\n"""${description.replace(/"/g, '\\"').slice(0, 4000)}"""\n\n` +
    `Candidates:\n${lines}`

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  })

  const data = (await aiResponse.json()) as Record<string, unknown>
  if (!aiResponse.ok) {
    const errObj = data?.error as { message?: string } | undefined
    console.warn(
      "[recommend-vendor-alt] OpenAI error",
      errObj?.message ?? aiResponse.status,
    )
    return []
  }

  const choices = data?.choices as unknown
  const first =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null
  const message = first?.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content !== "string" || !content.trim()) return []

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(stripJsonFence(content)) as Record<string, unknown>
  } catch {
    return []
  }

  const rawIds = parsed.vendor_ids
  if (!Array.isArray(rawIds)) return []

  const byId = new Map(candidates.map((c) => [c.id, c]))
  const out: AlternativeVendor[] = []
  for (const x of rawIds) {
    if (typeof x !== "string" || !x.trim()) continue
    const id = x.trim()
    const row = byId.get(id)
    if (row && !out.some((o) => o.id === row.id)) out.push(row)
    if (out.length >= limit) break
  }
  return out
}

export type RecommendAlternativesOk = {
  ticketId: string
  alternatives: AlternativeVendor[]
  mode: "openai" | "fallback"
}

export async function recommendAlternativeVendorsForTicket(
  supabase: SupabaseClient,
  ticketId: string,
  opts?: { limit?: number },
): Promise<RecommendAlternativesOk | { error: string }> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, assigned_vendor_id, issue_category, description, priority, vendor_work_status, due_at",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (error) {
    console.error("[recommend-vendor-alt] load ticket", error)
    return { error: "Load ticket failed" }
  }
  if (!ticket) {
    return { error: "Ticket not found" }
  }

  const vws = String(ticket.vendor_work_status ?? "").trim().toLowerCase()
  const dueRaw = ticket.due_at
  const dueTs = dueRaw ? new Date(String(dueRaw)).getTime() : NaN
  const slaOverdue = !Number.isNaN(dueTs) && dueTs < Date.now()
  const pendingAccept = vws === "pending_accept"
  const terminal = vws === "completed" || vws === "cancelled"

  if (terminal) {
    return { error: "Ticket is closed" }
  }
  if (!pendingAccept && !slaOverdue) {
    return {
      error:
        "Ticket is not eligible for vendor alternatives (must be pending acceptance or past SLA)",
    }
  }

  const candidates = await loadAlternativeVendorCandidates(supabase, {
    assigned_vendor_id: ticket.assigned_vendor_id as string | null,
    issue_category: ticket.issue_category as string | null,
  })

  const limit = opts?.limit ?? 3
  if (candidates.length === 0) {
    return { ticketId, alternatives: [], mode: "fallback" }
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (apiKey) {
    const ranked = await rankWithOpenAI(
      apiKey,
      String(ticket.description ?? ""),
      String(ticket.priority ?? ""),
      candidates,
      limit,
    )
    if (ranked.length > 0) {
      return { ticketId, alternatives: ranked.slice(0, limit), mode: "openai" }
    }
  }

  return {
    ticketId,
    alternatives: candidates.slice(0, limit),
    mode: "fallback",
  }
}

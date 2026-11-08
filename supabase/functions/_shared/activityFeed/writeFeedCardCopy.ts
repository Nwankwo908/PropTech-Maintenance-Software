/**
 * AI-written Activity Feed card copy from a clean fact sheet (gpt-6-luna).
 * Validates against facts; falls back to templates on failure/timeout/missing key.
 */
import {
  buildFeedFactSheet,
  fallbackFeedCardCopy,
  feedFactsHash,
  validateFeedCardCopy,
  type FeedCardCopy,
  type FeedCardCopyCache,
  type FeedFactSheet,
  type FeedMilestoneEvent,
  type FeedTicketFactsInput,
} from "../../../../shared/activityFeed/feedFactSheet.ts"
import { fetchLlmClassificationJson } from "../maintenance_classification/llmClassifyProvider.ts"

const DEFAULT_TIMEOUT_MS = 6_000

export type WriteFeedCardCopyOptions = {
  ticket: FeedTicketFactsInput
  events?: FeedMilestoneEvent[]
  /** Existing cached copy — reused when facts_hash matches. */
  cached?: FeedCardCopyCache | null
  skipLlm?: boolean
  openaiKey?: string | null
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Optional logger for validation failures. */
  onValidationFailure?: (reason: string, draft: FeedCardCopy, facts: FeedFactSheet) => void
}

function envKey(name: string): string {
  try {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any
    return (g.Deno?.env?.get?.(name) ?? g.process?.env?.[name] ?? "").trim()
  } catch {
    return ""
  }
}

const SYSTEM_PROMPT =
  "You write one Activity Feed card for a landlord in Ulo (property management). " +
  "Input is a JSON fact sheet. Output JSON only: {\"headline\":\"...\",\"status_line\":\"...\"}. " +
  "Rules: plain friendly English; headline ≤8 words; status_line ≤6 words (or empty). " +
  "Use ONLY names, amounts, and places from the facts — never invent. " +
  "No jargon (workflow, probe, classified, batch, reassigned). No arrows. " +
  "Lead with what the landlord needs to know. If safety is true, say so plainly. " +
  "status_line should start with \"Waiting on\" when waiting_on is you/vendor/tenant; else empty."

/**
 * Build (or reuse cached) feed card copy for a work order.
 * Call when ticket status/milestones change — not on every page load.
 */
export async function writeFeedCardCopy(
  options: WriteFeedCardCopyOptions,
): Promise<FeedCardCopyCache> {
  const facts = buildFeedFactSheet(options.ticket, options.events ?? [])
  const hash = feedFactsHash(facts)
  const cached = options.cached
  if (cached?.facts_hash === hash && cached.headline?.trim()) {
    return cached
  }

  const fallback = fallbackFeedCardCopy(facts)
  const base: FeedCardCopyCache = {
    ...fallback,
    facts_hash: hash,
    source: "fallback",
    updated_at: new Date().toISOString(),
  }

  if (options.skipLlm) return base

  const apiKey = (options.openaiKey ?? envKey("OPENAI_API_KEY")).trim()
  if (!apiKey) return base

  try {
    const fetched = await fetchLlmClassificationJson({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:
        `Fact sheet:\n${JSON.stringify(facts, null, 2)}\n\n` +
        `Examples:\n` +
        `{"headline":"Pick another vendor: freezer seal","status_line":"Waiting on you to pick"}\n` +
        `{"headline":"Manny's $2 estimate declined","status_line":"Waiting on you to pick"}\n` +
        `{"headline":"Ecosafe invoice: $2,300","status_line":"Waiting on your approval"}\n` +
        `{"headline":"⚠ Dryer fire: no vendor yet","status_line":"Waiting on you to pick"}\n` +
        `Return JSON only.`,
      openaiKey: apiKey,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
    })
    if (!fetched?.content) return base

    let parsed: { headline?: unknown; status_line?: unknown }
    try {
      parsed = JSON.parse(fetched.content) as {
        headline?: unknown
        status_line?: unknown
      }
    } catch {
      return base
    }

    const draft: FeedCardCopy = {
      headline: typeof parsed.headline === "string" ? parsed.headline.trim() : "",
      status_line: typeof parsed.status_line === "string" ? parsed.status_line.trim() : "",
    }
    if (!draft.headline) return base

    const validated = validateFeedCardCopy(draft, facts)
    if (!validated.ok) {
      options.onValidationFailure?.(validated.reason, draft, facts)
      console.warn("[writeFeedCardCopy] validation failed", validated.reason, draft)
      return base
    }

    return {
      headline: draft.headline.replace(/\s+/g, " "),
      status_line: (draft.status_line ?? "").replace(/\s+/g, " "),
      facts_hash: hash,
      source: "ai",
      updated_at: new Date().toISOString(),
    }
  } catch (error) {
    console.warn(
      "[writeFeedCardCopy] llm error",
      error instanceof Error ? error.message : String(error),
    )
    return base
  }
}

/** Persist helper for maintenance_requests.feed_card_copy. */
export async function persistFeedCardCopy(
  // deno-lint-ignore no-explicit-any
  db: { from: (table: string) => any },
  ticketId: string,
  copy: FeedCardCopyCache,
): Promise<boolean> {
  const { error } = await db
    .from("maintenance_requests")
    .update({ feed_card_copy: copy })
    .eq("id", ticketId)
  if (error) {
    console.warn("[persistFeedCardCopy]", error.message ?? error)
    return false
  }
  return true
}

/**
 * Load ticket + recent landlord-facing events, refresh feed_card_copy when facts change.
 * Best-effort; never throws.
 */
export async function refreshFeedCardCopyForTicket(
  // deno-lint-ignore no-explicit-any
  db: { from: (table: string) => any },
  ticketId: string,
  options?: { skipLlm?: boolean; openaiKey?: string | null },
): Promise<FeedCardCopyCache | null> {
  const id = ticketId.trim()
  if (!id) return null
  try {
    const { data: ticket, error } = await db
      .from("maintenance_requests")
      .select(
        "id, issue_headline, unit, vendor_id, awaiting_landlord_choice_at, vendor_work_status, spend_status, schedule_confirmed_at, scheduled_at, recognized_spend_amount, estimate_amount, completed_at, cancelled_at, feed_card_copy, landlord_id, property_id, resident_id",
      )
      .eq("id", id)
      .maybeSingle()
    if (error || !ticket) return null

    let vendorName: string | null = null
    if (ticket.vendor_id) {
      const { data: vendor } = await db
        .from("vendors")
        .select("name")
        .eq("id", ticket.vendor_id)
        .maybeSingle()
      vendorName = typeof vendor?.name === "string" ? vendor.name : null
    }

    let residentName: string | null = null
    if (ticket.resident_id) {
      const { data: resident } = await db
        .from("users")
        .select("full_name, first_name")
        .eq("id", ticket.resident_id)
        .maybeSingle()
      residentName =
        (typeof resident?.full_name === "string" && resident.full_name) ||
        (typeof resident?.first_name === "string" && resident.first_name) ||
        null
    }

    let building: string | null = null
    if (ticket.property_id) {
      const { data: property } = await db
        .from("properties")
        .select("name, address")
        .eq("id", ticket.property_id)
        .maybeSingle()
      building =
        (typeof property?.name === "string" && property.name) ||
        (typeof property?.address === "string" && property.address) ||
        null
    }

    const { data: events } = await db
      .from("operations_graph_events")
      .select("event_type, metadata, created_at, vendor_id")
      .eq("maintenance_request_id", id)
      .order("created_at", { ascending: true })
      .limit(40)

    const milestoneEvents: FeedMilestoneEvent[] = (events ?? []).map(
      (row: {
        event_type?: string
        metadata?: Record<string, unknown> | null
        created_at?: string
      }) => ({
        eventType: String(row.event_type ?? ""),
        message:
          typeof row.metadata?.message === "string" ? row.metadata.message : null,
        label: null,
        vendorName: null,
        createdAt: row.created_at ?? null,
        metadata: row.metadata ?? null,
      }),
    )

    const cached =
      ticket.feed_card_copy && typeof ticket.feed_card_copy === "object"
        ? (ticket.feed_card_copy as FeedCardCopyCache)
        : null

    const copy = await writeFeedCardCopy({
      ticket: {
        issueHeadline: ticket.issue_headline,
        building,
        unitLabel: ticket.unit,
        vendorName,
        residentName,
        awaitingLandlordChoiceAt: ticket.awaiting_landlord_choice_at,
        vendorWorkStatus: ticket.vendor_work_status,
        spendStatus: ticket.spend_status,
        scheduleConfirmedAt: ticket.schedule_confirmed_at,
        scheduledAt: ticket.scheduled_at,
        recognizedSpendAmount: ticket.recognized_spend_amount,
        estimateAmount: ticket.estimate_amount,
        completedAt: ticket.completed_at,
        cancelledAt: ticket.cancelled_at,
      },
      events: milestoneEvents,
      cached,
      skipLlm: options?.skipLlm,
      openaiKey: options?.openaiKey,
    })

    if (!cached || cached.facts_hash !== copy.facts_hash || cached.headline !== copy.headline) {
      await persistFeedCardCopy(db, id, copy)
    }
    return copy
  } catch (error) {
    console.warn(
      "[refreshFeedCardCopyForTicket]",
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

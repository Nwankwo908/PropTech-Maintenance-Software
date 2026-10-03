/**
 * Cron processor: flag maintenance.vendor_choice_selected events with no
 * confirming inbound sms_messages row in the preceding ~2 minutes (WO-E6F7).
 *
 * Report-only — never auto-heals. Review with:
 *   node scripts/audit-vendor-choice-triggers.mjs
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  findPhantomVendorChoiceSelected,
  VENDOR_CHOICE_TRIGGER_WINDOW_MS,
  type VendorChoiceSelectedEvent,
  type InboundSmsMessageRow,
} from "../../../shared/ops/vendorChoiceTriggerAudit.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"

export type VendorChoiceTriggerAuditSummary = {
  eventsScanned: number
  phantoms: number
  landlordsWithPhantoms: number
  dryRun: boolean
  since: string | null
}

function isoMinusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString()
}

export async function processVendorChoiceTriggerAudits(
  supabase: SupabaseClient,
  options: {
    landlordId?: string | null
    dryRun?: boolean
    /** Inclusive lower bound on event created_at (ISO). */
    since?: string | null
  } = {},
): Promise<VendorChoiceTriggerAuditSummary> {
  const dryRun = options.dryRun === true
  const since = options.since?.trim() || null

  let query = supabase
    .from("operations_graph_events")
    .select(
      "id, created_at, landlord_id, conversation_id, message_id, maintenance_request_id, metadata",
    )
    .eq("event_type", "maintenance.vendor_choice_selected")
    .order("created_at", { ascending: true })
    .limit(2000)

  if (options.landlordId?.trim()) {
    query = query.eq("landlord_id", options.landlordId.trim())
  }
  if (since) {
    query = query.gte("created_at", since)
  }

  const { data: events, error } = await query
  if (error) throw new Error(error.message)

  const rows = (events ?? []) as VendorChoiceSelectedEvent[]
  if (rows.length === 0) {
    return {
      eventsScanned: 0,
      phantoms: 0,
      landlordsWithPhantoms: 0,
      dryRun,
      since,
    }
  }

  const earliest = rows[0]!.created_at
  const windowStart = isoMinusMs(earliest, VENDOR_CHOICE_TRIGGER_WINDOW_MS)
  const latest = rows[rows.length - 1]!.created_at

  let inboundQuery = supabase
    .from("sms_messages")
    .select("id, created_at, conversation_id, landlord_id, direction")
    .eq("direction", "inbound")
    .gte("created_at", windowStart)
    .lte("created_at", latest)
    .limit(5000)

  if (options.landlordId?.trim()) {
    inboundQuery = inboundQuery.eq("landlord_id", options.landlordId.trim())
  }

  const { data: inbound, error: inboundErr } = await inboundQuery
  if (inboundErr) throw new Error(inboundErr.message)

  const phantoms = findPhantomVendorChoiceSelected({
    events: rows,
    inboundMessages: (inbound ?? []) as InboundSmsMessageRow[],
  })

  const byLandlord = new Map<string, typeof phantoms>()
  for (const phantom of phantoms) {
    const list = byLandlord.get(phantom.landlordId) ?? []
    list.push(phantom)
    byLandlord.set(phantom.landlordId, list)
  }

  if (!dryRun) {
    for (const [landlordId, list] of byLandlord) {
      console.warn(
        `[vendor-choice-trigger-audit] landlord=${landlordId} phantoms=${list.length}`,
        list.map((p) => p.eventId),
      )
      try {
        await recordActivityLog(supabase, {
          landlordId,
          eventType: "maintenance.vendor_choice_selected_unverified",
          source: "automation",
          actorType: "system",
          metadata: {
            message:
              `Vendor-choice audit found ${list.length} assignment(s) with no confirming inbound SMS in the prior 2 minutes. Review scripts/audit-vendor-choice-triggers.mjs.`,
            phantom_event_ids: list.map((p) => p.eventId),
            phantom_count: list.length,
          },
        })
      } catch (err) {
        console.error("[vendor-choice-trigger-audit] activity log failed", err)
      }
    }
  } else {
    for (const [landlordId, list] of byLandlord) {
      console.warn(
        `[vendor-choice-trigger-audit:dry-run] landlord=${landlordId} phantoms=${list.length}`,
        list.map((p) => p.eventId),
      )
    }
  }

  return {
    eventsScanned: rows.length,
    phantoms: phantoms.length,
    landlordsWithPhantoms: byLandlord.size,
    dryRun,
    since,
  }
}

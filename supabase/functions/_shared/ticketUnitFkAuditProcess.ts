/**
 * Cron processor: scan landlords for ticket/conversation unit_id that
 * disagrees with resident occupancy (WO-C2C7 write-time corruption class).
 *
 * Report-only — never auto-heals. Manual heal:
 *   HEAL=1 node scripts/audit-ticket-unit-fk-mismatches.mjs
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  findConversationUnitFkMismatches,
  findTicketUnitFkMismatches,
} from "../../../shared/ops/ticketUnitFkAudit.ts"
import { listLandlordIdsForCron } from "./cronLandlords.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"

export type TicketUnitFkAuditSummary = {
  landlordsScanned: number
  ticketMismatches: number
  conversationMismatches: number
  landlordsWithMismatches: number
  dryRun: boolean
}

async function auditLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ ticketMismatches: number; conversationMismatches: number }> {
  const [
    { data: units },
    { data: occupancy },
    { data: residents },
    { data: tickets },
    { data: convos },
  ] = await Promise.all([
    supabase
      .from("units")
      .select("id, unit_label, building, property_id")
      .eq("landlord_id", landlordId),
    supabase
      .from("occupancy")
      .select("unit_id, resident_id")
      .eq("landlord_id", landlordId)
      .eq("status", "active"),
    supabase
      .from("users")
      .select("id, full_name, unit, building, email")
      .eq("landlord_id", landlordId),
    supabase
      .from("maintenance_requests")
      .select(
        "id, unit, unit_id, property_id, email, description, vendor_work_status, resident_user_id",
      )
      .eq("landlord_id", landlordId)
      .order("created_at", { ascending: false })
      .limit(800),
    supabase
      .from("sms_conversations")
      .select("id, resident_id, unit_id, maintenance_request_id")
      .eq("landlord_id", landlordId)
      .not("resident_id", "is", null)
      .not("unit_id", "is", null)
      .limit(800),
  ])

  const ticketIds = (tickets ?? []).map((t) => t.id as string)
  const { data: runs } = ticketIds.length
    ? await supabase
      .from("workflow_runs")
      .select("id, entity_id, property_id, unit_id, resident_id")
      .eq("landlord_id", landlordId)
      .eq("template_id", "maintenance_request")
      .in("entity_id", ticketIds)
    : { data: [] }

  const ticketMismatches = findTicketUnitFkMismatches({
    units: (units ?? []) as Array<{
      id: string
      unit_label?: string | null
      building?: string | null
      property_id?: string | null
    }>,
    residents: (residents ?? []) as Array<{
      id: string
      full_name?: string | null
      unit?: string | null
      building?: string | null
      email?: string | null
    }>,
    occupancy: (occupancy ?? []) as Array<{ resident_id: string; unit_id: string }>,
    tickets: (tickets ?? []) as Array<{
      id: string
      unit?: string | null
      unit_id?: string | null
      property_id?: string | null
      email?: string | null
      description?: string | null
      vendor_work_status?: string | null
      resident_user_id?: string | null
    }>,
    runs: (runs ?? []) as Array<{
      id: string
      entity_id: string
      property_id?: string | null
      unit_id?: string | null
      resident_id?: string | null
    }>,
  })

  const conversationMismatches = findConversationUnitFkMismatches({
    residents: (residents ?? []) as Array<{
      id: string
      full_name?: string | null
      unit?: string | null
      building?: string | null
      email?: string | null
    }>,
    occupancy: (occupancy ?? []) as Array<{ resident_id: string; unit_id: string }>,
    conversations: (convos ?? []) as Array<{
      id: string
      resident_id: string
      unit_id: string
      maintenance_request_id?: string | null
    }>,
  })

  return {
    ticketMismatches: ticketMismatches.length,
    conversationMismatches: conversationMismatches.length,
  }
}

export async function processTicketUnitFkAudits(
  supabase: SupabaseClient,
  opts: {
    landlordId?: string | null
    dryRun?: boolean
  } = {},
): Promise<TicketUnitFkAuditSummary> {
  const dryRun = opts.dryRun === true
  let landlordIds: string[] = []
  if (opts.landlordId?.trim()) {
    landlordIds = [opts.landlordId.trim()]
  } else {
    landlordIds = await listLandlordIdsForCron(supabase)
  }

  let ticketMismatches = 0
  let conversationMismatches = 0
  let landlordsWithMismatches = 0

  for (const landlordId of landlordIds) {
    const result = await auditLandlord(supabase, landlordId)
    ticketMismatches += result.ticketMismatches
    conversationMismatches += result.conversationMismatches
    if (result.ticketMismatches + result.conversationMismatches > 0) {
      landlordsWithMismatches += 1
      console.warn(
        `[ticket-unit-fk-audit] landlord=${landlordId} tickets=${result.ticketMismatches} convos=${result.conversationMismatches}`,
      )
      if (!dryRun) {
        await recordActivityLog(supabase, {
          landlordId,
          eventType: "ops.ticket_unit_fk_mismatch",
          source: "automation",
          actorType: "system",
          metadata: {
            message:
              `Unit/property FK audit found ${result.ticketMismatches} ticket and ${result.conversationMismatches} conversation mismatch(es). Run scripts/audit-ticket-unit-fk-mismatches.mjs to review.`,
            ticket_mismatches: result.ticketMismatches,
            conversation_mismatches: result.conversationMismatches,
          },
        }).catch((err) => {
          console.error("[ticket-unit-fk-audit] activity log failed", err)
        })
      }
    }
  }

  return {
    landlordsScanned: landlordIds.length,
    ticketMismatches,
    conversationMismatches,
    landlordsWithMismatches,
    dryRun,
  }
}

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  canHandlePmServiceYesHvac,
  PM_SERVICE_ASK_KEY,
  resolveYesHvacReply,
} from "../../../shared/pm/pmServiceAttention.ts"

type TaskRow = {
  id: string
  metadata: Record<string, unknown> | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export async function tryHandlePmServiceYesHvacInbound(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    conversationId: string
    body: string
  },
): Promise<{ handled: boolean; replyBody?: string }> {
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", input.conversationId)
    .maybeSingle()
  const intake = asRecord(conv?.intake_state)
  if (!canHandlePmServiceYesHvac({ body: input.body, intakeState: intake })) {
    return { handled: false }
  }

  const ask = asRecord(intake[PM_SERVICE_ASK_KEY])
  const batchId = typeof ask.batchId === "string" ? ask.batchId : ""
  const { data } = await supabase
    .from("preventive_maintenance_tasks")
    .select("id, metadata")
    .eq("landlord_id", input.landlordId)
    .limit(500)
  const rows = ((data ?? []) as TaskRow[]).filter((row) => {
    const meta = asRecord(row.metadata)
    return meta.pm_batch_id === batchId
  })
  const resolvedInApp = rows.some((row) => asRecord(row.metadata).pm_resolution === "app")
  const reply = resolveYesHvacReply({ resolution: resolvedInApp ? "app" : null })

  if (!resolvedInApp) {
    for (const row of rows) {
      const meta = asRecord(row.metadata)
      await supabase
        .from("preventive_maintenance_tasks")
        .update({
          metadata: { ...meta, pm_resolution: "sms", pm_phase: "scheduled" },
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
    }
  }

  const nextIntake = { ...intake }
  delete nextIntake[PM_SERVICE_ASK_KEY]
  await supabase
    .from("sms_conversations")
    .update({ intake_state: nextIntake, updated_at: new Date().toISOString() })
    .eq("id", input.conversationId)

  await recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: resolvedInApp ? "pm_service.already_approved" : "pm_service.approved_sms",
    source: "sms",
    actorType: "landlord",
    conversationId: input.conversationId,
    metadata: {
      message: resolvedInApp
        ? "HVAC approval was already completed in the app."
        : "Preventive HVAC approved by text.",
      batchId,
    },
  })

  return { handled: true, replyBody: reply.reply }
}

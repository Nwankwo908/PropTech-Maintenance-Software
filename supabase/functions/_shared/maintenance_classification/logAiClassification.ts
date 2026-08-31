/**
 * Best-effort persist of classification gold. Never throw into intake / submit.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  aiClassificationLogRow,
  type AiClassificationLogInput,
  AI_CLASSIFICATION_LOG_TEXT_MAX,
} from "../../../../shared/maintenance/aiClassificationLog.ts"

export async function insertAiClassificationLog(
  supabase: SupabaseClient,
  input: AiClassificationLogInput,
): Promise<string | null> {
  const landlordId = input.landlordId?.trim()
  if (!landlordId) return null
  try {
    const { data, error } = await supabase
      .from("ai_classification_log")
      .insert(aiClassificationLogRow({ ...input, landlordId }))
      .select("id")
      .maybeSingle()
    if (error) {
      console.warn("[ai_classification_log] insert failed", error.message)
      return null
    }
    return typeof data?.id === "string" ? data.id : null
  } catch (err) {
    console.warn("[ai_classification_log] insert failed", err)
    return null
  }
}

export async function attachAiClassificationLogToTicket(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId?: string | null
    maintenanceRequestId: string
    rawMessage?: string | null
  },
): Promise<void> {
  const ticketId = params.maintenanceRequestId.trim()
  const landlordId = params.landlordId.trim()
  const conversationId = params.conversationId?.trim()
  if (!ticketId || !landlordId || !conversationId) return
  try {
    let q = supabase
      .from("ai_classification_log")
      .update({ maintenance_request_id: ticketId })
      .eq("landlord_id", landlordId)
      .eq("conversation_id", conversationId)
      .is("maintenance_request_id", null)
    const raw = params.rawMessage?.trim()
    if (raw) {
      q = q.eq("raw_message", raw.slice(0, AI_CLASSIFICATION_LOG_TEXT_MAX))
    }
    const { error } = await q
    if (error) {
      console.warn("[ai_classification_log] attach ticket failed", error.message)
    }
  } catch (err) {
    console.warn("[ai_classification_log] attach ticket failed", err)
  }
}

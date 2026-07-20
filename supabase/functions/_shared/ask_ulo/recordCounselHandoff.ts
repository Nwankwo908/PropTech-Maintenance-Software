/**
 * Record a human-expert handoff from Ask Ulo (operations graph event).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  counselExpertRole,
  parseCounselExpertRoleId,
  type CounselExpertRoleId,
} from "./counselHandoff.ts"

export type CounselHandoffResult = {
  ok: true
  eventId: string | null
  expertRole: CounselExpertRoleId
  expertLabel: string
  confirmationMarkdown: string
}

export async function recordCounselHandoff(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    expertRole: string
    conversationId?: string | null
    messageId?: string | null
    question?: string | null
    answerExcerpt?: string | null
    sensitiveTopicIds?: string[]
    note?: string | null
    stateCode?: string | null
    cityLabel?: string | null
  },
): Promise<CounselHandoffResult | { ok: false; error: string }> {
  const expertRole = parseCounselExpertRoleId(input.expertRole)
  if (!expertRole) {
    return { ok: false, error: "expertRole is invalid" }
  }
  const landlordId = input.landlordId.trim()
  if (!landlordId) {
    return { ok: false, error: "landlordId is required" }
  }

  const role = counselExpertRole(expertRole)
  const askUloConversationId = input.conversationId?.trim() || null
  const askUloMessageId = input.messageId?.trim() || null
  const eventId = await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "ask_ulo.counsel_handoff",
    source: "dashboard",
    actor_type: "landlord",
    // Do not set conversation_id / message_id columns — those FKs are SMS tables.
    metadata: {
      expert_role: expertRole,
      expert_label: role.label,
      ask_ulo_conversation_id: askUloConversationId,
      ask_ulo_message_id: askUloMessageId,
      question: (input.question ?? "").slice(0, 500) || null,
      answer_excerpt: (input.answerExcerpt ?? "").slice(0, 800) || null,
      sensitive_topics: input.sensitiveTopicIds ?? [],
      note: (input.note ?? "").slice(0, 500) || null,
      state_code: input.stateCode ?? null,
      city_label: input.cityLabel ?? null,
    },
  })

  const confirmationMarkdown = [
    "## Flagged for human review",
    `Logged for **${role.label}**.`,
    role.whenToUse,
    "",
    "Ulo will keep helping you prepare context — the professional you flagged should make the judgment call.",
    input.note?.trim() ? `\n_Your note:_ ${input.note.trim().slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  return {
    ok: true,
    eventId,
    expertRole,
    expertLabel: role.label,
    confirmationMarkdown,
  }
}

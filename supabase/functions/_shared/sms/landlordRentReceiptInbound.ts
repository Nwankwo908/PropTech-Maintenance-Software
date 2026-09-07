/**
 * Landlord YES / NO / PARTIAL on a pending rent-receipt ask.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  handleLandlordRentReceiptReply,
  hasLandlordRentReceiptPending,
} from "../engine/rentReceiptConfirmation.ts"

export function canHandleLandlordRentReceiptInbound(params: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (params.identityType === "resident" || params.identityType === "vendor") {
    return false
  }
  return hasLandlordRentReceiptPending(params.intakeState)
}

export async function tryHandleLandlordRentReceiptInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    messageId?: string | null
  },
): Promise<{ handled: true; replyBody: string } | { handled: false }> {
  return handleLandlordRentReceiptReply(supabase, params)
}

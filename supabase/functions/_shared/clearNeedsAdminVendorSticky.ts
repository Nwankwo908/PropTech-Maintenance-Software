/**
 * Clear sticky needs_admin_vendor hold on a maintenance ticket so automation
 * may rematch again (after a person assigns a vendor, or explicit release).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export async function clearNeedsAdminVendorSticky(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<void> {
  const id = ticketId.trim()
  if (!id) return
  await supabase
    .from("maintenance_requests")
    .update({
      auto_reassign_last_outcome: null,
      auto_reassign_same_outcome_count: 0,
      auto_reassign_same_outcome_since: null,
    })
    .eq("id", id)
}

/**
 * Explicit hand-back: clear sticky hold so the next cron may rematch.
 */
export async function releaseNeedsAdminVendorToAutomation(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<void> {
  await clearNeedsAdminVendorSticky(supabase, ticketId)
}

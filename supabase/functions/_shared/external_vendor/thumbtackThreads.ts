import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  mapThumbtackThreadRow,
  type ThumbtackVendorThreadRow,
} from "./thumbtackThreadTypes.ts"

export async function listThumbtackThreadsForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<ThumbtackVendorThreadRow[]> {
  const { data, error } = await supabase
    .from("thumbtack_vendor_threads")
    .select("*")
    .eq("ticket_id", ticketId)
  if (error || !data) {
    if (error) console.warn("[thumbtack-messages] list threads", error.message)
    return []
  }
  return data.map((row) => mapThumbtackThreadRow(row as Record<string, unknown>))
}

export type { ThumbtackVendorThreadRow, ThumbtackThreadStatus } from "./thumbtackThreadTypes.ts"

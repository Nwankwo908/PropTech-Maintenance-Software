import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Decode SMS/email wrapping and require a UUID job token. */
export function normalizeVendorJobToken(raw: string | null | undefined): string {
  let t = (raw ?? "").trim()
  if (!t) return ""
  try {
    t = decodeURIComponent(t).trim()
  } catch {
    /* already decoded */
  }
  t = t.replace(/^["']+|["']+$/g, "").trim()
  const pathMatch = t.match(/\/(?:w|estimate|upload|invoice)\/([0-9a-f-]{36})/i)
  if (pathMatch?.[1]) t = pathMatch[1]
  return UUID_RE.test(t) ? t : ""
}

/** Assigned vendor for this unique job link (`maintenance_requests.vendor_action_token`). */
export async function getVendorFromJobActionToken(
  supabase: SupabaseClient,
  token: string,
): Promise<{ id: string; name: string } | null> {
  const k = normalizeVendorJobToken(token)
  if (!k) return null

  const { data: ticket, error: ticketErr } = await supabase
    .from("maintenance_requests")
    .select("assigned_vendor_id")
    .eq("vendor_action_token", k)
    .maybeSingle()

  if (ticketErr) {
    console.error("[vendor-job-token] ticket lookup", ticketErr.message)
    return null
  }

  const vendorId =
    typeof ticket?.assigned_vendor_id === "string"
      ? ticket.assigned_vendor_id.trim()
      : ""
  if (!vendorId) return null

  const { data: vendor, error: vendorErr } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("id", vendorId)
    .eq("active", true)
    .maybeSingle()

  if (vendorErr) {
    console.error("[vendor-job-token] vendor lookup", vendorErr.message)
    return null
  }
  if (!vendor?.id) return null
  return {
    id: vendor.id as string,
    name: typeof vendor.name === "string" ? vendor.name : "",
  }
}

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Row shape for vendor pick + notify (matches `vendors` select used by vendor_notify). */
export type VendorAssignmentRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notification_channel: string
  active: boolean
  category: string | null
  /** Stable portal auth key (`/vendor?k=`); required for email/SMS portal links. */
  portal_api_key: string | null
  last_assigned_at: string | null
  created_at: string
}

function normalize(str: string | null | undefined): string {
  return (str || "").trim().toLowerCase()
}

/**
 * Flexible match: vendor label and ticket issue can overlap by substring (e.g. "Appliance repair" vs "appliance").
 * Empty vendor category is treated as non-matching here (generalists use `isGeneralist` in tier 2).
 */
function categoryMatches(
  vendorCategory: string | null,
  issueCategory: string | null,
): boolean {
  const v = normalize(vendorCategory)
  const i = normalize(issueCategory)

  if (!i) return true
  if (!v) return false

  return v.includes(i) || i.includes(v)
}

function isGeneralist(v: { category: string | null }): boolean {
  return v.category == null || String(v.category).trim() === ""
}

export async function loadDeclinedVendorIdsForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("vendor_status_events")
    .select("vendor_id")
    .eq("ticket_id", ticketId)
    .eq("to_status", "declined")

  if (error) {
    console.error("[vendor-assignment] load decline events", error)
    return []
  }
  const ids = new Set<string>()
  for (const row of data ?? []) {
    const vid = row.vendor_id as string | null
    if (vid) ids.add(vid)
  }
  return [...ids]
}

async function loadActiveJobCounts(
  supabase: SupabaseClient,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("assigned_vendor_id")
    .in("vendor_work_status", ["pending_accept", "accepted"])
    .not("assigned_vendor_id", "is", null)

  if (error) {
    console.error("[vendor-assignment] active job counts", error)
    return counts
  }
  for (const row of data ?? []) {
    const id = row.assigned_vendor_id as string | null
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * Vendor who received an assignment most recently (for optional fairness skip).
 */
export async function loadMostRecentlyAssignedVendorId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id")
    .eq("active", true)
    .not("last_assigned_at", "is", null)
    .order("last_assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[vendor-assignment] most recent assignee", error)
    return null
  }
  return (data?.id as string | undefined) ?? null
}

function lastAssignedSortKey(iso: string | null | undefined): number {
  if (iso == null || iso === "") return -1
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? -1 : t
}

function rankVendorCandidates(
  candidates: VendorAssignmentRow[],
  counts: Map<string, number>,
  avoid: string | null,
): VendorAssignmentRow | null {
  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const ca = counts.get(a.id) ?? 0
    const cb = counts.get(b.id) ?? 0
    if (ca !== cb) return ca - cb
    const ta = lastAssignedSortKey(a.last_assigned_at)
    const tb = lastAssignedSortKey(b.last_assigned_at)
    if (ta !== tb) return ta - tb
    const ac = new Date(a.created_at).getTime()
    const bc = new Date(b.created_at).getTime()
    return ac - bc
  })

  if (
    avoid &&
    candidates.length > 1 &&
    candidates[0]?.id === avoid
  ) {
    return candidates[1] ?? candidates[0]
  }

  return candidates[0] ?? null
}

export type PickVendorForAssignmentOptions = {
  issueCategory: string | null
  excludeVendorIds: string[]
  /**
   * If the top-ranked vendor is this id and another vendor exists, pick the next one
   * (avoid back-to-back assignments when alternatives exist).
   */
  preferNotVendorId?: string | null
}

/**
 * Tiered vendor selection:
 * 1) Vendors whose `category` flexibly matches the ticket `issue_category` (substring, case-insensitive)
 * 2) Generalists (`category` null or empty)
 * 3) Any remaining active vendor (last resort)
 *
 * Within each tier: lowest active job count, then fairness on `last_assigned_at` / `created_at`.
 */
export async function pickVendorForAssignment(
  supabase: SupabaseClient,
  options: PickVendorForAssignmentOptions,
): Promise<VendorAssignmentRow | null> {
  const excluded = new Set(options.excludeVendorIds.filter(Boolean))
  const issueCat = options.issueCategory ?? null
  const avoid = options.preferNotVendorId?.trim() ?? null

  const { data: rows, error } = await supabase
    .from("vendors")
    .select(
      "id,name,email,phone,notification_channel,active,category,portal_api_key,last_assigned_at,created_at",
    )
    .eq("active", true)

  if (error) {
    console.error("[vendor-assignment] list vendors", error)
    return null
  }

  const base = (rows ?? []).filter((v) => {
    const row = v as VendorAssignmentRow
    return !excluded.has(row.id)
  }) as VendorAssignmentRow[]

  if (base.length === 0) return null

  const counts = await loadActiveJobCounts(supabase)
  const issueKey = normalize(issueCat)

  const strict = base.filter((v) => {
    if (!issueKey) return false
    return categoryMatches(v.category, issueCat)
  })
  const tier1 = rankVendorCandidates(strict, counts, avoid)
  if (tier1) return tier1

  const generalists = base.filter(isGeneralist)
  const tier2 = rankVendorCandidates(generalists, counts, avoid)
  if (tier2) return tier2

  return rankVendorCandidates(base, counts, avoid)
}

export async function touchVendorLastAssignedAt(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<void> {
  const at = new Date().toISOString()
  const { error } = await supabase
    .from("vendors")
    .update({ last_assigned_at: at })
    .eq("id", vendorId)

  if (error) {
    console.error("[vendor-assignment] touch last_assigned_at", error)
  }
}

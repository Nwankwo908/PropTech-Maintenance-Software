import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { MarketplacePreferenceId } from "./landlordNotificationPrefs.ts"
import { vendorTradeMatchesForDispatch } from "./vendor_trades.ts"
import {
  countVendorWeeklyAssignments,
  maybeAutoPauseVendorAtWeeklyCap,
} from "./vendor_capacity.ts"
import { landlordHasVendorMarketplace } from "../../../shared/landlordCapabilities.ts"

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
  /** Platform hold: suspended | banned | null */
  roster_status?: string | null
  /** Optional weekly dispatch cap (JOBS MAX n). */
  weekly_job_cap?: number | null
  /** Preferred for emergency / after-hours dispatch (onboarding flag). */
  preferred_emergency?: boolean | null
  /** True when roster row came from external vendor discovery. */
  onboarded_from_external?: boolean | null
  /** Landlord activated without verification documents. */
  onboarding_overridden_at?: string | null
}

/**
 * Matching eligibility — only ACTIVE vendors may receive dispatch.
 * ACTIVE = verified (or landlord onboarding override) + accepting work + not platform-held.
 */
export function isVendorMatchableForDispatch(input: {
  verificationStatus?: string | null
  vendorActive?: boolean | null
  availability?: string | null
  rosterStatus?: string | null
  onboardingOverriddenAt?: string | null
}): boolean {
  const roster = (input.rosterStatus ?? "").trim().toLowerCase()
  if (roster === "banned" || roster === "suspended") return false

  const availability = (input.availability ?? "").trim().toLowerCase()
  if (availability === "paused") return false
  if (input.vendorActive === false) return false

  const verification = (input.verificationStatus ?? "").trim().toLowerCase()
  const overridden = Boolean((input.onboardingOverriddenAt ?? "").trim())
  if (verification !== "verified" && !overridden) return false

  return true
}

/** Ulo-vetted-only pools exclude externally discovered roster vendors. */
export function vendorAllowedForMarketplace(
  vendor: Pick<VendorAssignmentRow, "onboarded_from_external">,
  preference: MarketplacePreferenceId,
): boolean {
  if (preference === "ulo_vetted_only" && vendor.onboarded_from_external === true) {
    return false
  }
  return true
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
  /** When set, only consider vendors for this landlord. */
  landlordId?: string | null
  /**
   * When true (emergency / critical tickets), prefer vendors marked
   * `preferred_emergency` within each matching tier before falling back.
   */
  preferPreferredEmergency?: boolean
  /** Landlord vendor pool preference from organization settings. */
  marketplacePreference?: MarketplacePreferenceId
}

/**
 * Pick only Active vendors whose trade matches the ticket.
 * No matching trade (or none Active) → null so the job stays unassigned
 * and Find External Vendor / admin assign can run. Do not last-resort a
 * different trade (e.g. plumber for an oven).
 *
 * Within the matching pool: preferred-emergency first (when requested), then
 * lowest active job count, then fairness on `last_assigned_at` / `created_at`.
 */
export async function pickVendorForAssignment(
  supabase: SupabaseClient,
  options: PickVendorForAssignmentOptions,
): Promise<VendorAssignmentRow | null> {
  const excluded = new Set(options.excludeVendorIds.filter(Boolean))
  const issueCat = options.issueCategory ?? null
  const avoid = options.preferNotVendorId?.trim() ?? null
  const preferEmergency = options.preferPreferredEmergency === true
  const marketplacePreference = landlordHasVendorMarketplace(options.landlordId)
    ? (options.marketplacePreference ?? "include_imported")
    : "include_imported"

  let query = supabase
    .from("vendors")
    .select(
      "id,name,email,phone,notification_channel,active,category,portal_api_key,last_assigned_at,created_at,roster_status,weekly_job_cap,preferred_emergency,onboarded_from_external,onboarding_overridden_at",
    )
    .eq("active", true)

  const landlordId = options.landlordId?.trim() || null
  if (landlordId) {
    query = query.eq("landlord_id", landlordId)
  }

  const { data: rows, error } = await query

  if (error) {
    console.error("[vendor-assignment] list vendors", error)
    return null
  }

  const candidates = (rows ?? []).filter((v) => {
    const row = v as VendorAssignmentRow
    return !excluded.has(row.id)
  }) as VendorAssignmentRow[]

  if (candidates.length === 0) return null

  const candidateIds = candidates.map((v) => v.id)
  const verificationByVendor = new Map<
    string,
    { status: string | null; availability: string | null }
  >()
  if (candidateIds.length > 0) {
    let verifQuery = supabase
      .from("vendor_verifications")
      .select("vendor_id, status, availability, updated_at")
      .in("vendor_id", candidateIds)
      .order("updated_at", { ascending: false })
    if (landlordId) {
      verifQuery = verifQuery.eq("landlord_id", landlordId)
    }
    const { data: verifs, error: verifErr } = await verifQuery
    if (verifErr) {
      console.error("[vendor-assignment] list verifications", verifErr)
    } else {
      for (const raw of verifs ?? []) {
        const rec = raw as Record<string, unknown>
        const vendorId = typeof rec.vendor_id === "string" ? rec.vendor_id : ""
        if (!vendorId || verificationByVendor.has(vendorId)) continue
        verificationByVendor.set(vendorId, {
          status: typeof rec.status === "string" ? rec.status : null,
          availability: typeof rec.availability === "string" ? rec.availability : null,
        })
      }
    }
  }

  const matchable = candidates.filter((v) => {
    if (!vendorAllowedForMarketplace(v, marketplacePreference)) return false
    const verif = verificationByVendor.get(v.id)
    return isVendorMatchableForDispatch({
      verificationStatus: verif?.status ?? null,
      // Account readiness only — capacity pause is availability on verification.
      vendorActive: v.active,
      availability: verif?.availability ?? null,
      rosterStatus: v.roster_status ?? null,
      onboardingOverriddenAt: v.onboarding_overridden_at ?? null,
    })
  })

  const underWeeklyCap: VendorAssignmentRow[] = []
  for (const vendor of matchable) {
    const cap = vendor.weekly_job_cap
    if (cap == null || !Number.isFinite(Number(cap))) {
      underWeeklyCap.push(vendor)
      continue
    }
    const limit = Math.max(0, Math.floor(Number(cap)))
    const weeklyCount = await countVendorWeeklyAssignments(supabase, vendor.id)
    if (weeklyCount < limit) underWeeklyCap.push(vendor)
  }

  const base = underWeeklyCap
  if (base.length === 0) return null

  const counts = await loadActiveJobCounts(supabase)

  function pickFromTier(tier: VendorAssignmentRow[]): VendorAssignmentRow | null {
    if (tier.length === 0) return null
    if (preferEmergency) {
      const preferred = tier.filter((v) => v.preferred_emergency === true)
      const fromPreferred = rankVendorCandidates(preferred, counts, avoid)
      if (fromPreferred) return fromPreferred
    }
    return rankVendorCandidates(tier, counts, avoid)
  }

  const matchingTrade = base.filter((v) =>
    vendorTradeMatchesForDispatch(v.category, issueCat)
  )
  return pickFromTier(matchingTrade)
}

export async function touchVendorLastAssignedAt(
  supabase: SupabaseClient,
  vendorId: string,
  landlordId?: string | null,
): Promise<void> {
  const at = new Date().toISOString()
  const { error } = await supabase
    .from("vendors")
    .update({ last_assigned_at: at })
    .eq("id", vendorId)

  if (error) {
    console.error("[vendor-assignment] touch last_assigned_at", error)
  }

  const lid = landlordId?.trim()
  if (lid) {
    await maybeAutoPauseVendorAtWeeklyCap(supabase, {
      landlordId: lid,
      vendorId,
    })
  }
}

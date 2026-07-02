import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { ExternalDiscoverySnapshot, ExternalVendorSource } from "./types.ts"

export type ExternalVendorOnboardInput = {
  vendorName: string
  vendorCategory?: string | null
  sources?: ExternalVendorSource[]
  rating?: number | null
  reviewCount?: number | null
  priceLabel?: string | null
  rankScore?: number | null
}

export type ResolveExternalVendorResult =
  | { vendorId: string; createdVendor: boolean }
  | { error: string }

function normName(name: string): string {
  return name.trim().toLowerCase()
}

function discoverySnapshot(input: ExternalVendorOnboardInput): ExternalDiscoverySnapshot {
  return {
    sources: input.sources ?? [],
    rating: input.rating ?? null,
    review_count: input.reviewCount ?? null,
    price_label: input.priceLabel ?? null,
    rank_score: input.rankScore ?? null,
  }
}

async function findActiveVendorByName(
  supabase: SupabaseClient,
  landlordId: string,
  vendorName: string,
): Promise<{ id: string; name: string } | null> {
  const needle = vendorName
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")

  const { data: rows, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("landlord_id", landlordId)
    .eq("active", true)
    .ilike("name", needle)
    .limit(25)

  if (error) {
    console.error("[external-vendor/onboard] vendor lookup", error)
    return null
  }

  const want = normName(vendorName)
  const matches = (rows ?? []).filter(
    (r) => typeof r.name === "string" && normName(r.name) === want,
  )
  if (matches.length !== 1) return null
  return { id: String(matches[0].id), name: String(matches[0].name) }
}

async function createExternalVendor(
  supabase: SupabaseClient,
  landlordId: string,
  input: ExternalVendorOnboardInput,
): Promise<{ id: string } | { error: string }> {
  const snapshot = discoverySnapshot(input)
  const { data, error } = await supabase
    .from("vendors")
    .insert({
      name: input.vendorName.trim(),
      category: input.vendorCategory?.trim() || null,
      active: true,
      notification_channel: "email",
      landlord_id: landlordId,
      onboarded_from_external: true,
      external_discovery: snapshot,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[external-vendor/onboard] create vendor", error)
    return { error: "Could not create vendor record" }
  }
  return { id: String(data.id) }
}

/** Find or create a landlord-scoped roster vendor for an external suggestion. */
export async function resolveVendorIdForExternalReassign(
  supabase: SupabaseClient,
  landlordId: string,
  input: ExternalVendorOnboardInput,
  issueCategoryFallback: string | null,
): Promise<ResolveExternalVendorResult> {
  const vendorName = input.vendorName.trim()
  if (!vendorName) return { error: "vendorName is required" }

  const existing = await findActiveVendorByName(supabase, landlordId, vendorName)
  if (existing) {
    return { vendorId: existing.id, createdVendor: false }
  }

  const category =
    input.vendorCategory?.trim() || issueCategoryFallback?.trim() || null

  const created = await createExternalVendor(supabase, landlordId, {
    ...input,
    vendorCategory: category,
  })
  if ("error" in created) return { error: created.error }
  return { vendorId: created.id, createdVendor: true }
}

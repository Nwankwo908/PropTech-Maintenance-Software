import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  homeDataFactsToRow,
  homeDataSnapshotFromRow,
  type HomeDataGraphRow,
  type HomeDataGraphSnapshot,
  type HomeDataIngestResult,
} from "../../../../shared/homeDataGraph.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"

/** Canonical write: Home Data Graph facts + ingest audit. Callers pass adapter output, not vendor columns. */
export async function persistHomeDataGraph(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    propertyId: string
    ingest: HomeDataIngestResult
  },
): Promise<{ ok: true; snapshot: HomeDataGraphSnapshot } | { ok: false; error: string }> {
  const fetchedAt = new Date().toISOString()
  const { ingest } = input
  const row = {
    property_id: input.propertyId,
    landlord_id: input.landlordId,
    ...homeDataFactsToRow(ingest.facts),
    rent_lookup_complete: true,
    source_provider: ingest.provider,
    source_record_id: ingest.providerRecordId,
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  }

  const { data, error } = await supabase
    .from("home_data_graph")
    .upsert(row, { onConflict: "property_id" })
    .select("*")
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not save home data." }
  }

  await supabase.from("home_data_graph_ingest").insert({
    property_id: input.propertyId,
    landlord_id: input.landlordId,
    provider: ingest.provider,
    provider_record_id: ingest.providerRecordId,
    raw_payload: ingest.raw ?? {},
    fetched_at: fetchedAt,
  })

  await recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: "property.home_data_synced",
    source: "edge_function",
    actorType: "system",
    propertyId: input.propertyId,
    metadata: {
      message: "Property market data was updated.",
      provider: ingest.provider,
    },
  })

  return { ok: true, snapshot: homeDataSnapshotFromRow(data as HomeDataGraphRow) }
}

export async function loadHomeDataGraphSnapshot(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<HomeDataGraphSnapshot | null> {
  const { data, error } = await supabase
    .from("home_data_graph")
    .select("*")
    .eq("property_id", propertyId)
    .maybeSingle()
  if (error || !data) return null
  return homeDataSnapshotFromRow(data as HomeDataGraphRow)
}

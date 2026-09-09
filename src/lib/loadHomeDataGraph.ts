import {
  homeDataSnapshotFromRow,
  type HomeDataGraphRow,
  type HomeDataGraphSnapshot,
} from '@shared/homeDataGraph'
import { supabase } from '@/lib/supabase'

/** Read the canonical Home Data Graph. Vendor APIs are never queried from the client. */

export async function loadHomeDataGraphSnapshot(
  propertyId: string,
): Promise<HomeDataGraphSnapshot | null> {
  if (!supabase || !propertyId.trim()) return null
  const { data, error } = await supabase
    .from('home_data_graph')
    .select(
      'property_id, landlord_id, estimated_value, estimated_value_low, estimated_value_high, estimated_rent, estimated_rent_low, estimated_rent_high, rent_lookup_complete, property_type, bedrooms, bathrooms, living_area_sqft, lot_size_sqft, year_built, unit_count, has_garage, garage_spaces, garage_type, has_pool, pool_type, heating, cooling, last_sale_price, last_sale_date, tax_year, property_tax_annual, assessed_value, latitude, longitude, photo_urls, source_provider, source_record_id, fetched_at',
    )
    .eq('property_id', propertyId.trim())
    .maybeSingle()
  if (error || !data) return null
  return homeDataSnapshotFromRow(data as HomeDataGraphRow)
}

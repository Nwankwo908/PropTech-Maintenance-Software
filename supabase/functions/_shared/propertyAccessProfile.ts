import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type PropertyAccessMapped = {
  buildingEntry: string
  gateCode: string
  lockboxLocation: string
  lockboxCode: string
  utilityRoomAccess: string
  visitorParking: string
  superintendentContact: string
  emergencyAccessNotes: string
}

export function mapPropertyAccessRow(row: Record<string, unknown>): PropertyAccessMapped {
  const str = (key: string) =>
    typeof row[key] === "string" ? (row[key] as string).trim() : ""
  return {
    buildingEntry: str("building_entry"),
    gateCode: str("gate_code"),
    lockboxLocation: str("lockbox_location"),
    lockboxCode: str("lockbox_code"),
    utilityRoomAccess: str("utility_room_access"),
    visitorParking: str("visitor_parking"),
    superintendentContact: str("superintendent_contact"),
    emergencyAccessNotes: str("emergency_access_notes"),
  }
}

export function propertyAccessMappedHasContent(access: PropertyAccessMapped): boolean {
  return Object.values(access).some((value) => value.length > 0)
}

export function formatPropertyAccessPlainText(access: PropertyAccessMapped): string {
  return [
    access.buildingEntry && `Building entry: ${access.buildingEntry}`,
    access.gateCode && `Gate code: ${access.gateCode}`,
    access.lockboxLocation && `Lockbox location: ${access.lockboxLocation}`,
    access.lockboxCode && `Lockbox code: ${access.lockboxCode}`,
    access.utilityRoomAccess && `Utility room: ${access.utilityRoomAccess}`,
    access.visitorParking && `Visitor parking: ${access.visitorParking}`,
    access.superintendentContact && `Superintendent: ${access.superintendentContact}`,
    access.emergencyAccessNotes && `Emergency access: ${access.emergencyAccessNotes}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildingKey(value: string): string {
  return value.trim().toLowerCase()
}

const ACCESS_COLUMNS =
  "building_entry, gate_code, lockbox_location, lockbox_code, utility_room_access, visitor_parking, superintendent_contact, emergency_access_notes, building"

export async function loadPropertyAccessForBuilding(
  supabase: SupabaseClient,
  landlordId: string,
  building: string,
): Promise<PropertyAccessMapped | null> {
  const needle = building.trim()
  if (!landlordId || !needle) return null

  const { data: exact } = await supabase
    .from("property_access_profiles")
    .select(ACCESS_COLUMNS)
    .eq("landlord_id", landlordId)
    .eq("building", needle)
    .maybeSingle()

  if (exact && typeof exact === "object") {
    const mapped = mapPropertyAccessRow(exact as Record<string, unknown>)
    if (propertyAccessMappedHasContent(mapped)) return mapped
  }

  const { data: rows } = await supabase
    .from("property_access_profiles")
    .select(ACCESS_COLUMNS)
    .eq("landlord_id", landlordId)

  const want = buildingKey(needle)
  const match = (rows ?? []).find((row) => {
    const rec = row as Record<string, unknown>
    return buildingKey(typeof rec.building === "string" ? rec.building : "") === want
  })
  if (!match) return null
  const mapped = mapPropertyAccessRow(match as Record<string, unknown>)
  return propertyAccessMappedHasContent(mapped) ? mapped : null
}

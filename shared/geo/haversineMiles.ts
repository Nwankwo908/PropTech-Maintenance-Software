/** Mean Earth radius in statute miles (WGS84). */
const EARTH_RADIUS_MILES = 3958.7613

export type GeoLatLng = {
  lat: number
  lng: number
}

export function roundMiles(miles: number): number {
  if (!Number.isFinite(miles) || miles < 0) return 0
  return Math.round(miles * 10) / 10
}

export function metersToMiles(meters: number): number {
  if (!Number.isFinite(meters) || meters < 0) return 0
  return roundMiles(meters / 1609.344)
}

export function isFiniteLatLng(value: { lat?: unknown; lng?: unknown } | null | undefined): value is GeoLatLng {
  return (
    value != null &&
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180
  )
}

export function haversineMiles(a: GeoLatLng, b: GeoLatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Drop " · Unit …" from a property label so geocoders get a real street. */
export function geocodablePropertyOrigin(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  return raw.replace(/\s*·\s*Unit\s+.+$/i, "").trim() || raw
}

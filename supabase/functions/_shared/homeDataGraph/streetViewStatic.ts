/** Google Street View Static API helpers. Used by the home-data image proxy. */

export function streetViewLocationParam(input: {
  lat?: number | null
  lng?: number | null
  address?: string | null
}): string | null {
  if (
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    return `${input.lat},${input.lng}`
  }
  const address = input.address?.trim() ?? ""
  return address || null
}

export function googleStreetViewMetadataUrl(location: string, apiKey: string): string {
  const params = new URLSearchParams({ location, key: apiKey })
  return `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`
}

export function googleStreetViewImageUrl(location: string, apiKey: string, size = "640x420"): string {
  const params = new URLSearchParams({
    size,
    location,
    fov: "80",
    key: apiKey,
  })
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
}

export type StreetViewMetadata = {
  status?: string
  location?: { lat?: number; lng?: number }
  pano_id?: string
  error_message?: string
}

export async function fetchStreetViewStaticJpeg(input: {
  apiKey: string
  lat?: number | null
  lng?: number | null
  address?: string | null
}): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; error: string }> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) return { ok: false, error: "Street View isn’t connected." }

  const locations: string[] = []
  const primary = streetViewLocationParam(input)
  if (primary) locations.push(primary)
  if (input.address?.trim() && primary !== input.address.trim()) {
    locations.push(input.address.trim())
  }
  if (locations.length === 0) return { ok: false, error: "Missing address." }

  let lastError = "No Street View photo for this address."
  for (const location of locations) {
    const metaRes = await fetch(googleStreetViewMetadataUrl(location, apiKey))
    const meta = (await metaRes.json().catch(() => null)) as StreetViewMetadata | null
    if (!meta || meta.status !== "OK") {
      lastError =
        meta?.status === "REQUEST_DENIED"
          ? "Street View Static API is not enabled for this key."
          : (meta?.error_message ?? lastError)
      continue
    }
    const imageLocation =
      meta.location?.lat != null && meta.location?.lng != null
        ? `${meta.location.lat},${meta.location.lng}`
        : location
    const imgRes = await fetch(googleStreetViewImageUrl(imageLocation, apiKey))
    if (!imgRes.ok) {
      lastError = "Could not download the Street View photo."
      continue
    }
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg"
    if (!contentType.includes("image")) {
      lastError = "Street View did not return a photo."
      continue
    }
    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    if (bytes.byteLength < 800) {
      lastError = "Street View did not return a photo."
      continue
    }
    return { ok: true, bytes, contentType: contentType.split(";")[0] ?? "image/jpeg" }
  }
  return { ok: false, error: lastError }
}

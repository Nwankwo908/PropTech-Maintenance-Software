import { AskUloStreetView } from '@/components/AskUloStreetView'

type PropertyHomeStreetViewProps = {
  address: string
  lat?: number | null
  lng?: number | null
  label?: string | null
}

/**
 * Property Overview: interactive Google Street View of this address.
 */
export function PropertyHomeStreetView({
  address,
  lat,
  lng,
  label,
}: PropertyHomeStreetViewProps) {
  return (
    <div className="h-full min-h-[240px] w-full lg:min-h-[320px]">
      <AskUloStreetView
        embedded
        interactive
        address={address}
        lat={lat}
        lng={lng}
        label={label}
        frameClassName="h-full min-h-[240px] w-full overflow-hidden bg-[#f3f4f6] lg:min-h-[320px]"
      />
    </div>
  )
}

export function streetViewLookups(
  address: string,
  label?: string | null,
  lat?: number | null,
  lng?: number | null,
): string[] {
  const primary = address.trim()
  const queries = [primary]
  const name = label?.trim() ?? ''
  if (name && primary && !primary.toLowerCase().includes(name.toLowerCase())) {
    queries.push(`${name}, ${primary}`)
  }
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    queries.push(`${lat},${lng}`)
  }
  return [...new Set(queries.filter(Boolean))]
}

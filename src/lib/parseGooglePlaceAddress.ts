import { US_STATE_OPTIONS } from '@/lib/usLocations'

export type GooglePlaceAddressComponent = {
  long_name: string
  short_name: string
  types: string[]
}

export type ParsedStreetAddress = {
  street: string
  city: string
  state: string
  zipCode: string
}

function componentValue(
  components: GooglePlaceAddressComponent[],
  type: string,
  short = false,
): string {
  const match = components.find((part) => part.types.includes(type))
  if (!match) return ''
  return (short ? match.short_name : match.long_name).trim()
}

export function normalizeUsStateCode(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  if (US_STATE_OPTIONS.some((state) => state.code === upper)) return upper
  const byName = US_STATE_OPTIONS.find(
    (state) => state.name.toLowerCase() === trimmed.toLowerCase(),
  )
  return byName?.code ?? ''
}

export function parseGooglePlaceAddress(place: {
  address_components?: GooglePlaceAddressComponent[]
  name?: string
}): ParsedStreetAddress | null {
  const components = place.address_components ?? []
  if (components.length === 0) return null

  const street = [
    componentValue(components, 'street_number'),
    componentValue(components, 'route'),
  ]
    .filter(Boolean)
    .join(' ')
  const city =
    componentValue(components, 'locality') ||
    componentValue(components, 'sublocality_level_1') ||
    componentValue(components, 'sublocality') ||
    componentValue(components, 'neighborhood') ||
    componentValue(components, 'postal_town') ||
    componentValue(components, 'administrative_area_level_3')
  const state = normalizeUsStateCode(
    componentValue(components, 'administrative_area_level_1', true) ||
      componentValue(components, 'administrative_area_level_1'),
  )
  const zipCode = componentValue(components, 'postal_code')
  const resolvedStreet = street || (place.name ?? '').trim()

  if (!resolvedStreet && !city && !state && !zipCode) return null

  return {
    street: resolvedStreet,
    city,
    state,
    zipCode,
  }
}

export function parseAddressSuggestionLabel(label: string): ParsedStreetAddress | null {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return null

  const country = parts[parts.length - 1]?.toUpperCase()
  if (country === 'USA' || country === 'US' || country === 'UNITED STATES') {
    parts.pop()
  }
  if (parts.length === 0) return null

  const region = parts.pop() ?? ''
  const regionMatch = region.match(/^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/)
  const state = regionMatch
    ? normalizeUsStateCode(regionMatch[1])
    : normalizeUsStateCode(region)
  const zipCode = regionMatch?.[2] ?? ''
  const city = parts.pop() ?? ''
  const street = parts.join(', ')
  if (!street && !city && !state && !zipCode) return null
  return { street, city, state, zipCode }
}

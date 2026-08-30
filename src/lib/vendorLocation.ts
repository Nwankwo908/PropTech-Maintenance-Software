/** Format city, state, and country for vendor profile chips. */
export function formatVendorLocationLabel(input: {
  city?: string | null
  state?: string | null
  country?: string | null
}): string | null {
  const city = (input.city ?? '').trim()
  const state = (input.state ?? '').trim()
  const country = (input.country ?? '').trim()
  const parts: string[] = []
  if (city) parts.push(city)
  const joinedLower = parts.join(' ').toLowerCase()
  if (state && !joinedLower.includes(state.toLowerCase())) parts.push(state)
  if (country && !parts.some((part) => part.toLowerCase() === country.toLowerCase())) {
    parts.push(country)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed || null
}

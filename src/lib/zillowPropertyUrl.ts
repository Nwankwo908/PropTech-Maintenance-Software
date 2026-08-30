/** Public Zillow homes search for an address (map + listing results). */
export function zillowHomesSearchUrl(address: string): string {
  const q = address.trim()
  if (!q) return 'https://www.zillow.com/homes/'
  const slug = q.replace(/,/g, '').replace(/\s+/g, '-')
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`
}

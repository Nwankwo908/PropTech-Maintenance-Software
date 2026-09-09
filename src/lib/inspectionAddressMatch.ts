export type InspectionPropertyAddress = {
  street: string
  city: string
  state: string
  zip: string
  raw: string
}

export type InspectionAddressMatchInput = {
  extracted: InspectionPropertyAddress
  expectedStreet: string
  expectedCity: string
  expectedState: string
  expectedZip: string
  expectedBuilding: string
}

const STREET_ABBREV: Record<string, string> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  pl: 'place',
  ter: 'terrace',
  hwy: 'highway',
  pkwy: 'parkway',
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  newhampshire: 'nh',
  newjersey: 'nj',
  newmexico: 'nm',
  newyork: 'ny',
  northcarolina: 'nc',
  northdakota: 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  rhodeisland: 'ri',
  southcarolina: 'sc',
  southdakota: 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  westvirginia: 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
  districtofcolumbia: 'dc',
}

export function stateCode(value: string): string {
  const t = value.toLowerCase().replace(/[^a-z]/g, '')
  if (!t) return ''
  if (t.length === 2) return t
  return STATE_NAME_TO_CODE[t] ?? t
}

export function normalizeAddressText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[#.,/#]/g, ' ')
    .replace(/\b(n|s|e|w|north|south|east|west)\b/g, ' ')
    .split(/\s+/)
    .map((token) => STREET_ABBREV[token] ?? token)
    .filter(Boolean)
    .join(' ')
    .trim()
}

export function zip5(value: string): string {
  const match = value.replace(/\s/g, '').match(/(\d{5})/)
  return match?.[1] ?? ''
}

export function streetNumber(value: string): string {
  const match = value.trim().match(/^(\d+[a-z]?)/i)
  return (match?.[1] ?? '').toLowerCase()
}

export function formatExpectedInspectionAddress(input: {
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  building?: string | null
}): string {
  const line = [input.street, input.city, [input.state, input.zip].filter(Boolean).join(' ')]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')
  const building = (input.building ?? '').trim()
  if (building && line && !normalizeAddressText(line).includes(normalizeAddressText(building))) {
    return `${building} · ${line}`
  }
  return line || building
}

function significantTokens(value: string): string[] {
  return normalizeAddressText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
}

/**
 * True when the report address is the same property as the open building.
 * Different street numbers or ZIP codes always fail.
 */
export function inspectionReportAddressMatches(input: InspectionAddressMatchInput): boolean {
  const extractedRaw = [
    input.extracted.raw,
    input.extracted.street,
    input.extracted.city,
    input.extracted.state,
    input.extracted.zip,
  ]
    .filter(Boolean)
    .join(' ')
  const extractedNorm = normalizeAddressText(extractedRaw)
  if (!extractedNorm) return false

  const expectedStreet = input.expectedStreet.trim()
  const expectedZip = zip5(input.expectedZip) || zip5(expectedStreet)
  const extractedZip = zip5(input.extracted.zip) || zip5(extractedRaw)
  if (expectedZip && extractedZip && expectedZip !== extractedZip) return false

  const expectedNumber = streetNumber(expectedStreet)
  const extractedNumber = streetNumber(input.extracted.street) || streetNumber(extractedRaw)
  if (expectedNumber && extractedNumber && expectedNumber !== extractedNumber) return false

  const expectedStateKey = stateCode(input.expectedState)
  const extractedStateKey = stateCode(input.extracted.state)
  if (expectedStateKey && extractedStateKey && expectedStateKey !== extractedStateKey) return false

  const expectedCity = normalizeAddressText(input.expectedCity)
  if (
    expectedCity.length >= 4 &&
    extractedNorm.includes(expectedCity) &&
    (!expectedStateKey ||
      extractedStateKey === expectedStateKey ||
      extractedNorm.includes(expectedStateKey)) &&
    (!expectedNumber || extractedNorm.includes(expectedNumber))
  ) {
    return true
  }

  const building = normalizeAddressText(input.expectedBuilding)
  if (building && building.length >= 4 && extractedNorm.includes(building)) return true

  const expectedHaystack = normalizeAddressText(
    [expectedStreet, input.expectedCity, input.expectedState, input.expectedZip, input.expectedBuilding]
      .filter(Boolean)
      .join(' '),
  )
  if (expectedNumber && extractedNorm.includes(expectedNumber) && expectedHaystack) {
    const tokens = significantTokens(expectedStreet)
    if (tokens.length === 0) return true
    if (tokens.some((token) => extractedNorm.includes(token))) return true
  }

  const tokens = significantTokens(expectedStreet || input.expectedBuilding)
  const overlap = tokens.filter((token) => extractedNorm.includes(token))
  if (expectedNumber && extractedNumber && expectedNumber === extractedNumber && overlap.length > 0) {
    return true
  }
  if (!expectedNumber && overlap.length >= Math.min(2, tokens.length) && overlap.length > 0) {
    return true
  }
  if (expectedHaystack && extractedNorm.includes(expectedHaystack) && expectedHaystack.length >= 8) {
    return true
  }
  return false
}

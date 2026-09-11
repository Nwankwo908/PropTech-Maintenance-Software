/**
 * Put extracted Fast Track values into the fields the review form actually shows.
 * Models often dump a full mailing line into street, a state name into state,
 * a landlord LLC into contact name, or phone into email.
 */

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
}

const US_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE))

const COMPANY_HINT =
  /\b(llc|l\.l\.c|inc|incorporated|llp|lp|corp|corporation|management|properties|property management|rentals|holdings|group|partners|associates|realty|real estate)\b/i

export type ParsedUsAddress = {
  street: string
  city: string
  state: string
  zip: string
}

function trim(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function compactStateToken(value: string): string {
  return trim(value).replace(/[.]/g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
}

export function extractStateCode(value: string | null | undefined): string {
  const raw = compactStateToken(value)
  if (!raw) return ''
  if (raw.length === 2 && US_STATE_CODES.has(raw.toUpperCase())) return raw.toUpperCase()
  return US_STATE_NAME_TO_CODE[raw.toLowerCase()] ?? ''
}

/** True when the whole string is a USPS code or official state name (not "Newark, NJ"). */
export function isStateOnlyValue(value: string | null | undefined): boolean {
  const raw = compactStateToken(value)
  if (!raw) return false
  return Boolean(extractStateCode(raw))
}

export function looksLikeStreetAddress(value: string): boolean {
  const trimmed = trim(value)
  return /^\d+\s+\S/.test(trimmed) || /\b\d{5}(?:-\d{4})?\b/.test(trimmed)
}

function looksLikeCompanyName(value: string): boolean {
  const text = trim(value)
  if (!text || looksLikeStreetAddress(text)) return false
  return COMPANY_HINT.test(text)
}

function looksLikePersonName(value: string): boolean {
  const text = trim(value)
  if (!text || looksLikeCompanyName(text) || looksLikeStreetAddress(text) || /\d/.test(text)) {
    return false
  }
  const words = text.split(/\s+/).filter(Boolean)
  return words.length >= 2 && words.length <= 4
}

export function looksLikeCompanyParty(value: string): boolean {
  return looksLikeCompanyName(value)
}

function uniquePartyNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = trim(raw)
    if (!name || looksLikeStreetAddress(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

function namesMatch(left: string, right: string): boolean {
  return trim(left).toLowerCase() === trim(right).toLowerCase()
}

/** When the model swaps lessor and lessee, put the company on the landlord side. */
export function placeLandlordAndTenants(input: {
  landlordName?: string | null
  tenantNames: string[]
}): { landlordName: string; tenantNames: string[] } {
  const landlord = trim(input.landlordName)
  const tenants = uniquePartyNames(input.tenantNames)
  const companyTenants = tenants.filter(looksLikeCompanyName)
  const personTenants = tenants.filter((name) => !looksLikeCompanyName(name))

  if (looksLikePersonName(landlord) && companyTenants[0]) {
    return {
      landlordName: companyTenants[0],
      tenantNames: uniquePartyNames([landlord, ...personTenants]).filter((name) => !looksLikeCompanyName(name)),
    }
  }

  if (looksLikeCompanyName(landlord)) {
    return {
      landlordName: landlord,
      tenantNames:
        personTenants.length > 0
          ? personTenants.filter((name) => !namesMatch(name, landlord))
          : tenants.filter((name) => !namesMatch(name, landlord)),
    }
  }

  return {
    landlordName: landlord,
    tenantNames: personTenants.length > 0 ? personTenants : tenants,
  }
}

export function placeAccountAndTenantNames(input: {
  companyName: string
  contactName: string
  tenantNames: string[]
}): { companyName: string; contactName: string; tenantNames: string[] } {
  const labeledLandlord = looksLikeCompanyName(input.companyName)
    ? input.companyName
    : looksLikeCompanyName(input.contactName)
      ? input.contactName
      : input.companyName || input.contactName
  const tenantSideHasCompany = input.tenantNames.some(looksLikeCompanyName)
  const extraPeople = tenantSideHasCompany
    ? [
        looksLikePersonName(input.companyName) && !looksLikeCompanyName(input.companyName)
          ? input.companyName
          : '',
        looksLikePersonName(input.contactName) ? input.contactName : '',
      ].filter(Boolean)
    : []

  const parties = placeLandlordAndTenants({
    landlordName: labeledLandlord,
    tenantNames: [...input.tenantNames, ...extraPeople],
  })

  const tenantKeys = new Set(parties.tenantNames.map((name) => name.toLowerCase()))
  const companyName = looksLikeCompanyName(parties.landlordName)
    ? parties.landlordName
    : looksLikePersonName(input.companyName) && tenantKeys.has(input.companyName.toLowerCase())
      ? ''
      : input.companyName
  const contactName =
    input.contactName && tenantKeys.has(input.contactName.toLowerCase()) ? '' : input.contactName

  return {
    companyName,
    contactName,
    tenantNames: parties.tenantNames,
  }
}

export function looksLikeEmailValue(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(trim(value))
}

export function looksLikePhoneValue(value: string): boolean {
  const digits = trim(value).replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 11
}

function splitCityStateToken(token: string): { city: string; state: string } {
  const text = compactStateToken(token)
  if (!text) return { city: '', state: '' }
  const whole = extractStateCode(text)
  if (whole) return { city: '', state: whole }

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const last = words[words.length - 1] ?? ''
    const lastState = extractStateCode(last)
    if (lastState) return { city: words.slice(0, -1).join(' '), state: lastState }
    const two = words.slice(-2).join(' ')
    const twoState = extractStateCode(two)
    if (twoState) return { city: words.slice(0, -2).join(' '), state: twoState }
  }
  return { city: text, state: '' }
}

export function parseUsMailingAddress(raw: string | null | undefined): ParsedUsAddress {
  let rest = trim(raw).replace(/\s+/g, ' ')
  if (!rest) return { street: '', city: '', state: '', zip: '' }

  let zip = ''
  const zipMatch = rest.match(/\b(\d{5}(?:-\d{4})?)\s*$/)
  if (zipMatch?.[1] != null && zipMatch.index != null) {
    zip = zipMatch[1]
    rest = rest.slice(0, zipMatch.index).replace(/[,\s]+$/g, '').trim()
  }

  const parts = rest.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const tail = splitCityStateToken(parts[parts.length - 1] ?? '')
    let city = tail.city
    let state = tail.state
    let streetParts = parts.slice(0, -1)
    if (!state && streetParts.length >= 1) {
      const maybe = splitCityStateToken(streetParts[streetParts.length - 1] ?? '')
      if (maybe.state) {
        state = maybe.state
        city = city || maybe.city
        streetParts = streetParts.slice(0, -1)
      }
    }
    if (state && !city && streetParts.length >= 1) {
      city = streetParts[streetParts.length - 1] ?? ''
      streetParts = streetParts.slice(0, -1)
    }
    return {
      street: streetParts.join(', ').trim(),
      city,
      state,
      zip,
    }
  }

  const words = rest.split(/\s+/).filter(Boolean)
  if (words.length >= 3) {
    const last = words[words.length - 1] ?? ''
    const lastState = extractStateCode(last)
    if (lastState) {
      return {
        street: words.slice(0, -2).join(' '),
        city: words[words.length - 2] ?? '',
        state: lastState,
        zip,
      }
    }
  }

  return { street: rest, city: '', state: '', zip }
}

export function placePhoneEmail(
  phone: string | null | undefined,
  email: string | null | undefined,
): { phone: string; email: string } {
  const p = trim(phone)
  const e = trim(email)
  const phoneIsEmail = looksLikeEmailValue(p)
  const emailIsPhone = looksLikePhoneValue(e) && !looksLikeEmailValue(e)
  if (phoneIsEmail && (emailIsPhone || !e)) {
    return { phone: emailIsPhone ? e : '', email: p }
  }
  if (emailIsPhone && !looksLikeEmailValue(e) && (phoneIsEmail || !p || !looksLikePhoneValue(p))) {
    return { phone: e, email: phoneIsEmail ? p : '' }
  }
  return { phone: p, email: e }
}

export function placeAccountFields(input: {
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
}): { companyName: string; contactName: string; email: string; phone: string } {
  let companyName = trim(input.companyName)
  let contactName = trim(input.contactName)

  if (companyName && contactName && companyName.toLowerCase() === contactName.toLowerCase()) {
    if (looksLikeCompanyName(companyName)) contactName = ''
    else if (looksLikePersonName(companyName)) companyName = ''
  }

  if (looksLikeCompanyName(contactName) && looksLikePersonName(companyName)) {
    const swap = companyName
    companyName = contactName
    contactName = swap
  } else if (looksLikeCompanyName(contactName) && !companyName) {
    companyName = contactName
    contactName = ''
  } else if (looksLikePersonName(companyName) && !contactName && !looksLikeCompanyName(companyName)) {
    contactName = companyName
    companyName = ''
  }

  if (looksLikeStreetAddress(companyName)) companyName = ''
  if (looksLikeStreetAddress(contactName)) contactName = ''

  const channels = placePhoneEmail(input.phone, input.email)
  return { companyName, contactName, ...channels }
}

export function placePropertyAddressFields(input: {
  name?: string | null
  streetAddress?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
}): {
  name: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
} {
  let name = trim(input.name)
  let street = trim(input.streetAddress)
  const rawCity = trim(input.city)
  const rawState = trim(input.state)
  let zip = trim(input.zipCode)

  const fromCityField = splitCityStateToken(rawCity)
  let city = fromCityField.city || (isStateOnlyValue(rawCity) ? '' : rawCity)
  let state = extractStateCode(rawState) || fromCityField.state

  if (
    isStateOnlyValue(rawCity) &&
    rawState &&
    !extractStateCode(rawState) &&
    !/^\d/.test(rawState) &&
    !isStateOnlyValue(rawState)
  ) {
    city = rawState
    state = extractStateCode(rawCity)
  } else if (isStateOnlyValue(city)) {
    state = state || extractStateCode(city)
    city = ''
  }

  if (!zip && /^\d{5}(?:-\d{4})?$/.test(city)) {
    zip = city
    city = ''
  }

  const parsedStreet = parseUsMailingAddress(street)
  if (parsedStreet.city || parsedStreet.state || parsedStreet.zip) {
    street = parsedStreet.street || street
    state = state || parsedStreet.state
    zip = zip || parsedStreet.zip
    if (!city || isStateOnlyValue(city)) {
      city = isStateOnlyValue(parsedStreet.city) ? '' : parsedStreet.city
    }
  }

  if (!street && looksLikeStreetAddress(name)) {
    const parsedName = parseUsMailingAddress(name)
    street = parsedName.street || name
    city = !city || isStateOnlyValue(city) ? parsedName.city || city : city
    if (isStateOnlyValue(city)) city = ''
    state = state || parsedName.state
    zip = zip || parsedName.zip
    name = parsedName.street || name
  } else if (looksLikeStreetAddress(name) && street && !looksLikeStreetAddress(street)) {
    const parsedName = parseUsMailingAddress(name)
    const buildingName = street
    street = parsedName.street || name
    city = !city || isStateOnlyValue(city) ? parsedName.city || city : city
    if (isStateOnlyValue(city)) city = ''
    state = state || parsedName.state
    zip = zip || parsedName.zip
    name = buildingName
  } else if (looksLikeStreetAddress(name) && looksLikeStreetAddress(street)) {
    const parsedName = parseUsMailingAddress(name)
    name = parsedName.street || name
    if (!city || isStateOnlyValue(city)) {
      city = isStateOnlyValue(parsedName.city) ? '' : parsedName.city || city
    }
    state = state || parsedName.state
    zip = zip || parsedName.zip
  }

  if (isStateOnlyValue(city)) {
    state = state || extractStateCode(city)
    city = ''
  }

  state = extractStateCode(state)
  return { name, streetAddress: street, city, state, zipCode: zip }
}

export function orderLeaseDates(
  start: string | null | undefined,
  end: string | null | undefined,
): { start: string; end: string } {
  const leaseStart = trim(start)
  const leaseEnd = trim(end)
  if (leaseStart && leaseEnd && leaseStart > leaseEnd) {
    return { start: leaseEnd, end: leaseStart }
  }
  return { start: leaseStart, end: leaseEnd }
}

export function streetLineFromAddress(raw: string | null | undefined): string {
  const parsed = parseUsMailingAddress(raw)
  return parsed.street || trim(raw)
}

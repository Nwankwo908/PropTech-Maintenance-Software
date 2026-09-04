/** Collect listing photo URLs from RapidAPI Zillow (zillow-com1) payloads. */

const MAX_PHOTOS = 24

export function isZillowPhotoUrl(raw: string): boolean {
  try {
    const normalized = raw.trim().startsWith("//") ? `https:${raw.trim()}` : raw.trim()
    const url = new URL(normalized)
    if (url.protocol !== "https:") return false
    const host = url.hostname.toLowerCase()
    return host.includes("zillowstatic.com") || host === "photos.zillow.com"
  } catch {
    return false
  }
}

function asStr(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

export function pickZillowZpid(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const obj = payload as Record<string, unknown>
  const direct = asStr(obj.zpid) ?? asStr(obj.zPid) ?? asStr(obj.zillowPropertyId)
  if (direct) return direct
  const nested = [obj.property, obj.data, obj.result, obj.metaData, obj.meta]
  for (const row of nested) {
    const id = pickZillowZpid(row)
    if (id) return id
  }
  if (Array.isArray(obj.props)) {
    for (const row of obj.props) {
      const id = pickZillowZpid(row)
      if (id) return id
    }
  }
  if (Array.isArray(obj.results)) {
    for (const row of obj.results) {
      const id = pickZillowZpid(row)
      if (id) return id
    }
  }
  return null
}

function normalizeHttpsUrl(raw: string): string | null {
  const trimmed = raw.trim()
  const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed
  try {
    const url = new URL(normalized)
    if (url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

function isPropertyDataImageUrl(raw: string): boolean {
  const url = normalizeHttpsUrl(raw)
  if (!url) return false
  if (url.includes("rapidapi.com")) return false
  return isZillowPhotoUrl(url) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)
}

function pushUnique(out: string[], seen: Set<string>, url: string | null) {
  if (!url || !isZillowPhotoUrl(url) || seen.has(url)) return
  seen.add(url)
  out.push(url)
}

function pushPropertyDataImage(out: string[], seen: Set<string>, url: string | null) {
  if (!url || !isPropertyDataImageUrl(url) || seen.has(url)) return
  seen.add(url)
  out.push(url)
}

function walkKnownPhotoFields(payload: unknown, out: string[], seen: Set<string>, depth: number) {
  if (depth > 10 || out.length >= MAX_PHOTOS) return
  if (!payload) return
  if (typeof payload === "string") {
    const trimmed = payload.trim()
    if (trimmed.includes(",") && trimmed.includes("zillowstatic")) {
      for (const part of trimmed.split(",")) pushUnique(out, seen, part.trim())
    } else {
      pushUnique(out, seen, trimmed.startsWith("//") ? `https:${trimmed}` : trimmed)
    }
    return
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      walkKnownPhotoFields(item, out, seen, depth + 1)
      if (out.length >= MAX_PHOTOS) return
    }
    return
  }
  if (typeof payload !== "object") return
  const obj = payload as Record<string, unknown>
  if (Array.isArray(obj.image_urls)) {
    for (const item of obj.image_urls) {
      pushPropertyDataImage(out, seen, asStr(item))
      if (out.length >= MAX_PHOTOS) return
    }
  }
  for (const value of Object.values(obj)) {
    if (typeof value === "string" || Array.isArray(value) || (value && typeof value === "object")) {
      walkKnownPhotoFields(value, out, seen, depth + 1)
      if (out.length >= MAX_PHOTOS) return
    }
  }
}

export function collectZillowPhotoUrls(payload: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  walkKnownPhotoFields(payload, out, seen, 0)
  return out.slice(0, MAX_PHOTOS)
}

export function zillowHomesSearchUrl(address: string): string {
  const q = address.trim()
  if (!q) return "https://www.zillow.com/homes/"
  const slug = q.replace(/,/g, "").replace(/\s+/g, "-")
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`
}

/** Prefer "street, City, ST ZIP" — Zillow lookups fail on "street City, ST ZIP". */
export function zillowAddressQueryVariants(address: string): string[] {
  const raw = address.trim().replace(/\s+/g, " ")
  if (!raw) return []
  const variants = [raw]
  const formatted = formatZillowStreetCityStateZip(raw)
  if (formatted && formatted !== raw) variants.push(formatted)
  const noComma = raw.replace(/,/g, "")
  if (noComma !== raw) variants.push(noComma)
  if (formatted) {
    const formattedNoComma = formatted.replace(/,/g, "")
    if (formattedNoComma !== formatted) variants.push(formattedNoComma)
  }
  return [...new Set(variants)]
}

const STREET_SUFFIX =
  /\b(?:st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|pl|place|way|pkwy|parkway|cir|circle|ter|terrace)\.?$/i

export function formatZillowStreetCityStateZip(address: string): string | null {
  const raw = address.trim().replace(/\s+/g, " ")
  const tail = raw.match(/^(.*),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  if (!tail) return null
  const head = tail[1].trim()
  const state = tail[2]
  const zip = tail[3]
  if (head.includes(",")) return `${head}, ${state} ${zip}`
  const tokens = head.split(/\s+/)
  let suffixAt = -1
  for (let i = 0; i < tokens.length; i++) {
    if (STREET_SUFFIX.test(tokens[i])) suffixAt = i
  }
  if (suffixAt >= 0 && suffixAt < tokens.length - 1) {
    const street = tokens.slice(0, suffixAt + 1).join(" ")
    const city = tokens.slice(suffixAt + 1).join(" ")
    return `${street}, ${city}, ${state} ${zip}`
  }
  return `${head}, ${state} ${zip}`
}

export function collectZillowPhotoUrlsFromHtml(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /https:\/\/[^"'\\\s<>]+zillowstatic\.com[^"'\\\s<>]*/gi
  for (const match of html.match(re) ?? []) {
    const cleaned = match.replace(/[),.;]+$/, "")
    pushUnique(out, seen, cleaned)
    if (out.length >= MAX_PHOTOS) break
  }
  return out
}

export function zillowRapidApiHosts(_preferred?: string | null): string[] {
  return ["zillow-com1.p.rapidapi.com"]
}

export function zillowRapidApiHeaders(apiKey: string, host: string): HeadersInit {
  return {
    "x-rapidapi-key": apiKey,
    "x-rapidapi-host": host,
    Accept: "application/json",
  }
}

export async function fetchZillowJson(
  url: string,
  headers: HeadersInit,
): Promise<{ json: unknown | null; blocked: boolean; rateLimited: boolean; status: number }> {
  const res = await fetch(url, { method: "GET", headers })
  const text = await res.text().catch(() => "")
  if (res.status === 429) {
    console.warn("[zillow-photos] RapidAPI rate limited", url, text.slice(0, 180))
    return { json: null, blocked: true, rateLimited: true, status: 429 }
  }
  if (res.status === 401 || res.status === 403) {
    console.warn("[zillow-photos] not subscribed or unauthorized", res.status, url)
    return { json: null, blocked: true, rateLimited: false, status: res.status }
  }
  if (!res.ok) {
    console.warn("[zillow-photos] HTTP", res.status, url, text.slice(0, 200))
    return { json: null, blocked: false, rateLimited: false, status: res.status }
  }
  try {
    return { json: text ? JSON.parse(text) : null, blocked: false, rateLimited: false, status: res.status }
  } catch {
    return { json: null, blocked: false, rateLimited: false, status: res.status }
  }
}

function mergePhotoUrls(target: string[], extra: string[]): void {
  const seen = new Set(target)
  for (const url of extra) {
    if (!url.startsWith("https://") || seen.has(url)) continue
    seen.add(url)
    target.push(url)
    if (target.length >= MAX_PHOTOS) return
  }
}

function ingest(
  photos: string[],
  json: unknown,
  zpidRef: { current: string | null },
): void {
  if (!zpidRef.current) zpidRef.current = pickZillowZpid(json)
  mergePhotoUrls(photos, collectZillowPhotoUrls(json))
}

/** RapidAPI zillow-com1 — address lookup then photos by zpid. */
async function loadFromZillowCom1(input: {
  host: string
  apiKey: string
  queries: string[]
}): Promise<{ photos: string[]; zpid: string | null; rateLimited: boolean }> {
  const photos: string[] = []
  const zpidRef = { current: null as string | null }
  const headers = zillowRapidApiHeaders(input.apiKey, input.host)
  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://${input.host}${path.startsWith("/") ? path : `/${path}`}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return await fetchZillowJson(url.toString(), headers)
  }

  const q =
    input.queries.find((addr) => (addr.match(/,/g) ?? []).length >= 2) ??
    input.queries.find((addr) => addr.includes(",")) ??
    input.queries[0]

  for (const res of [
    await get("/search_address", { address: q }),
    await get("/property", { address: q }),
  ]) {
    if (res.rateLimited) return { photos: [], zpid: null, rateLimited: true }
    if (res.blocked) return { photos: [], zpid: null, rateLimited: false }
    ingest(photos, res.json, zpidRef)
  }

  if (zpidRef.current) {
    for (const path of ["/photos", "/property"]) {
      const res = await get(path, { zpid: zpidRef.current })
      if (res.rateLimited) return { photos, zpid: zpidRef.current, rateLimited: true }
      if (res.blocked) break
      ingest(photos, res.json, zpidRef)
      if (photos.length >= 4) break
    }
  }

  console.warn("[zillow-photos] zillow-com1 result", {
    host: input.host,
    photoCount: photos.length,
    zpid: zpidRef.current,
  })
  return { photos, zpid: zpidRef.current, rateLimited: false }
}

export async function loadZillowPropertyPhotos(input: {
  address: string
  apiKey?: string | null
  host?: string
}): Promise<{ photos: string[]; zpid: string | null; rateLimited: boolean }> {
  const address = input.address.trim()
  const queries = zillowAddressQueryVariants(address)
  const apiKey = input.apiKey?.trim() ?? ""
  if (!apiKey) return { photos: [], zpid: null, rateLimited: false }

  const result = await loadFromZillowCom1({
    host: zillowRapidApiHosts(input.host)[0],
    apiKey,
    queries,
  })
  return { photos: result.photos.slice(0, MAX_PHOTOS), zpid: result.zpid, rateLimited: result.rateLimited }
}


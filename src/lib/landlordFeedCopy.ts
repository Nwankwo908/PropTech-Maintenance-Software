import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'

/** Visible feed lines stay inside the Overview row. */
export const FEED_LINE_MAX_CHARS = 85
export const FEED_LINE_MAX_WORDS = 14

export type FeedLine = {
  /** Line shown in the row. */
  line: string
  /** Sentence before the emergency cut, for title and aria-label. */
  full: string
}

export type LandlordFeedCopySource = {
  eventType: string
  label?: string | null
  message?: string | null
  vendorName?: string | null
  building?: string | null
  maintenanceRequestId?: string | null
  metadata?: Record<string, unknown> | null
}

const GENERIC_VENDOR_WORDS = new Set(['the', 'a', 'abc'])

const CLOSE_CLAUSES: Record<string, string> = {
  'archived from the workflow pipeline': 'property team closed it',
  'archived by the property team': 'property team closed it',
  'resident cancelled': 'resident cancelled',
  'resident canceled': 'resident cancelled',
  'cancelled by the resident over text': 'resident cancelled',
  'job reassigned': 'sent to another vendor',
  cancelled: 'no longer needed',
  canceled: 'no longer needed',
}

export function feedLineWordCount(line: string): number {
  const trimmed = line.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function feedLineFits(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length <= FEED_LINE_MAX_CHARS && feedLineWordCount(trimmed) <= FEED_LINE_MAX_WORDS
}

export function shortVendorName(name: string | null | undefined): string | null {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const first = words[0]!
  if (GENERIC_VENDOR_WORDS.has(first.toLowerCase()) && words[1]) return `${first} ${words[1]}`
  return first
}

export function feedRowA11yProps(full: string): { title: string; 'aria-label': string } {
  return { title: full, 'aria-label': full }
}

function metaString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function moneyLabel(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().startsWith('$')) return value.trim()
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,]/g, ''))
  if (!Number.isFinite(amount)) return null
  const cents = Math.round(amount * 100) / 100
  if (Math.abs(cents - Math.round(cents)) < 0.001) return `$${Math.round(cents).toLocaleString('en-US')}`
  return cents.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function workOrderRef(source: LandlordFeedCopySource): string | null {
  const explicit = metaString(source.metadata, 'work_order_ref')
  if (explicit) return explicit
  const fromMessage = source.message?.match(/\bWO-[A-Z0-9]{4}\b/)
  if (fromMessage) return fromMessage[0]
  if (source.maintenanceRequestId) return formatWorkOrderRefFromTicketId(source.maintenanceRequestId)
  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Property / street for any feed line — same compacting rules as attention alerts. */
export function feedPlaceFromSource(source: LandlordFeedCopySource): string | null {
  return compactAttentionPlace(
    source.building ??
      metaString(source.metadata, 'location_line') ??
      metaString(source.metadata, 'building') ??
      metaString(source.metadata, 'street'),
  )
}

export function feedScopeFromSource(source: LandlordFeedCopySource): {
  workOrderRef: string | null
  place: string | null
} {
  return {
    workOrderRef: workOrderRef(source),
    place: feedPlaceFromSource(source),
  }
}

/**
 * Ensure every activity-feed line names the work order and property when known.
 * Never collapses away those tokens when the line has to be shortened.
 */
export function withFeedScope(
  line: FeedLine,
  input: { workOrderRef?: string | null; place?: string | null },
): FeedLine {
  const wo = (input.workOrderRef ?? '').trim() || null
  const place = compactAttentionPlace(input.place)
  if (!wo && !place) return line

  const hasWo = Boolean(wo) && new RegExp(`\\b${escapeRegExp(wo!)}\\b`, 'i').test(line.full)
  const hasPlace = Boolean(place) && line.full.toLowerCase().includes(place!.toLowerCase())
  if (hasWo && hasPlace) return line

  const scope = [
    !hasWo && wo ? `for ${wo}` : null,
    !hasPlace && place ? `at ${place}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  if (!scope) return line

  const inject = (text: string): string => {
    const trimmed = text.trim()
    if (!trimmed) return scope
    const split = trimmed.match(/^(.+?)([;:] .+)$/)
    if (split) return `${split[1]!.trim()} ${scope}${split[2]}`
    return `${trimmed} ${scope}`
  }

  const full = inject(line.full)
  const placeWords = place ? place.split(/\s+/).filter(Boolean) : []
  const protectedTokens = [wo ?? '', ...placeWords, ...protectedTokensIn(full)]
  const shorter = [
    inject(line.line),
    inject(line.full.replace(/[;:] .+$/, '').trim()),
    // Keep action stem + scope when the issue/detail has to drop.
    `${line.full.split(/\s+/).slice(0, 5).join(' ')} ${scope}`.replace(/\s+/g, ' ').trim(),
    scope,
  ]
  return fitFeedLine(full, shorter, protectedTokens)
}

function bareWord(word: string): string {
  return word.replace(/^["“”'([{]+|[)\]}"“”',.;:]+$/g, '')
}

function isProtectedWord(word: string, protectedTokens: string[]): boolean {
  const bare = bareWord(word)
  if (!bare) return false
  if (/^\$[\d,]+(?:\.\d+)?$/.test(bare)) return true
  if (/^WO-[A-Z0-9]+$/i.test(bare)) return true
  if (/^\d[\d,]*(?:\.\d+)?$/.test(bare)) return true
  const lower = bare.toLowerCase()
  return protectedTokens.some((token) => bareWord(token).toLowerCase() === lower)
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.replace(/\s+/g, ' ').trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

/**
 * Drop low-priority parts until the line fits. Never appends "…".
 * Priority to drop first: parenthetical vendor, dollar amounts, then "at/for Place".
 * Never drops protected actor/action/issue/outcome tokens.
 */
export function priorityShortenFeedLine(source: string, protectedTokens: string[]): string {
  let text = source.replace(/\s+/g, ' ').trim()
  if (!text || feedLineFits(text)) return text

  // 1) Full vendor in parentheses — "(Ecosafe Pest Management LLC…)"
  text = text.replace(/\s*\([^)]{3,}\)/g, '').replace(/\s+/g, ' ').trim()
  if (feedLineFits(text)) return text

  // 2) Amount detail — keep action words, drop $… tokens unless protected as the subject.
  const withoutAmounts = text
    .replace(/\$[\d,]+(?:\.\d+)?/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:])/g, '$1')
    .trim()
  if (withoutAmounts && feedLineFits(withoutAmounts)) return withoutAmounts

  // 3) Place clause — "at 14 Maple Ave" / "for 14 Maple Ave" when place words are known.
  const placeWords = protectedTokens
    .map((token) => bareWord(token))
    .filter((token) => token && !/^\$/.test(token) && !/^WO-/i.test(token) && !/^\d+$/.test(token))
  if (placeWords.length) {
    const placePattern = placeWords.map(escapeRegExp).join('\\s+')
    const withoutPlace = text
      .replace(new RegExp(`\\s+(?:at|for)\\s+${placePattern}\\b`, 'i'), '')
      .replace(/\s+/g, ' ')
      .trim()
    if (withoutPlace && feedLineFits(withoutPlace)) return withoutPlace
  }

  return text
}

/** Drop unprotected trailing words until the line fits. Never appends "…". */
export function emergencyCutFeedLine(source: string, protectedTokens: string[]): string {
  const kept = source.trim().split(/\s+/).filter(Boolean)
  while (kept.length > 0 && !feedLineFits(kept.join(' '))) {
    let dropAt = -1
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (!isProtectedWord(kept[index]!, protectedTokens)) {
        dropAt = index
        break
      }
    }
    if (dropAt === -1) break
    kept.splice(dropAt, 1)
  }
  return kept.join(' ').trim()
}

export function fitFeedLine(full: string, shorter: string[], protectedTokens: string[]): FeedLine {
  const options = uniqueLines([full, ...shorter])
  const canonical = options[0] ?? ''
  for (const option of options) {
    if (feedLineFits(option)) return { line: option, full: canonical }
  }
  for (const option of options) {
    const shortened = priorityShortenFeedLine(option, protectedTokens)
    if (shortened && feedLineFits(shortened)) return { line: shortened, full: canonical }
  }
  // Shortest template first — never invent an ellipsis cut of the long form.
  const ranked = [...options].sort((a, b) => a.length - b.length || feedLineWordCount(a) - feedLineWordCount(b))
  for (const option of ranked) {
    if (feedLineFits(option)) return { line: option, full: canonical }
    const cut = emergencyCutFeedLine(option, protectedTokens)
    if (cut && feedLineFits(cut)) return { line: cut, full: canonical }
    if (cut) return { line: cut, full: canonical }
  }
  const base = ranked[0] || canonical
  return { line: emergencyCutFeedLine(base, protectedTokens) || base, full: canonical }
}

function vendorLevels(name: string | null | undefined): string[] {
  const full = (name ?? '').trim()
  const short = shortVendorName(full)
  return uniqueLines([short ?? '', full ? full.split(/\s+/)[0]! : ''].filter(Boolean))
}

export function trimQuote(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '')
  if (clean.length <= maxChars) return clean
  const slice = clean.slice(0, maxChars + 1)
  const space = slice.lastIndexOf(' ')
  return (space > 0 ? slice.slice(0, space) : clean.slice(0, maxChars)).trim()
}

const WEEKDAYS: Record<string, string> = {
  monday: 'Mon',
  mon: 'Mon',
  tuesday: 'Tue',
  tue: 'Tue',
  tues: 'Tue',
  wednesday: 'Wed',
  wed: 'Wed',
  thursday: 'Thu',
  thu: 'Thu',
  thur: 'Thu',
  thurs: 'Thu',
  friday: 'Fri',
  fri: 'Fri',
  saturday: 'Sat',
  sat: 'Sat',
  sunday: 'Sun',
  sun: 'Sun',
}

export function compactWindow(raw: string | null | undefined): string | null {
  let text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  text = text.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)\b\.?/gi,
    (match) => WEEKDAYS[match.toLowerCase().replace(/\./g, '')] ?? match,
  )
  text = text.replace(/(\d{1,2}):00/g, '$1')
  text = text.replace(/\s*(am|pm)\b/gi, (_, meridiem: string) => meridiem.toLowerCase())
  text = text.replace(/\s*[–-]\s*/g, '–')
  text = text.replace(/(\d{1,2})(am|pm)–(\d{1,2})(am|pm)/gi, (_, start, startMeridiem, end, endMeridiem) =>
    String(startMeridiem).toLowerCase() === String(endMeridiem).toLowerCase()
      ? `${start}–${end}${String(endMeridiem).toLowerCase()}`
      : `${start}${String(startMeridiem).toLowerCase()}–${end}${String(endMeridiem).toLowerCase()}`,
  )
  return text.replace(/\s+/g, ' ').trim()
}

function tradeLabel(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text || /\b[a-z]+(?:_[a-z0-9]+){2,}\b/i.test(text)) return null
  const human = text.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (!human) return null
  if (!text.includes('_')) return human
  return human
    .split(' ')
    .map((word) => (word.length <= 4 && word === word.toUpperCase() && /[A-Z]/.test(word) ? word : word.toLowerCase()))
    .join(' ')
}

function cleanDetail(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim().replace(/[()]/g, '')
  if (!text || text.length > 32 || /\b[a-z]+(?:_[a-z0-9]+){2,}\b/i.test(text)) return null
  return text
}

export function spendFeedLine(input: {
  amount: unknown
  workOrderRef?: string | null
  vendorName?: string | null
  trade?: string | null
}): FeedLine | null {
  const amount = moneyLabel(input.amount)
  if (!amount) return null
  const wo = input.workOrderRef?.trim() || null
  const trade = tradeLabel(input.trade)
  const names = vendorLevels(input.vendorName)
  const vendor = names[0] ?? null
  const withVendor = (name: string | null, includeTrade: boolean) => {
    const on = wo ? ` on ${wo}` : ''
    const what = includeTrade && trade ? ` ${trade}` : ''
    const who = name ? ` (${name})` : ''
    return `${amount} spent${on}${what}${who}`
  }
  return fitFeedLine(
    withVendor(vendor, true),
    [withVendor(vendor, false), withVendor(null, false)],
    [amount, wo ?? '', 'spent'],
  )
}

export function estimateApprovedFeedLine(input: {
  amount: unknown
  workOrderRef?: string | null
}): FeedLine | null {
  const amount = moneyLabel(input.amount)
  if (!amount) return null
  const wo = input.workOrderRef?.trim() || null
  const base = wo ? `Approved ${amount} estimate for ${wo}` : `Approved ${amount} estimate`
  return fitFeedLine(`${base}; confirming visit time with tenant`, [base], [amount, wo ?? '', 'approved'])
}

export function vendorAlertFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const names = vendorLevels(input.vendorName)
  const name = names[0] ?? 'the vendor'
  const line = wo ? `Sent ${wo} to ${name}` : `Sent a job to ${name}`
  return fitFeedLine(line, wo ? [`Sent ${wo}`] : ['Sent a job'], [wo ?? '', 'Sent'])
}

export function vendorAcceptedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const line = wo ? `${name} accepted ${wo}` : `${name} accepted the job`
  return fitFeedLine(line, [], [wo ?? '', 'accepted'])
}

export function vendorProposedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  window?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const window = compactWindow(input.window)
  const withWindow = window
    ? wo
      ? `${name} proposed ${window} for ${wo}`
      : `${name} proposed ${window}`
    : null
  const fallback = wo ? `${name} proposed a time for ${wo}` : `${name} proposed a time`
  return fitFeedLine(withWindow ?? fallback, withWindow ? [fallback] : [], [wo ?? '', 'proposed'])
}

export function vendorDeclinedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const base = wo ? `${name} declined ${wo}` : `${name} declined the job`
  return fitFeedLine(`${base}; finding another vendor`, [base], [wo ?? '', 'declined'])
}

export function vendorRepliedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  quote?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const quote = trimQuote(input.quote ?? '', 30)
  const base = wo ? `${name} replied on ${wo}` : `${name} replied`
  const quoted = (snippet: string) => (snippet ? `${base}: "${snippet}"` : base)
  const shorter = [18, 12, 8]
    .map((max) => trimQuote(quote, max))
    .filter((snippet) => snippet && snippet !== quote)
    .map(quoted)
  return fitFeedLine(quoted(quote), [...shorter, base], [wo ?? '', 'replied'])
}

export function tenantConfirmedFeedLine(input: {
  workOrderRef?: string | null
  window?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const window = compactWindow(input.window)
  const withWindow = window
    ? wo
      ? `Confirmed ${window} visit with the tenant for ${wo}`
      : `Confirmed ${window} visit with the tenant`
    : null
  const fallback = wo
    ? `Confirmed the visit with the tenant for ${wo}`
    : 'Confirmed the visit with the tenant'
  return fitFeedLine(withWindow ?? fallback, withWindow ? [fallback] : [], [wo ?? '', 'confirmed'])
}

export function windowPassedFeedLine(input: { workOrderRef?: string | null }): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const base = wo
    ? `Stopped texts on ${wo} after the visit window passed`
    : 'Stopped texts after the visit window passed'
  return fitFeedLine(`${base}; no tenant confirmation`, [base], [wo ?? '', 'passed'])
}

export function closedFeedLine(input: {
  workOrderRef?: string | null
  reason?: string | null
  detail?: string | null
}): FeedLine {
  const wo = input.workOrderRef?.trim() || 'Work order'
  const reason = (input.reason ?? '').trim()
  const paren = reason.match(/\(([^)]+)\)/)?.[1] ?? null
  const detail = cleanDetail(input.detail) ?? cleanDetail(paren)
  let clause = 'not a repair'
  if (/home check/i.test(reason) && /photo/i.test(reason)) {
    clause = detail ? `Home Check photo (${detail}), not a repair` : 'Home Check photo, not a repair'
  } else if (/home check/i.test(reason)) {
    clause = 'Home Check note, not a repair'
  } else {
    const mapped = CLOSE_CLAUSES[reason.toLowerCase()]
    if (mapped) clause = mapped
  }
  const line = `Closed ${wo}: ${clause}`
  const plain = `Closed ${wo}: not a repair`
  return fitFeedLine(line, clause === 'not a repair' ? [] : [plain], [wo === 'Work order' ? '' : wo, 'closed'])
}

export function equipmentFeedLine(input: {
  serial?: string | null
  appliance?: string | null
}): FeedLine | null {
  const serial = (input.serial ?? '').trim()
  if (!serial || /\s/.test(serial)) return null
  const appliance = tradeLabel(input.appliance)
  const withAppliance = appliance ? `Saved ${appliance} serial ${serial}` : null
  const fallback = `Saved serial ${serial}`
  return fitFeedLine(withAppliance ?? fallback, withAppliance ? [fallback] : [], [serial, 'saved'])
}

/** What Ulo did when it sent a Needs Your Attention alert (kind → verb phrase). */
export function attentionAlertActionVerb(kind?: string | null): string {
  switch ((kind ?? '').trim().toLowerCase()) {
    case 'assign_vendor':
      return 'Asked you to pick a vendor'
    case 'invoice_ready':
      return 'Sent you an invoice to review'
    case 'late_rent':
      return 'Texted you that rent is late'
    case 'lease_renewal':
      return 'Asked you about a lease renewal'
    case 'lease_info_missing':
      return 'Asked you for missing lease details'
    case 'unknown_occupant':
      return 'Texted you about an unknown sender'
    case 'external_vendor_replied':
      return 'Forwarded a vendor reply'
    case 'pm_service':
      return 'Asked you about a preventive HVAC visit'
    case 'weather_alert':
      return 'Sent you a weather alert'
    case 'workflow_escalated':
      return 'Asked you to step in'
    default:
      return 'Texted you'
  }
}

/** Street / building for feed lines — drop unit/ago tails, keep it short. */
export function compactAttentionPlace(raw: string | null | undefined): string | null {
  let text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null
  text = text.split(',')[0]?.trim() ?? text
  text = text.replace(/\breported\b.*$/i, '').trim()
  if (!text || /^this property$/i.test(text)) return null
  if (text.length > 28) {
    text = text.slice(0, 28).replace(/\s+\S*$/, '').trim()
  }
  return text || null
}

/**
 * Soften robotic openers on any leftover stored message so template updates
 * still show up for older graph rows (Luna polish only runs at write time).
 */
export function softRewriteFeedLine(text: string): string {
  let line = text.replace(/\s+/g, ' ').trim()
  if (!line) return line
  line = line.replace(/\bLandlord attention alert sent\b/gi, 'Texted you for a decision')
  line = line.replace(/^Noted\s+/i, '')
  line = line.replace(/^Logged\s+/i, '')
  line = line.replace(/^Recorded\s+/i, 'Saved ')
  line = line.replace(/^Flagged\s+/i, 'Marked ')
  line = line.replace(/^Escalated this to you\b/i, 'Asked you to step in')
  line = line.replace(/^Told you\s+/i, '')
  line = line.replace(/^Asked you to (?:choose|pick) a vendor:\s*/i, 'Asked you to pick a vendor for ')
  line = line.replace(/\s+·\s+/g, ' — ')
  line = line.replace(
    /^Phone photo capture started for this inspection\.?$/i,
    'Started phone photo capture for an equipment scan',
  )
  line = line.replace(
    /^Phone photo capture ended\.?$/i,
    'Finished phone photo capture for an equipment scan',
  )
  return line.replace(/\s+/g, ' ').trim()
}

export function inspectionCaptureFeedLine(input: {
  phase: 'started' | 'ended'
  place?: string | null
  photoCount?: number | null
}): FeedLine {
  const place = compactAttentionPlace(input.place)
  const photos =
    typeof input.photoCount === 'number' && Number.isFinite(input.photoCount)
      ? Math.max(0, Math.round(input.photoCount))
      : null
  const countBit =
    input.phase === 'ended' && photos != null && photos > 0
      ? ` (${photos} photo${photos === 1 ? '' : 's'})`
      : ''
  const full =
    input.phase === 'started'
      ? place
        ? `Started phone photo capture for equipment scan at ${place}`
        : 'Started phone photo capture for an equipment scan'
      : place
        ? `Finished phone photo capture for equipment scan at ${place}${countBit}`
        : `Finished phone photo capture for an equipment scan${countBit}`
  const shorter = [
    full,
    place
      ? input.phase === 'started'
        ? `Started phone capture at ${place}`
        : `Finished phone capture at ${place}${countBit}`
      : null,
    input.phase === 'started'
      ? 'Started phone photo capture for an equipment scan'
      : `Finished phone photo capture for an equipment scan${countBit}`,
  ].filter(Boolean) as string[]
  return fitFeedLine(full, shorter, [place ?? '', 'photo', 'capture'])
}

/**
 * Needs-your-attention — plain landlord wording with work order + property.
 * Rebuilds from kind/headline/detail so template updates apply to old rows.
 * Stored `message` is only a fallback when structured fields are missing.
 */
export function attentionAlertFeedLine(input: {
  kind?: string | null
  headline?: string | null
  detail?: string | null
  message?: string | null
  workOrderRef?: string | null
  place?: string | null
}): FeedLine | null {
  const action = attentionAlertActionVerb(input.kind)
  const wo = (input.workOrderRef ?? '').trim() || null
  const place = compactAttentionPlace(input.place)
  const headline = (input.headline ?? '').trim().replace(/\s+/g, ' ')
  const detail = (input.detail ?? '').trim().replace(/\s+/g, ' ')
  const message = softRewriteFeedLine((input.message ?? '').trim())
  const kind = (input.kind ?? '').trim().toLowerCase()

  const noPreferred = kind === 'assign_vendor' && /\bno preferred vendor\b/i.test(headline)
  const vendorUnavailable =
    kind === 'assign_vendor' &&
    /\b(can't take|cannot take|declined|did not respond)\b/i.test(headline)

  const softenIssue = (raw: string) =>
    raw.replace(/^(the|a|an)\b/i, (m) => m.toLowerCase())

  const appendScope = (line: string) => {
    if (place && !line.toLowerCase().includes(place.toLowerCase()) && wo) {
      return `${line} at ${place} (${wo})`
    }
    if (place && !line.toLowerCase().includes(place.toLowerCase())) return `${line} at ${place}`
    if (wo && !line.includes(wo)) return `${line} (${wo})`
    return line
  }

  let full: string
  if (noPreferred) {
    const issue = softenIssue(detail || 'this request')
    // Place/WO before the reason so it reads as one natural sentence.
    full = `${appendScope(`Asked you to pick a vendor for ${issue}`)} — no preferred match`
  } else if (vendorUnavailable) {
    const who = headline.replace(/\s+at this property\s*$/i, '').trim() || headline
    full = appendScope(`Asked you to pick another vendor — ${who}`)
  } else if (kind === 'assign_vendor') {
    const issue = softenIssue(detail || headline)
    full = issue ? appendScope(`Asked you to pick a vendor for ${issue}`) : appendScope(action)
  } else if (headline || detail) {
    const substance = [headline, detail].filter(Boolean).join(' — ')
    full = appendScope(`${action}: ${substance}`)
  } else if (message) {
    // Legacy rows with only a stored message — soft-rewrite, then scope.
    full = appendScope(message)
  } else {
    full = appendScope(action)
  }

  const shorter = [
    full,
    wo && place ? `${action} at ${place} (${wo})` : null,
    wo ? `${action} (${wo})` : null,
    place ? `${action} at ${place}` : null,
    action,
  ].filter(Boolean) as string[]
  return fitFeedLine(full, shorter, [
    wo ?? '',
    ...(place ? place.split(/\s+/) : []),
    ...protectedTokensIn(full),
  ])
}

function windowFrom(source: LandlordFeedCopySource): string | null {
  const meta = source.metadata
  return (
    metaString(meta, 'scheduled_window_text') ??
    metaString(meta, 'window_text') ??
    metaString(meta, 'new_time') ??
    metaString(meta, 'window') ??
    null
  )
}

function looksLikeVisitWindow(text: string | null): boolean {
  if (!text) return false
  return /\d/.test(text) && (/(?:am|pm)/i.test(text) || /\d\s*[–-]\s*\d/.test(text))
}

function quoteFrom(source: LandlordFeedCopySource): string | null {
  return metaString(source.metadata, 'body_preview') ?? metaString(source.metadata, 'quote')
}

function usableCloseReason(raw: string | null): string | null {
  if (!raw || /\b[a-z]+(?:_[a-z0-9]+){2,}\b/i.test(raw)) return null
  return raw
}

function closeReason(source: LandlordFeedCopySource): string | null {
  const own = metaString(source.metadata, 'reason')
  const paired = metaString(source.metadata, '_paired_reason')
  const homeCheck = [own, paired].find((value) => value && /home check/i.test(value) && usableCloseReason(value))
  if (homeCheck) return homeCheck
  const mapped = [own, paired].find((value) => value && CLOSE_CLAUSES[value.toLowerCase()])
  if (mapped) return mapped
  return usableCloseReason(own) ?? usableCloseReason(paired)
}

function isCloseEvent(eventType: string): boolean {
  return (
    eventType === 'maintenance.work_order_terminated' ||
    eventType === 'maintenance.work_order_archived' ||
    eventType === 'maintenance.cancelled' ||
    eventType === 'sms.maintenance_cancelled'
  )
}

export function landlordFeedLine(source: LandlordFeedCopySource): FeedLine | null {
  const type = source.eventType.trim()
  const wo = workOrderRef(source)
  const vendor = source.vendorName ?? metaString(source.metadata, 'vendor_name')
  const meta = source.metadata

  if (type === 'maintenance.spend_recorded') {
    return spendFeedLine({
      amount: meta?.total_cost ?? meta?.amount,
      workOrderRef: wo,
      vendorName: vendor,
      trade: metaString(meta, 'trade') ?? metaString(meta, 'issue_category') ?? metaString(meta, 'service'),
    })
  }
  if (type === 'maintenance.estimate_approved') {
    return estimateApprovedFeedLine({
      amount: meta?.total_cost ?? meta?.amount,
      workOrderRef: wo,
    })
  }
  if (type === 'vendor.alert_sent') return vendorAlertFeedLine({ vendorName: vendor, workOrderRef: wo })
  if (type === 'vendor.accepted' || (type === 'vendor.replied' && (metaString(meta, 'parsed_action') ?? '').toLowerCase() === 'accept')) {
    return vendorAcceptedFeedLine({ vendorName: vendor, workOrderRef: wo })
  }
  if (type === 'vendor.declined' || (type === 'vendor.replied' && (metaString(meta, 'parsed_action') ?? '').toLowerCase() === 'decline')) {
    return vendorDeclinedFeedLine({ vendorName: vendor, workOrderRef: wo })
  }
  if (type === 'vendor.replied') {
    const action = (metaString(meta, 'parsed_action') ?? '').toLowerCase()
    const preview = quoteFrom(source)
    const window = windowFrom(source) ?? (looksLikeVisitWindow(preview) ? preview : null)
    if (action === 'availability' || action === 'reschedule' || window) {
      return vendorProposedFeedLine({ vendorName: vendor, workOrderRef: wo, window })
    }
    return vendorRepliedFeedLine({ vendorName: vendor, workOrderRef: wo, quote: preview })
  }
  if (
    type === 'maintenance.schedule_confirmed' ||
    type === 'maintenance.schedule_tenant_accepted' ||
    type === 'maintenance.resident_reschedule_confirmed'
  ) {
    return tenantConfirmedFeedLine({ workOrderRef: wo, window: windowFrom(source) })
  }
  if (type === 'maintenance.schedule_fsm_ttl_expired') {
    const effect = (metaString(meta, 'effect') ?? '').toLowerCase()
    const message = source.message ?? ''
    const past =
      effect === 'quiet_expire_past_window' || /past visit window|no vendor sms|closed quietly/i.test(message)
    if (past) return windowPassedFeedLine({ workOrderRef: wo })
    const base = wo ? `${wo} visit not confirmed` : 'Visit not confirmed'
    return fitFeedLine(`${base}; vendor asked for another time`, [base], [wo ?? '', 'confirmed'])
  }
  if (isCloseEvent(type)) {
    return closedFeedLine({
      workOrderRef: wo,
      reason: closeReason(source),
      detail: metaString(meta, 'detail') ?? metaString(meta, 'photo_detail'),
    })
  }
  if (type === 'inspection.serial_read' || type === 'inspection.serial_retake_needed') {
    const serial =
      metaString(meta, 'serial') ??
      source.message?.match(/serial number read:?\s*([A-Za-z0-9-]+)/i)?.[1] ??
      null
    return equipmentFeedLine({
      serial,
      appliance: metaString(meta, 'appliance') ?? metaString(meta, 'asset_type'),
    })
  }
  if (type === 'inspection.capture_session_started' || type === 'inspection.capture_session_ended') {
    const photoRaw = meta?.photo_count ?? meta?.photoCount
    const photoCount =
      typeof photoRaw === 'number'
        ? photoRaw
        : typeof photoRaw === 'string' && photoRaw.trim()
          ? Number(photoRaw)
          : null
    return inspectionCaptureFeedLine({
      phase: type === 'inspection.capture_session_started' ? 'started' : 'ended',
      place:
        source.building ??
        metaString(meta, 'building') ??
        metaString(meta, 'property_name') ??
        metaString(meta, 'property_address'),
      photoCount: Number.isFinite(photoCount) ? photoCount : null,
    })
  }
  if (type === 'landlord.attention_alert_sent') {
    return attentionAlertFeedLine({
      kind: metaString(meta, 'kind'),
      headline: metaString(meta, 'headline'),
      detail: metaString(meta, 'detail'),
      message: source.message,
      workOrderRef: wo,
      place:
        source.building ??
        metaString(meta, 'location_line') ??
        metaString(meta, 'building') ??
        metaString(meta, 'street'),
    })
  }
  return null
}

function protectedTokensIn(text: string): string[] {
  const tokens = text.match(/\$[\d,]+(?:\.\d+)?|\bWO-[A-Z0-9]{4}\b/gi) ?? []
  return tokens
}

function stripFiller(text: string): string {
  return text
    .replace(/\bUlo is\b/gi, '')
    .replace(/\ban automated\b/gi, '')
    .replace(/\bsuccessfully\b/gi, '')
    .replace(/\bplease note\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .trim()
}

/** Fallback when no template matches. Still keeps the line inside the window. */
export function fallbackFeedLine(text: string, building?: string | null): FeedLine {
  let full = softRewriteFeedLine(stripFiller(text))
  const place = building?.trim()
  if (place && full.toLowerCase().includes(place.toLowerCase())) {
    full = full.replace(new RegExp(escapeRegExp(place), 'ig'), '').replace(/\s+/g, ' ').trim()
  }
  return fitFeedLine(full, [], protectedTokensIn(full))
}

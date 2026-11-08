import {
  nonJobFeedCardCopy,
  shortTenantForFacts,
  vendorDisplayName,
} from '@shared/activityFeed/feedFactSheet'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'

/** Visible feed headlines stay bite-size: actor + verb + object. */
export const FEED_LINE_MAX_CHARS = 72
export const FEED_LINE_MAX_WORDS = 8
export const FEED_WAITING_MAX_WORDS = 5
export const FEED_TRAIL_MAX_STEPS = 3
export const FEED_TRAIL_STEP_MAX_WORDS = 3

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
  residentName?: string | null
  maintenanceRequestId?: string | null
  /** Preferred visible issue name; WO stays in fullLabel when useful. */
  issueHeadline?: string | null
  metadata?: Record<string, unknown> | null
}

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

/** Display vendor business name (no legal suffix; never initials-only). */
export function shortVendorName(name: string | null | undefined): string | null {
  return vendorDisplayName(name)
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

const TRADE_ISSUE_LABELS: Record<string, string> = {
  plumbing: 'plumbing',
  electrical: 'electrical',
  hvac: 'HVAC',
  pest: 'pest control',
  'pest control': 'pest control',
  appliance: 'appliance',
  general: 'repair',
  handyman: 'handyman',
}

const ISSUE_LEAD_DROP = new Set([
  'broken',
  'leaking',
  'leaky',
  'damaged',
  'faulty',
  'the',
  'a',
  'an',
  'my',
  'our',
])

const ISSUE_MIDDLE_SKIP = new Set(['door', 'window', 'pipe', 'line', 'unit', 'system'])

const ISSUE_TAIL_NOUNS = new Set([
  'leak',
  'seal',
  'fire',
  'clog',
  'overflow',
  'outage',
  'damage',
  'repair',
  'issue',
])

/** 2–3 word issue phrase for headlines ("freezer seal", "heater leak"). */
export function shortIssuePhrase(raw: string | null | undefined): string | null {
  let text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null
  if (/[—–:]/.test(text)) {
    text = text.split(/[—–:]/)[0]?.trim() || text
  }
  text = text.replace(/\bin\s+(unit\s+)?[\w-]+$/i, '').trim()
  const trade = TRADE_ISSUE_LABELS[text.toLowerCase()]
  if (trade) return trade
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean)
    .filter((word) => !ISSUE_LEAD_DROP.has(word.toLowerCase()))
    .filter((word) => !/^\d+$/.test(word))
  if (!words.length) return null
  const lower = words.map((word) => word.toLowerCase())
  const last = lower[lower.length - 1]!
  if (ISSUE_TAIL_NOUNS.has(last) && lower.length >= 2) {
    const head =
      [...lower.slice(0, -1)].reverse().find((word) => !ISSUE_MIDDLE_SKIP.has(word)) ||
      lower[lower.length - 2]!
    return `${head} ${last}`
  }
  return lower.slice(0, 3).join(' ')
}

/** @deprecated Prefer shortIssuePhrase — kept for call sites that want a soft mid-sentence form. */
export function softenIssueHeadline(raw: string | null | undefined): string | null {
  return shortIssuePhrase(raw)
}

/** Visible issue phrase — never a WO code. Falls back to trade or "a repair". */
export function feedIssueLabel(source: LandlordFeedCopySource): string | null {
  const headline =
    softenIssueHeadline(source.issueHeadline) ||
    softenIssueHeadline(metaString(source.metadata, 'issue_headline')) ||
    softenIssueHeadline(metaString(source.metadata, 'issue'))
  if (headline) return headline
  const trade =
    metaString(source.metadata, 'trade') ||
    metaString(source.metadata, 'issue_category') ||
    metaString(source.metadata, 'service')
  if (trade) {
    const mapped = TRADE_ISSUE_LABELS[trade.trim().toLowerCase()]
    return mapped || trade.trim().toLowerCase()
  }
  return null
}

/** Keep WO for tooltip/full when the visible line uses the issue headline. */
export function feedIssueAndWorkOrder(source: LandlordFeedCopySource): {
  issue: string | null
  workOrderRef: string | null
} {
  return {
    issue: feedIssueLabel(source),
    workOrderRef: workOrderRef(source),
  }
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
  issueHeadline: string | null
} {
  const { issue, workOrderRef: wo } = feedIssueAndWorkOrder(source)
  return {
    workOrderRef: wo,
    place: feedPlaceFromSource(source),
    issueHeadline: issue,
  }
}

function endsWithSentencePunctuation(text: string): boolean {
  return /[.!?]"?$/.test(text.trim())
}

function keepWorkOrderOnFull(line: FeedLine, wo: string | null): FeedLine {
  if (!wo) return line
  if (line.full.includes(wo)) return line
  return { line: line.line, full: `${line.full} (${wo})` }
}

/**
 * Ensure the visible line names the issue when known.
 * Never bolts " for …" onto a sentence that already ends in punctuation.
 * Place stays on the grey context line — do not inject it into the main sentence.
 */
export function withFeedScope(
  line: FeedLine,
  input: {
    workOrderRef?: string | null
    place?: string | null
    issueHeadline?: string | null
  },
): FeedLine {
  const wo = (input.workOrderRef ?? '').trim() || null
  const issue =
    softenIssueHeadline(input.issueHeadline) ||
    (input.issueHeadline ?? '').trim() ||
    // When we only know the WO, still name a repair — never show the WO code.
    (wo ? 'repair' : null)

  let visible = line.line.replace(/\s+/g, ' ').trim()
  let full = line.full.replace(/\s+/g, ' ').trim()

  // Prefer issue over WO on the visible line; keep WO on full/tooltip only.
  if (wo && visible.includes(wo)) {
    if (issue && !visible.toLowerCase().includes(issue.toLowerCase())) {
      visible = visible.replace(new RegExp(escapeRegExp(wo), 'gi'), issue).replace(/\s+/g, ' ').trim()
    } else if (!issue) {
      visible = visible
        .replace(new RegExp(`\\s*\\(?${escapeRegExp(wo)}\\)?`, 'gi'), '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,;:.])/g, '$1')
        .trim()
      if (!visible) visible = 'Opened a repair'
    }
  }
  if (wo && full && !full.includes(wo)) full = `${full} (${wo})`

  const alreadyHasIssue =
    Boolean(issue) &&
    (visible.toLowerCase().includes(issue!.toLowerCase()) ||
      full.toLowerCase().includes(issue!.toLowerCase()))
  const alreadyCompleteAction =
    /:/.test(visible) ||
    /\b(spent|invoice|accepted|declined|proposed|replied|confirmed|approved|finished|scan|no reply)\b/i.test(
      visible,
    ) ||
    /^(sent|reported)\b/i.test(visible)
  if (!issue || alreadyHasIssue || endsWithSentencePunctuation(visible) || alreadyCompleteAction) {
    return keepWorkOrderOnFull({ line: visible || line.line, full: full || line.full }, wo)
  }

  const injectIssue = (text: string): string => {
    const trimmed = text.trim()
    if (!trimmed) return String(issue)
    if (endsWithSentencePunctuation(trimmed)) return trimmed
    if (trimmed.toLowerCase().includes(issue!.toLowerCase())) return trimmed
    // One fact: "Verb: issue" — never bolt " for …" onto a finished sentence.
    if (/:$/.test(trimmed)) return `${trimmed} ${issue}`
    return `${trimmed}: ${issue}`
  }

  const nextVisible = injectIssue(visible)
  return keepWorkOrderOnFull(
    fitFeedLine(nextVisible, [visible, String(issue)], [issue!, wo ?? '']),
    wo,
  )
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
 * @deprecated Word-dropping is no longer used for landlord feed lines.
 * Kept for a few unit tests that document the old behavior is retired.
 */
export function priorityShortenFeedLine(source: string, _protectedTokens: string[]): string {
  return source.replace(/\s+/g, ' ').trim()
}

/**
 * @deprecated Word-dropping is no longer used for landlord feed lines.
 */
export function emergencyCutFeedLine(source: string, _protectedTokens: string[]): string {
  return source.replace(/\s+/g, ' ').trim()
}

/**
 * Pick the first complete template variant that fits the budget.
 * Never deletes words and never appends "…". If nothing fits, use the shortest
 * complete variant even when it is over the limit.
 */
export function fitFeedLine(full: string, shorter: string[], _protectedTokens: string[] = []): FeedLine {
  const options = uniqueLines([full, ...shorter])
  const canonical = options[0] ?? ''
  for (const option of options) {
    if (feedLineFits(option)) return { line: option, full: canonical }
  }
  const ranked = [...options].sort(
    (a, b) => a.length - b.length || feedLineWordCount(a) - feedLineWordCount(b),
  )
  return { line: ranked[0] || canonical, full: canonical }
}

function vendorLevels(name: string | null | undefined): string[] {
  const short = shortVendorName(name)
  return short ? [short] : []
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

function issueSubject(input: {
  issueHeadline?: string | null
  workOrderRef?: string | null
  trade?: string | null
}): {
  /** Mid-sentence issue phrase — never a WO code. */
  visible: string | null
  fullSubject: string | null
  wo: string | null
  hasIssue: boolean
} {
  const wo = input.workOrderRef?.trim() || null
  const softened = softenIssueHeadline(input.issueHeadline)
  if (softened) {
    return {
      visible: softened,
      fullSubject: wo ? `${softened} (${wo})` : softened,
      wo,
      hasIssue: true,
    }
  }
  const trade = (input.trade ?? '').trim().toLowerCase()
  const mappedTrade = trade ? TRADE_ISSUE_LABELS[trade] || trade : null
  const fallback = mappedTrade || 'repair'
  return {
    visible: fallback,
    fullSubject: wo ? `${fallback} (${wo})` : fallback,
    wo,
    // Always a human phrase — never fall back to showing WO in the main line.
    hasIssue: true,
  }
}

/** Prefer issue on the visible line; keep WO on full/tooltip when present. */
function withWorkOrderFull(line: FeedLine, wo: string | null): FeedLine {
  if (!wo) return line
  if (line.full.includes(wo)) return line
  return { line: line.line, full: `${line.full} (${wo})` }
}

/** Short issue object for headlines — no articles, never "the job". */
function theIssue(visible: string | null | undefined): string {
  const text = shortIssuePhrase(visible) || (visible ?? '').trim().replace(/^(the|a|an)\s+/i, '')
  return text || 'repair'
}

export function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function spendFeedLine(input: {
  amount: unknown
  workOrderRef?: string | null
  issueHeadline?: string | null
  vendorName?: string | null
  trade?: string | null
}): FeedLine | null {
  const amount = moneyLabel(input.amount)
  if (!amount) return null
  const wo = (input.workOrderRef ?? '').trim() || null
  const vendor = vendorLevels(input.vendorName)[0] ?? null
  const issue = shortIssuePhrase(input.issueHeadline)
  const trade = TRADE_ISSUE_LABELS[(input.trade ?? '').trim().toLowerCase()] || tradeLabel(input.trade)
  const long = vendor
    ? `${vendor} invoice: ${amount}`
    : issue
      ? `${issue}: ${amount}`
      : trade
        ? `${trade}: ${amount}`
        : `Invoice: ${amount}`
  return withWorkOrderFull(
    fitFeedLine(long, [vendor ? `${vendor}: ${amount}` : `Spend ${amount}`, amount], [
      amount,
      vendor ?? '',
      wo ?? '',
    ]),
    wo,
  )
}

export function estimateApprovedFeedLine(input: {
  amount: unknown
  workOrderRef?: string | null
  issueHeadline?: string | null
}): FeedLine | null {
  const amount = moneyLabel(input.amount)
  if (!amount) return null
  const { wo } = issueSubject(input)
  return withWorkOrderFull(
    fitFeedLine(`Estimate ${amount} approved`, [`${amount} approved`, 'Estimate approved'], [
      amount,
      wo ?? '',
      'approved',
    ]),
    wo,
  )
}

export function vendorAlertFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  issueHeadline?: string | null
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const name = vendorLevels(input.vendorName)[0] ?? 'vendor'
  const issue = theIssue(visible)
  const long = `${name}: ${issue}`
  return withWorkOrderFull(
    fitFeedLine(long, [`Sent to ${name}`, `Sent ${issue}`], [name, issue, wo ?? '']),
    wo,
  )
}

export function vendorAcceptedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  issueHeadline?: string | null
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const issue = theIssue(visible)
  return withWorkOrderFull(
    fitFeedLine(`${name} accepted: ${issue}`, [`${name} accepted`, 'Vendor accepted'], [
      name,
      issue,
      wo ?? '',
    ]),
    wo,
  )
}

export function vendorProposedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  issueHeadline?: string | null
  window?: string | null
}): FeedLine {
  const { wo } = issueSubject(input)
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const window = compactWindow(input.window)
  const long = window ? `${name} proposed ${window}` : `${name} proposed time`
  return withWorkOrderFull(
    fitFeedLine(long, [`${name} proposed time`, 'Time proposed'], [name, window ?? '', wo ?? '']),
    wo,
  )
}

export function vendorDeclinedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  issueHeadline?: string | null
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const issue = theIssue(visible)
  return withWorkOrderFull(
    fitFeedLine(`${name} declined: ${issue}`, [`${name} declined`, 'Vendor declined'], [
      name,
      issue,
      wo ?? '',
    ]),
    wo,
  )
}

export function vendorRepliedFeedLine(input: {
  vendorName?: string | null
  workOrderRef?: string | null
  issueHeadline?: string | null
  quote?: string | null
}): FeedLine {
  const { visible, wo, hasIssue } = issueSubject(input)
  const name = vendorLevels(input.vendorName)[0] ?? 'Vendor'
  const quote = trimQuote(input.quote ?? '', 30)
  const base = hasIssue
    ? `${name} replied on ${theIssue(visible)}`
    : wo
      ? `${name} replied on ${wo}`
      : `${name} replied`
  const quoted = (snippet: string) => (snippet ? `${base}: "${snippet}"` : base)
  const shorter = [18, 12, 8]
    .map((max) => trimQuote(quote, max))
    .filter((snippet) => snippet && snippet !== quote)
    .map(quoted)
  return withWorkOrderFull(
    fitFeedLine(quoted(quote), [...shorter, base], [visible ?? '', wo ?? '', 'replied']),
    hasIssue ? wo : null,
  )
}

export function tenantConfirmedFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  window?: string | null
  residentName?: string | null
}): FeedLine {
  const { wo } = issueSubject(input)
  const window = compactWindow(input.window)
  const who = shortTenantForFacts(input.residentName) || 'Tenant'
  const long = window ? `${who} confirmed ${window}` : `${who} confirmed visit`
  return withWorkOrderFull(
    fitFeedLine(long, [`${who} confirmed`, 'Visit confirmed'], [who, window ?? '', wo ?? '']),
    wo,
  )
}

export function windowPassedFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
}): FeedLine {
  const { wo } = issueSubject(input)
  return withWorkOrderFull(
    fitFeedLine('Visit window passed', ['Window passed'], [wo ?? '', 'passed']),
    wo,
  )
}

export function closedFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  reason?: string | null
  detail?: string | null
  vendorName?: string | null
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const reason = (input.reason ?? '').trim()
  if (/home check/i.test(reason)) {
    const copy = nonJobFeedCardCopy({
      kind: 'home_check_declined',
      vendorName: input.vendorName,
    })
    return withWorkOrderFull(
      fitFeedLine(copy.headline, [copy.headline], [wo ?? '', 'closed']),
      wo,
    )
  }
  const mapped = CLOSE_CLAUSES[reason.toLowerCase()]
  const issue = theIssue(visible)
  if (mapped === 'resident cancelled') {
    return withWorkOrderFull(
      fitFeedLine(`Cancelled: ${issue}`, ['Cancelled', 'Closed'], [issue, wo ?? '']),
      wo,
    )
  }
  return withWorkOrderFull(
    fitFeedLine(`Closed: ${issue}`, ['Closed', issue], [issue, wo ?? '']),
    wo,
  )
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
      return 'Pick vendor'
    case 'invoice_ready':
      return 'Invoice ready'
    case 'late_rent':
      return 'Rent late'
    case 'lease_renewal':
      return 'Lease renewal'
    case 'lease_info_missing':
      return 'Lease details missing'
    case 'unknown_occupant':
      return 'Unknown sender'
    case 'external_vendor_replied':
      return 'Vendor reply'
    case 'pm_service':
      return 'HVAC visit'
    case 'weather_alert':
      return 'Weather alert'
    case 'workflow_escalated':
      return 'Needs you'
    default:
      return 'Needs you'
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
  line = line.replace(/\bLandlord attention alert sent\b/gi, 'Needs you')
  line = line.replace(/^Noted\s+/i, '')
  line = line.replace(/^Logged\s+/i, '')
  line = line.replace(/^Recorded\s+/i, 'Saved ')
  line = line.replace(/^Flagged\s+/i, 'Marked ')
  line = line.replace(/^Escalated this to you\b/i, 'Needs you')
  line = line.replace(/^Told you\s+/i, '')
  line = line.replace(/^Asked you to (?:choose|pick) a vendor:\s*/i, 'Pick vendor: ')
  // Repair mangled mid-sentence cuts from older fitFeedLine word-drops.
  line = line.replace(
    /\bResponse time expired with no(?:\s+for\s+(.+))?$/i,
    (_m, issue) => (issue ? `No reply: ${shortIssuePhrase(issue) || 'repair'}` : 'No reply'),
  )
  line = line.replace(
    /\bEstimate of (\$[\d,.]+) was not(?:\s+for\s+(.+))?$/i,
    (_m, amount, issue) =>
      issue
        ? `${amount} estimate declined`
        : `${amount} estimate declined`,
  )
  line = line.replace(
    /\bEstimate of (\$[\d,.]+) was not approved\b/i,
    '$1 estimate declined',
  )
  line = line.replace(/\bTexted (\d+) requests that need a decision\.?/i, 'Needs your decision')
  line = line.replace(/^Phone photo capture started for this inspection\.?$/i, 'Scan started')
  line = line.replace(
    /^Phone photo capture ended\.?$/i,
    'Ulo checked the equipment scan: no issues',
  )
  line = line.replace(
    /^Finished phone photo capture\.?$/i,
    'Ulo checked the equipment scan: no issues',
  )
  // Drop bolted " for …" tails that old assembly added.
  line = line.replace(/\.\s+for\s+.+$/i, '.')
  return line.replace(/\s+/g, ' ').trim()
}

export function inspectionCaptureFeedLine(input: {
  phase: 'started' | 'ended'
  place?: string | null
  photoCount?: number | null
  /** Optional outcome summary when photos looked fine / found issues. */
  outcome?: string | null
}): FeedLine {
  // Place stays on the second line.
  if (input.phase === 'started') {
    return fitFeedLine('Ulo started the equipment scan', ['Scan started'], ['scan'])
  }
  const copy = nonJobFeedCardCopy({ kind: 'equipment_scan_ok' })
  return fitFeedLine(copy.headline, [copy.headline], ['scan'])
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
  const headline = (input.headline ?? '').trim().replace(/\s+/g, ' ')
  const detail = (input.detail ?? '').trim().replace(/\s+/g, ' ')
  const message = softRewriteFeedLine((input.message ?? '').trim())
  const kind = (input.kind ?? '').trim().toLowerCase()
  const issue = shortIssuePhrase(detail || headline)
  if (!issue || /^(repair|they asked for|asked for)$/i.test(issue)) {
    // Empty template vars — hide rather than "Needs you: they asked for".
    if (!kind || kind === 'workflow_escalated' || /asked for/i.test(`${headline} ${detail}`)) {
      return null
    }
  }
  const issueLabel = issue && !/^(repair)$/i.test(issue) ? issue : null

  const noPreferred = kind === 'assign_vendor' && /\bno preferred vendor\b/i.test(headline)
  const vendorUnavailable =
    kind === 'assign_vendor' &&
    /\b(can't take|cannot take|declined|did not respond)\b/i.test(headline)
  const urgent = /\burgent\b|\bfire\b|\bgas\b|\bflood\b/i.test(`${headline} ${detail}`)

  let full: string
  let shorter: string[] = []
  if (noPreferred && issueLabel) {
    full = urgent
      ? `⚠ Pick a vendor for the ${issueLabel.toLowerCase()}`
      : `Pick a vendor for the ${issueLabel.toLowerCase()}`
    shorter = [full, 'Pick a vendor']
  } else if (vendorUnavailable && issueLabel) {
    full = `Pick a vendor for the ${issueLabel.toLowerCase()}`
    shorter = [full, 'Pick a vendor']
  } else if (kind === 'assign_vendor' && issueLabel) {
    full = urgent
      ? `⚠ Pick a vendor for the ${issueLabel.toLowerCase()}`
      : `Pick a vendor for the ${issueLabel.toLowerCase()}`
    shorter = [full, 'Pick a vendor']
  } else if (issueLabel && (headline || detail) && action !== 'Needs you') {
    full = `${action}: ${issueLabel}`
    shorter = [full, action]
  } else if (message && !/they asked for/i.test(message)) {
    full = message
    shorter = [message, action]
  } else if (issueLabel) {
    full = `Review the ${issueLabel.toLowerCase()}`
    shorter = [full, 'Review']
  } else {
    return null
  }

  // Place stays on the second line — never fold it into the headline.
  const fitted = fitFeedLine(full, shorter, protectedTokensIn(full))
  return withWorkOrderFull(fitted, wo)
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

function personName(raw: string | null | undefined, fallback: string): string {
  return shortTenantForFacts(raw) || (raw ?? '').trim() || fallback
}

export function openedWorkOrderFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  residentName?: string | null
  submitted?: boolean
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const who = shortTenantForFacts(input.residentName)
  const issue = theIssue(visible)
  if (input.submitted) {
    const full = who ? `${who} reported: ${issue}` : `Reported: ${issue}`
    return withWorkOrderFull(
      fitFeedLine(full, [who ? `${who} reported` : 'Repair reported', issue], [
        issue,
        wo ?? '',
        who ?? '',
      ]),
      wo,
    )
  }
  return withWorkOrderFull(
    fitFeedLine(`Opened: ${issue}`, ['Repair opened', issue], [issue, wo ?? '']),
    wo,
  )
}

export function vendorNoReplyFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  vendorName?: string | null
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const vendor = shortVendorName(input.vendorName) || 'Vendor'
  const issue = theIssue(visible)
  return withWorkOrderFull(
    fitFeedLine(`${vendor}: no reply`, [`No reply: ${issue}`, 'No reply'], [
      vendor,
      issue,
      wo ?? '',
    ]),
    wo,
  )
}

export function estimateDeclinedFeedLine(input: {
  amount: unknown
  workOrderRef?: string | null
  issueHeadline?: string | null
  vendorName?: string | null
}): FeedLine {
  const amount = moneyLabel(input.amount)
  const { wo } = issueSubject(input)
  const vendor = shortVendorName(input.vendorName)
  const long = amount
    ? vendor
      ? `${vendor}'s ${amount} estimate declined`
      : `${amount} estimate declined`
    : vendor
      ? `${vendor}'s estimate declined`
      : 'Estimate declined'
  return withWorkOrderFull(
    fitFeedLine(long, ['Estimate declined', amount ? `Declined ${amount}` : 'Declined'], [
      amount ?? '',
      vendor ?? '',
      wo ?? '',
    ]),
    wo,
  )
}

export function completedWorkOrderFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  vendorName?: string | null
}): FeedLine {
  const { visible, wo } = issueSubject(input)
  const vendor = shortVendorName(input.vendorName)
  const issue = theIssue(visible)
  const full = vendor ? `${vendor} finished: ${issue}` : `Finished: ${issue}`
  return withWorkOrderFull(
    fitFeedLine(full, [vendor ? `${vendor} finished` : 'Work done', 'Finished'], [
      vendor ?? '',
      issue,
      wo ?? '',
    ]),
    wo,
  )
}

export function scheduleUpdatedFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  window?: string | null
}): FeedLine {
  const { wo } = issueSubject(input)
  const window = compactWindow(input.window)
  const long = window ? `Visit updated: ${window}` : 'Visit updated'
  return withWorkOrderFull(
    fitFeedLine(long, ['Visit updated'], [window ?? '', wo ?? '']),
    wo,
  )
}

export function rentFeedLine(input: {
  kind: 'due' | 'reminder' | 'payment' | 'late'
  residentName?: string | null
  amount?: unknown
}): FeedLine {
  const who = personName(input.residentName, 'resident')
  const amount = moneyLabel(input.amount)
  if (input.kind === 'due') {
    return fitFeedLine(`Rent due: ${who}`, ['Rent due'], [who, 'due'])
  }
  if (input.kind === 'reminder') {
    return fitFeedLine(`Rent reminder: ${who}`, ['Rent reminder'], [who, 'reminder'])
  }
  if (input.kind === 'late') {
    return fitFeedLine(`Late rent: ${who}`, ['Late rent'], [who, 'late'])
  }
  const long = amount ? `Rent paid: ${amount}` : `Rent paid: ${who}`
  return fitFeedLine(long, [`${who} paid rent`, 'Rent paid'], [who, amount ?? '', 'payment'])
}

export function tenantActivationFeedLine(input: {
  kind: 'sent' | 'completed'
  residentName?: string | null
}): FeedLine {
  const who = personName(input.residentName, 'resident')
  if (input.kind === 'sent') {
    return fitFeedLine(`Welcome text: ${who}`, ['Welcome text sent'], [who, 'welcome'])
  }
  return fitFeedLine(`${who} activated`, ['Resident activated'], [who, 'Activated'])
}

export function slaReassignedFeedLine(input: {
  workOrderRef?: string | null
  issueHeadline?: string | null
  vendorName?: string | null
}): FeedLine {
  const { visible, wo, hasIssue } = issueSubject(input)
  const vendor = shortVendorName(input.vendorName)
  if (hasIssue) {
    const full = vendor
      ? `Reassigned ${theIssue(visible)} after ${vendor} didn't respond in time`
      : `Reassigned ${theIssue(visible)} after the vendor didn't respond in time`
    return withWorkOrderFull(
      fitFeedLine(full, [`Reassigned ${theIssue(visible)}`, "Reassigned the job after the vendor didn't respond in time"], [
        visible ?? '',
        wo ?? '',
        'Reassigned',
      ]),
      wo,
    )
  }
  const full = wo
    ? `Reassigned ${wo} after the vendor didn't respond in time`
    : "Reassigned the job after the vendor didn't respond in time"
  return fitFeedLine(full, ["Reassigned the job after the vendor didn't respond in time"], [
    wo ?? '',
    'Reassigned',
  ])
}

/** Event types with a dedicated landlordFeedLine sentence template. */
export const LANDLORD_FEED_SENTENCE_EVENT_TYPES = [
  'maintenance.created',
  'maintenance.request_submitted',
  'maintenance.spend_recorded',
  'maintenance.estimate_approved',
  'maintenance.schedule_confirmed',
  'maintenance.schedule_tenant_accepted',
  'maintenance.resident_reschedule_confirmed',
  'maintenance.schedule_updated',
  'maintenance.schedule_fsm_ttl_expired',
  'maintenance.completed',
  'maintenance.sla_auto_reassigned',
  'maintenance.sla_expired_needs_vendor',
  'maintenance.schedule_tenant_ask',
  'maintenance.estimate_rejected',
  'maintenance.estimate_declined',
  'maintenance.work_order_terminated',
  'maintenance.work_order_archived',
  'maintenance.cancelled',
  'sms.maintenance_cancelled',
  'vendor.alert_sent',
  'vendor.accepted',
  'vendor.declined',
  'vendor.replied',
  'rent.due_detected',
  'rent.reminder_sent',
  'rent.payment_received',
  'rent.late_escalated',
  'tenant.activation_sms_sent',
  'tenant.activation_completed',
  'inspection.serial_read',
  'inspection.serial_retake_needed',
  'inspection.capture_session_started',
  'inspection.capture_session_ended',
  'landlord.attention_alert_sent',
] as const

export function landlordFeedLine(source: LandlordFeedCopySource): FeedLine | null {
  const type = source.eventType.trim()
  const wo = workOrderRef(source)
  const issueHeadline =
    (source.issueHeadline ?? '').trim() ||
    metaString(source.metadata, 'issue_headline') ||
    metaString(source.metadata, 'issue') ||
    null
  const vendor = source.vendorName ?? metaString(source.metadata, 'vendor_name')
  const resident = source.residentName ?? metaString(source.metadata, 'resident_name')
  const meta = source.metadata

  if (type === 'maintenance.created') {
    return openedWorkOrderFeedLine({ workOrderRef: wo, issueHeadline, residentName: resident })
  }
  if (type === 'maintenance.request_submitted') {
    return openedWorkOrderFeedLine({
      workOrderRef: wo,
      issueHeadline,
      residentName: resident,
      submitted: true,
    })
  }
  if (type === 'maintenance.completed') {
    return completedWorkOrderFeedLine({ workOrderRef: wo, issueHeadline, vendorName: vendor })
  }
  if (type === 'maintenance.schedule_updated') {
    return scheduleUpdatedFeedLine({
      workOrderRef: wo,
      issueHeadline,
      window: windowFrom(source),
    })
  }
  if (
    type === 'maintenance.sla_auto_reassigned' ||
    type === 'maintenance.sla_expired_needs_vendor'
  ) {
    // Prefer the plain "didn't reply" sentence; keep the reassignment wording when
    // metadata says a new vendor was already found.
    const outcome = (metaString(meta, 'outcome') ?? metaString(meta, 'auto_reassign_last_outcome') ?? '').toLowerCase()
    if (outcome.includes('needs_admin') || type === 'maintenance.sla_expired_needs_vendor') {
      return vendorNoReplyFeedLine({ workOrderRef: wo, issueHeadline, vendorName: vendor })
    }
    return vendorNoReplyFeedLine({ workOrderRef: wo, issueHeadline, vendorName: vendor })
  }
  if (type === 'maintenance.schedule_tenant_ask') {
    const who = personName(resident, 'tenant')
    return withWorkOrderFull(
      fitFeedLine(`Asked ${who} to confirm`, ['Asked tenant', 'Confirm visit'], [who, wo ?? '']),
      wo,
    )
  }
  if (
    type === 'maintenance.estimate_rejected' ||
    type === 'maintenance.estimate_declined' ||
    /estimate of .+ was not/i.test(source.message ?? '') ||
    /declined .+ estimate/i.test(source.message ?? '')
  ) {
    return estimateDeclinedFeedLine({
      amount: meta?.total_cost ?? meta?.amount ?? meta?.estimate_amount,
      workOrderRef: wo,
      issueHeadline,
      vendorName: vendor,
    })
  }
  if (type === 'rent.due_detected') {
    return rentFeedLine({ kind: 'due', residentName: resident })
  }
  if (type === 'rent.reminder_sent') {
    return rentFeedLine({ kind: 'reminder', residentName: resident })
  }
  if (type === 'rent.payment_received') {
    return rentFeedLine({
      kind: 'payment',
      residentName: resident,
      amount: meta?.amount ?? meta?.total_paid ?? meta?.payment_amount,
    })
  }
  if (type === 'rent.late_escalated') {
    return rentFeedLine({ kind: 'late', residentName: resident })
  }
  if (type === 'tenant.activation_sms_sent') {
    return tenantActivationFeedLine({ kind: 'sent', residentName: resident })
  }
  if (type === 'tenant.activation_completed') {
    return tenantActivationFeedLine({ kind: 'completed', residentName: resident })
  }

  if (type === 'maintenance.spend_recorded') {
    return spendFeedLine({
      amount: meta?.total_cost ?? meta?.amount,
      workOrderRef: wo,
      issueHeadline,
      vendorName: vendor,
      trade: metaString(meta, 'trade') ?? metaString(meta, 'issue_category') ?? metaString(meta, 'service'),
    })
  }
  if (type === 'maintenance.estimate_approved') {
    return estimateApprovedFeedLine({
      amount: meta?.total_cost ?? meta?.amount,
      workOrderRef: wo,
      issueHeadline,
    })
  }
  if (type === 'vendor.alert_sent') {
    return vendorAlertFeedLine({ vendorName: vendor, workOrderRef: wo, issueHeadline })
  }
  if (type === 'vendor.accepted' || (type === 'vendor.replied' && (metaString(meta, 'parsed_action') ?? '').toLowerCase() === 'accept')) {
    return vendorAcceptedFeedLine({ vendorName: vendor, workOrderRef: wo, issueHeadline })
  }
  if (type === 'vendor.declined' || (type === 'vendor.replied' && (metaString(meta, 'parsed_action') ?? '').toLowerCase() === 'decline')) {
    return vendorDeclinedFeedLine({ vendorName: vendor, workOrderRef: wo, issueHeadline })
  }
  if (type === 'vendor.replied') {
    const action = (metaString(meta, 'parsed_action') ?? '').toLowerCase()
    const preview = quoteFrom(source)
    const window = windowFrom(source) ?? (looksLikeVisitWindow(preview) ? preview : null)
    if (action === 'availability' || action === 'reschedule' || window) {
      return vendorProposedFeedLine({ vendorName: vendor, workOrderRef: wo, issueHeadline, window })
    }
    return vendorRepliedFeedLine({ vendorName: vendor, workOrderRef: wo, issueHeadline, quote: preview })
  }
  if (
    type === 'maintenance.schedule_confirmed' ||
    type === 'maintenance.schedule_tenant_accepted' ||
    type === 'maintenance.resident_reschedule_confirmed'
  ) {
    return tenantConfirmedFeedLine({
      workOrderRef: wo,
      issueHeadline,
      window: windowFrom(source),
      residentName: source.residentName,
    })
  }
  if (type === 'maintenance.schedule_fsm_ttl_expired') {
    const effect = (metaString(meta, 'effect') ?? '').toLowerCase()
    const message = source.message ?? ''
    const past =
      effect === 'quiet_expire_past_window' || /past visit window|no vendor sms|closed quietly/i.test(message)
    if (past) return windowPassedFeedLine({ workOrderRef: wo, issueHeadline })
    const subject = issueHeadline || wo
    const base = subject
      ? issueHeadline
        ? `${issueHeadline} visit not confirmed`
        : `${wo} visit not confirmed`
      : 'Visit not confirmed'
    return fitFeedLine(`${base}; vendor asked for another time`, [base], [issueHeadline ?? '', wo ?? '', 'confirmed'])
  }
  if (isCloseEvent(type)) {
    return closedFeedLine({
      workOrderRef: wo,
      issueHeadline,
      reason: closeReason(source),
      detail: metaString(meta, 'detail') ?? metaString(meta, 'photo_detail'),
      vendorName: source.vendorName,
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

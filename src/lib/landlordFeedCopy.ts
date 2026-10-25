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

/** Drop whole words until the line fits. Never splits a word, amount, or work-order ref. */
export function emergencyCutFeedLine(source: string, protectedTokens: string[]): string {
  const original = source.trim()
  const kept = original.split(/\s+/).filter(Boolean)
  const render = (mark: boolean) => (mark ? `${kept.join(' ')}…` : kept.join(' '))
  let mark = false
  while (kept.length > 0 && !feedLineFits(render(mark))) {
    let dropAt = -1
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (!isProtectedWord(kept[index]!, protectedTokens)) {
        dropAt = index
        break
      }
    }
    if (dropAt === -1) break
    kept.splice(dropAt, 1)
    mark = true
  }
  return render(mark).trim()
}

export function fitFeedLine(full: string, shorter: string[], protectedTokens: string[]): FeedLine {
  const options = uniqueLines([full, ...shorter])
  const canonical = options[0] ?? ''
  for (const option of options) {
    if (feedLineFits(option)) return { line: option, full: canonical }
  }
  const base = options[options.length - 1] || canonical
  return { line: emergencyCutFeedLine(base, protectedTokens), full: canonical }
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
  const base = wo ? `${amount} estimate approved for ${wo}` : `${amount} estimate approved`
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
      ? `Tenant confirmed ${window} visit for ${wo}`
      : `Tenant confirmed ${window} visit`
    : null
  const fallback = wo ? `Tenant confirmed the visit for ${wo}` : 'Tenant confirmed the visit'
  return fitFeedLine(withWindow ?? fallback, withWindow ? [fallback] : [], [wo ?? '', 'confirmed'])
}

export function windowPassedFeedLine(input: { workOrderRef?: string | null }): FeedLine {
  const wo = input.workOrderRef?.trim() || null
  const base = wo
    ? `${wo} visit window passed without tenant confirmation`
    : 'Visit window passed without tenant confirmation'
  return fitFeedLine(`${base}; no texts sent`, [base], [wo ?? '', 'passed'])
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
  const line = `${wo} closed: ${clause}`
  const plain = `${wo} closed: not a repair`
  return fitFeedLine(line, clause === 'not a repair' ? [] : [plain], [wo === 'Work order' ? '' : wo, 'closed'])
}

export function equipmentFeedLine(input: {
  serial?: string | null
  appliance?: string | null
}): FeedLine | null {
  const serial = (input.serial ?? '').trim()
  if (!serial || /\s/.test(serial)) return null
  const appliance = tradeLabel(input.appliance)
  const withAppliance = appliance ? `${appliance} serial ${serial} recorded` : null
  const fallback = `Serial ${serial} recorded`
  return fitFeedLine(withAppliance ?? fallback, withAppliance ? [fallback] : [], [serial, 'recorded'])
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
  let full = stripFiller(text)
  const place = building?.trim()
  if (place && full.includes(place)) full = full.replace(place, '').replace(/\s+/g, ' ').trim()
  return fitFeedLine(full, [], protectedTokensIn(full))
}

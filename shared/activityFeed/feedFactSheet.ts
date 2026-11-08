/**
 * Clean fact sheet for landlord Activity Feed cards.
 * AI (or fallback templates) write copy from these facts only — never raw event names.
 */

export type FeedCardStatus =
  | 'needs_vendor'
  | 'waiting_on_vendor'
  | 'estimate_pending'
  | 'invoice_pending'
  | 'visit_scheduled'
  | 'done'
  | 'other'

export type FeedCardWaitingOn = 'you' | 'vendor' | 'tenant' | 'none'

export type FeedFactSheet = {
  issue: string
  property: string | null
  unit: string | null
  vendor: string | null
  amount: string | null
  status: FeedCardStatus
  waiting_on: FeedCardWaitingOn
  waiting_on_name: string | null
  safety: boolean
  milestones: string[]
}

export type FeedCardCopy = {
  headline: string
  status_line: string
}

export type FeedCardCopyCache = FeedCardCopy & {
  facts_hash: string
  source: 'ai' | 'fallback'
  updated_at: string
}

export type FeedTicketFactsInput = {
  issueHeadline?: string | null
  building?: string | null
  unitLabel?: string | null
  propertyType?: string | null
  vendorName?: string | null
  residentName?: string | null
  awaitingLandlordChoiceAt?: string | null
  vendorWorkStatus?: string | null
  spendStatus?: string | null
  scheduleConfirmedAt?: string | null
  scheduledAt?: string | null
  recognizedSpendAmount?: number | null
  estimateAmount?: number | null
  completedAt?: string | null
  cancelledAt?: string | null
  vendorWorkStatusRaw?: string | null
}

export type FeedMilestoneEvent = {
  eventType: string
  label?: string | null
  message?: string | null
  vendorName?: string | null
  createdAt?: string | null
  metadata?: Record<string, unknown> | null
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

const ISSUE_MIDDLE_SKIP = new Set(['door', 'window', 'pipe', 'line', 'unit', 'system', 'in'])

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
  'faucet',
])

const SAFETY_RE =
  /\b(fire|gas|spark|sparking|flood|flooding|no heat|no heating|carbon monoxide|smoke)\b/i

const BANNED_JARGON =
  /\b(workflow|probe|probed|classified|batch|reassigned|escalat|fsm|sla|digest|graph|token)\b/i

const RAW_EVENT_NAME =
  /^[a-z]+(?:[ _][a-z0-9]+)+$/i

const GENERIC_VENDOR_WORDS = new Set(['the', 'a', 'abc'])

/** 2–4 word issue phrase. Never a vendor name. Never truncated mid-word. */
export function shortIssueForFacts(
  raw: string | null | undefined,
  vendorName?: string | null,
): string {
  let text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return 'Repair'
  if (/[—–:]/.test(text)) text = text.split(/[—–:]/)[0]?.trim() || text
  text = text.replace(/\bin\s+(unit\s+)?[\w-]+$/i, '').trim()

  const vendor = shortVendorForFacts(vendorName)
  if (vendor && text.toLowerCase() === vendor.toLowerCase()) return 'Repair'
  if (vendor && text.toLowerCase().startsWith(vendor.toLowerCase() + ' ')) {
    text = text.slice(vendor.length).trim()
  }

  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean)
    .filter((word) => !ISSUE_LEAD_DROP.has(word.toLowerCase()))
    .filter((word) => !/^\d+$/.test(word))

  if (!words.length) return 'Repair'

  const lower = words.map((w) => w.toLowerCase())
  const last = lower[lower.length - 1]!
  let picked: string[]
  if (ISSUE_TAIL_NOUNS.has(last) && lower.length >= 2) {
    const head =
      [...lower.slice(0, -1)].reverse().find((w) => !ISSUE_MIDDLE_SKIP.has(w)) ||
      lower[lower.length - 2]!
    // Prefer up to 3 words ending at the tail noun when available.
    const headIdx = lower.lastIndexOf(head)
    picked = lower.slice(Math.max(0, headIdx - 1), lower.length).slice(-3)
    if (!picked.includes(last)) picked = [head, last]
  } else {
    picked = lower.slice(0, 4)
  }

  return picked
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}

export function shortVendorForFacts(name: string | null | undefined): string | null {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const first = words[0]!
  if (GENERIC_VENDOR_WORDS.has(first.toLowerCase()) && words[1]) return `${first} ${words[1]}`
  return first
}

export function shortTenantForFacts(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/).filter(Boolean)[0]
  return first || null
}

function moneyLabel(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  const cents = Math.round(value * 100) / 100
  if (Math.abs(cents - Math.round(cents)) < 0.001) {
    return `$${Math.round(cents).toLocaleString('en-US')}`
  }
  return cents.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function resolveStatus(ticket: FeedTicketFactsInput): FeedCardStatus {
  const work = (ticket.vendorWorkStatus ?? ticket.vendorWorkStatusRaw ?? '').toLowerCase()
  const spend = (ticket.spendStatus ?? '').toLowerCase()
  if (ticket.completedAt || work === 'completed' || work === 'done') return 'done'
  if (ticket.cancelledAt || work === 'cancelled' || work === 'canceled') return 'done'
  if (spend === 'invoice_pending' || spend === 'pending_payment') return 'invoice_pending'
  if (spend === 'pending_approval') return 'estimate_pending'
  if (ticket.awaitingLandlordChoiceAt || work === 'declined') return 'needs_vendor'
  if (ticket.scheduledAt && !ticket.scheduleConfirmedAt) return 'visit_scheduled'
  if (ticket.scheduledAt && ticket.scheduleConfirmedAt) return 'visit_scheduled'
  if (work === 'pending_accept' || work === 'notified' || work === 'offered') return 'waiting_on_vendor'
  if (work === 'accepted' || work === 'in_progress') return 'waiting_on_vendor'
  if (!ticket.vendorName) return 'needs_vendor'
  return 'other'
}

function resolveWaitingOn(
  status: FeedCardStatus,
  ticket: FeedTicketFactsInput,
): { waiting_on: FeedCardWaitingOn; waiting_on_name: string | null } {
  if (status === 'done') return { waiting_on: 'none', waiting_on_name: null }
  if (status === 'needs_vendor' || status === 'estimate_pending' || status === 'invoice_pending') {
    return { waiting_on: 'you', waiting_on_name: null }
  }
  if (status === 'waiting_on_vendor') {
    const vendor = shortVendorForFacts(ticket.vendorName)
    return { waiting_on: 'vendor', waiting_on_name: vendor }
  }
  if (status === 'visit_scheduled' && ticket.scheduledAt && !ticket.scheduleConfirmedAt) {
    const tenant = shortTenantForFacts(ticket.residentName)
    return { waiting_on: 'tenant', waiting_on_name: tenant }
  }
  return { waiting_on: 'none', waiting_on_name: null }
}

/** Internal / diagnostic event types never become milestones. */
export const FEED_FACT_HIDDEN_EVENT_TYPES = new Set([
  'workflow.trigger',
  'workflow.classify',
  'workflow.route',
  'workflow.act',
  'workflow.log',
  'maintenance.classified',
  'maintenance.vendor_availability_probed',
  'vendor.availability_probed',
  'ops.needs_admin_vendor_digest',
  'ops.ticket_unit_fk_mismatch',
  'maintenance.open_asks_closed',
  'maintenance.auto_reassign_loop_detected',
  'sms.delivered',
  'sms.message_received',
  'sms.intent_recognized',
])

const MILESTONE_BY_TYPE: Record<string, string> = {
  'vendor.alert_sent': 'Sent to vendor',
  'vendor.accepted': 'Accepted',
  'vendor.declined': 'Declined',
  'maintenance.sla_auto_reassigned': 'No reply',
  'maintenance.sla_expired_needs_vendor': 'No reply',
  'landlord.attention_alert_sent': 'Asked you',
  'maintenance.created': 'Opened',
  'maintenance.request_submitted': 'Opened',
  'maintenance.completed': 'Work done',
  'maintenance.estimate_approved': 'Estimate approved',
  'maintenance.estimate_declined': 'Estimate declined',
  'maintenance.estimate_rejected': 'Estimate declined',
  'maintenance.spend_recorded': 'Invoice recorded',
  'maintenance.schedule_confirmed': 'Visit confirmed',
  'maintenance.schedule_updated': 'Visit updated',
  'inspection.capture_session_ended': 'Scan finished',
}

function milestoneFromEvent(event: FeedMilestoneEvent): string | null {
  const type = (event.eventType ?? '').trim().toLowerCase()
  if (!type || FEED_FACT_HIDDEN_EVENT_TYPES.has(type)) return null
  if (RAW_EVENT_NAME.test(type.replace(/\./g, ' '))) {
    // dotted types are fine; reject space/underscore raw labels below
  }
  const mapped = MILESTONE_BY_TYPE[type]
  if (mapped) {
    if (type === 'vendor.alert_sent') {
      const vendor = shortVendorForFacts(event.vendorName)
      return vendor ? `Sent to ${vendor}` : mapped
    }
    return mapped
  }
  const label = (event.label ?? event.message ?? '').trim()
  if (!label) return null
  if (looksLikeRawOrJargon(label)) return null
  // Keep whole words only — never mid-name truncation.
  const words = label.split(/\s+/).filter(Boolean).slice(0, 4)
  if (!words.length) return null
  return words.join(' ')
}

export function looksLikeRawOrJargon(text: string): boolean {
  const value = text.trim()
  if (!value) return true
  if (BANNED_JARGON.test(value)) return true
  if (RAW_EVENT_NAME.test(value) && !/\b(Sent|Accepted|Declined|Opened|Waiting)\b/.test(value)) {
    return true
  }
  if (/^[A-Z]+(?: [A-Z]+)+$/.test(value) && value.split(/\s+/).length >= 2) {
    // ALL CAPS multi-word like "MAINTENANCE CLASSIFIED"
    return true
  }
  return false
}

export function buildFeedFactSheet(
  ticket: FeedTicketFactsInput,
  events: FeedMilestoneEvent[] = [],
): FeedFactSheet {
  const vendor = shortVendorForFacts(ticket.vendorName)
  const issue = shortIssueForFacts(ticket.issueHeadline, ticket.vendorName)
  const status = resolveStatus(ticket)
  const waiting = resolveWaitingOn(status, ticket)
  const amount =
    moneyLabel(ticket.estimateAmount) || moneyLabel(ticket.recognizedSpendAmount)

  const chronological = [...events].sort((a, b) =>
    String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
  )
  const milestones: string[] = []
  const seen = new Set<string>()
  for (const event of chronological) {
    const step = milestoneFromEvent(event)
    if (!step) continue
    const key = step.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    milestones.push(step)
  }

  return {
    issue,
    property: (ticket.building ?? '').trim() || null,
    unit: (ticket.unitLabel ?? '').trim() || null,
    vendor,
    amount,
    status,
    waiting_on: waiting.waiting_on,
    waiting_on_name: waiting.waiting_on_name,
    safety: SAFETY_RE.test(ticket.issueHeadline ?? ''),
    milestones: milestones.slice(-3),
  }
}

export function feedFactsHash(facts: FeedFactSheet): string {
  const payload = JSON.stringify({
    issue: facts.issue,
    property: facts.property,
    unit: facts.unit,
    vendor: facts.vendor,
    amount: facts.amount,
    status: facts.status,
    waiting_on: facts.waiting_on,
    waiting_on_name: facts.waiting_on_name,
    safety: facts.safety,
    milestones: facts.milestones,
  })
  // FNV-1a 32-bit — stable, no crypto dependency in shared.
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function collectAllowedTokens(facts: FeedFactSheet): string[] {
  const tokens = [
    facts.issue,
    facts.property,
    facts.unit,
    facts.vendor,
    facts.amount,
    facts.waiting_on_name,
    ...facts.milestones,
    'you',
    'vendor',
    'tenant',
    'Ulo',
  ]
    .filter(Boolean)
    .map((t) => String(t))
  const parts: string[] = []
  for (const token of tokens) {
    parts.push(token)
    for (const word of token.split(/\s+/)) {
      if (word.length >= 2) parts.push(word)
    }
  }
  return [...new Set(parts)]
}

/**
 * Validate AI output against facts. Rejects invented names/amounts, jargon,
 * arrows, and overlong lines.
 */
export function validateFeedCardCopy(
  copy: FeedCardCopy,
  facts: FeedFactSheet,
): { ok: true } | { ok: false; reason: string } {
  const headline = (copy.headline ?? '').trim().replace(/\s+/g, ' ')
  const statusLine = (copy.status_line ?? '').trim().replace(/\s+/g, ' ')
  if (!headline) return { ok: false, reason: 'empty_headline' }
  if (wordCount(headline) > 8) return { ok: false, reason: 'headline_too_long' }
  if (statusLine && wordCount(statusLine) > 6) return { ok: false, reason: 'status_too_long' }
  if (/→|->|—|–/.test(headline) || /→|->/.test(statusLine)) {
    return { ok: false, reason: 'arrows' }
  }
  if (BANNED_JARGON.test(headline) || BANNED_JARGON.test(statusLine)) {
    return { ok: false, reason: 'jargon' }
  }
  if (looksLikeRawOrJargon(headline)) return { ok: false, reason: 'raw_headline' }

  const allowed = collectAllowedTokens(facts).map((t) => t.toLowerCase())
  const moneyInOutput = `${headline} ${statusLine}`.match(/\$[\d,]+(?:\.\d+)?/g) ?? []
  for (const amount of moneyInOutput) {
    if (!facts.amount || amount.replace(/,/g, '') !== facts.amount.replace(/,/g, '')) {
      // Allow exact facts.amount match loosely
      if (!facts.amount || !facts.amount.includes(amount.replace(/\.00$/, '')) && amount !== facts.amount) {
        if (facts.amount !== amount) return { ok: false, reason: `invented_amount:${amount}` }
      }
    }
  }

  // Proper nouns / multi-word tokens from output that look like names must be in facts.
  const nameLike =
    `${headline} ${statusLine}`.match(/\b[A-Z][a-zA-Z0-9'&.-]{1,}(?:\s+[A-Z][a-zA-Z0-9'&.-]{1,})?\b/g) ??
    []
  for (const name of nameLike) {
    const lower = name.toLowerCase()
    if (['ulo', 'waiting', 'waiting on', 'no', 'yes', 'unit'].includes(lower)) continue
    if (lower === facts.issue.toLowerCase()) continue
    if (facts.issue.toLowerCase().includes(lower)) continue
    if (!allowed.some((token) => token === lower || token.includes(lower) || lower.includes(token))) {
      // Single common English words OK
      if (/^(Freezer|Dryer|Heater|Water|Photo|Home|Scan|Pick|Sent|Work|Visit|Rent|Invoice|Estimate|Approved|Declined|Opened|Finished|Repair|Fire|Seal|Leak)$/i.test(name)) {
        continue
      }
      return { ok: false, reason: `invented_name:${name}` }
    }
  }

  if (facts.waiting_on === 'you' && statusLine && !/you|your|approval|pick|decide/i.test(statusLine)) {
    return { ok: false, reason: 'waiting_mismatch' }
  }
  if (facts.waiting_on === 'none' && /^Waiting on\b/i.test(statusLine)) {
    return { ok: false, reason: 'waiting_mismatch_none' }
  }

  return { ok: true }
}

export function fallbackFeedCardCopy(facts: FeedFactSheet): FeedCardCopy {
  const issue = facts.issue || 'Repair'
  let headline: string
  if (facts.safety && facts.status === 'needs_vendor') {
    headline = `⚠ ${issue}: no vendor yet`
  } else if (facts.status === 'needs_vendor') {
    headline = `Pick vendor: ${issue}`
  } else if (facts.status === 'estimate_pending' && facts.amount && facts.vendor) {
    headline = `${facts.vendor}'s ${facts.amount} estimate`
  } else if (facts.status === 'estimate_pending' && facts.amount) {
    headline = `${facts.amount} estimate pending`
  } else if (facts.status === 'invoice_pending' && facts.amount && facts.vendor) {
    headline = `${facts.vendor} invoice: ${facts.amount}`
  } else if (facts.status === 'invoice_pending' && facts.amount) {
    headline = `Invoice: ${facts.amount}`
  } else if (facts.status === 'waiting_on_vendor' && facts.vendor) {
    headline = `${facts.vendor}: ${issue}`
  } else if (facts.status === 'visit_scheduled') {
    headline = `Visit set: ${issue}`
  } else if (facts.status === 'done') {
    headline = facts.vendor ? `${facts.vendor} finished: ${issue}` : `Finished: ${issue}`
  } else {
    headline = `${issue}: update`
  }

  // Clamp to 8 words without mid-word cuts.
  const words = headline.split(/\s+/).filter(Boolean)
  if (words.length > 8) headline = words.slice(0, 8).join(' ')

  let status_line = ''
  if (facts.waiting_on === 'you') {
    status_line =
      facts.status === 'estimate_pending' || facts.status === 'invoice_pending'
        ? 'Waiting on your approval'
        : 'Waiting on you to pick'
  } else if (facts.waiting_on === 'vendor') {
    status_line = facts.waiting_on_name
      ? `Waiting on ${facts.waiting_on_name}`
      : 'Waiting on vendor'
  } else if (facts.waiting_on === 'tenant') {
    status_line = facts.waiting_on_name
      ? `Waiting on ${facts.waiting_on_name}`
      : 'Waiting on tenant'
  }

  if (wordCount(status_line) > 6) {
    status_line = status_line.split(/\s+/).slice(0, 6).join(' ')
  }

  return { headline, status_line }
}

/** Non-job card templates (vendor activation, home check, photo). */
export function nonJobFeedCardCopy(input: {
  kind:
    | 'vendor_activated'
    | 'vendor_activated_without_docs'
    | 'photo_no_issues'
    | 'home_check_declined'
  vendorName?: string | null
  appliance?: string | null
  tenantName?: string | null
}): FeedCardCopy {
  const vendor = shortVendorForFacts(input.vendorName) || 'Vendor'
  const tenant = shortTenantForFacts(input.tenantName) || 'tenant'
  switch (input.kind) {
    case 'vendor_activated':
      return { headline: `${vendor} activated`, status_line: '' }
    case 'vendor_activated_without_docs':
      return { headline: `${vendor} activated without documents`, status_line: '' }
    case 'photo_no_issues': {
      const appliance = (input.appliance ?? 'Photo').trim() || 'Photo'
      return { headline: `${appliance}: no issues`, status_line: '' }
    }
    case 'home_check_declined':
      return { headline: `Home check declined by ${tenant}`, status_line: '' }
    default:
      return { headline: 'Update', status_line: '' }
  }
}

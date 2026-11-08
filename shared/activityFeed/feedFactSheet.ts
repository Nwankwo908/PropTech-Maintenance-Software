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

export type FeedCardKind = 'ulo_did' | 'needs_you'

export type FeedFactSheet = {
  kind: FeedCardKind
  issue: string | null
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
  /** Always empty in the new voice — needs_you headlines already say the ask. */
  status_line: string
}

export type FeedCardCopyCache = FeedCardCopy & {
  facts_hash: string
  source: 'ai' | 'fallback'
  updated_at: string
}

export type FeedTicketFactsInput = {
  issueHeadline?: string | null
  /** Description / summary when issue_headline is missing. */
  descriptionSummary?: string | null
  /** Trade / category fallback, e.g. plumbing → "plumbing job". */
  trade?: string | null
  building?: string | null
  unitLabel?: string | null
  propertyType?: string | null
  vendorName?: string | null
  residentName?: string | null
  awaitingLandlordChoiceAt?: string | null
  vendorWorkStatus?: string | null
  spendStatus?: string | null
  /** Latest maintenance_estimates.status for this ticket. */
  estimateDecision?: 'pending_approval' | 'approved' | 'rejected' | 'superseded' | null
  estimateAmount?: number | null
  scheduleConfirmedAt?: string | null
  scheduledAt?: string | null
  recognizedSpendAmount?: number | null
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
  'faucet',
  'control',
])

const SAFETY_RE =
  /\b(fire|gas|spark|sparking|flood|flooding|no heat|no heating|carbon monoxide|smoke)\b/i

const BANNED_JARGON =
  /\b(workflow|probe|probed|classified|batch|reassigned|escalat|fsm|sla|digest|graph|token)\b/i

const LEGAL_SUFFIX_RE =
  /\b(?:llc|l\.l\.c|inc|incorporated|co|corp|corporation|ltd|limited|plc|pllc|pc|p\.c)\b\.?/gi

const EMPTY_TEMPLATE_ISSUE_RE =
  /^(they asked for|asked for|needs you|repair|update|the job|this job|n\/?a|null|undefined)$/i

/** 2–4 word issue phrase. Never a vendor name. Never truncated mid-word. Returns null when unusable. */
export function shortIssueForFacts(
  raw: string | null | undefined,
  vendorName?: string | null,
): string | null {
  let text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text || EMPTY_TEMPLATE_ISSUE_RE.test(text)) return null
  if (/[—–:]/.test(text)) text = text.split(/[—–:]/)[0]?.trim() || text
  text = text.replace(/\bin\s+(unit\s+)?[\w-]+$/i, '').trim()

  const vendor = vendorDisplayName(vendorName)
  if (vendor && text.toLowerCase() === vendor.toLowerCase()) return null
  if (vendor && text.toLowerCase().startsWith(vendor.toLowerCase() + ' ')) {
    text = text.slice(vendor.length).trim()
  }

  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean)
    .filter((word) => !ISSUE_LEAD_DROP.has(word.toLowerCase()))
    .filter((word) => !/^\d+$/.test(word))
    .filter((word) => !/^(repair|update|issue|job)$/i.test(word))

  if (!words.length) return null

  const lower = words.map((w) => w.toLowerCase())
  const last = lower[lower.length - 1]!
  let picked: string[]
  if (ISSUE_TAIL_NOUNS.has(last) && lower.length >= 2) {
    const head =
      [...lower.slice(0, -1)].reverse().find((w) => !ISSUE_MIDDLE_SKIP.has(w)) ||
      lower[lower.length - 2]!
    const headIdx = lower.lastIndexOf(head)
    picked = lower.slice(Math.max(0, headIdx - 1), lower.length).slice(-3)
    if (!picked.includes(last)) picked = [head, last]
  } else {
    picked = lower.slice(0, 4)
  }

  const phrase = picked
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
  if (EMPTY_TEMPLATE_ISSUE_RE.test(phrase) || /^(Repair|Update)$/i.test(phrase)) return null
  return phrase
}

/**
 * Business name minus legal suffixes. Never initials-only / first-word-only.
 * Cap at 2–3 meaningful words when longer.
 */
export function vendorDisplayName(name: string | null | undefined): string | null {
  const cleaned = (name ?? '')
    .replace(LEGAL_SUFFIX_RE, '')
    .replace(/[,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (!words.length) return null
  // Drop trailing empty tokens from suffix strip ("NTA Services ," → already cleaned)
  const meaningful = words.filter((w) => !/^(and|&)$/i.test(w))
  const kept = meaningful.length > 3 ? meaningful.slice(0, 3) : meaningful
  const result = kept.join(' ').trim()
  if (!result) return null
  // Reject initials-only (e.g. "NTA", "ABC")
  if (kept.length === 1 && /^[A-Z0-9]{1,4}$/.test(kept[0]!) && kept[0]!.length <= 4) {
    // Keep when the original had more words before suffix strip failed oddly —
    // but a lone acronym is not a display name for the feed.
    if (!/\s/.test((name ?? '').replace(LEGAL_SUFFIX_RE, '').trim())) {
      // Try keeping first two from original before suffix strip if available
      const originalWords = (name ?? '').trim().split(/\s+/).filter(Boolean)
      if (originalWords.length >= 2) {
        return originalWords.slice(0, Math.min(3, originalWords.length)).join(' ')
          .replace(LEGAL_SUFFIX_RE, '')
          .replace(/\s+/g, ' ')
          .trim() || null
      }
      return null
    }
  }
  return result
}

/** @deprecated Use vendorDisplayName — kept as alias for older call sites. */
export function shortVendorForFacts(name: string | null | undefined): string | null {
  return vendorDisplayName(name)
}

export function shortTenantForFacts(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/).filter(Boolean)[0]
  return first || null
}

export function resolveIssueForFacts(ticket: FeedTicketFactsInput): string | null {
  const fromHeadline = shortIssueForFacts(ticket.issueHeadline, ticket.vendorName)
  if (fromHeadline) return fromHeadline
  const fromDesc = shortIssueForFacts(ticket.descriptionSummary, ticket.vendorName)
  if (fromDesc) return fromDesc
  const trade = (ticket.trade ?? '').trim().toLowerCase()
  if (trade && !/^(general|other|unknown|n\/?a)$/i.test(trade)) {
    const label = trade === 'hvac' ? 'HVAC' : trade.charAt(0).toUpperCase() + trade.slice(1)
    return `${label} job`
  }
  return null
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
  const estimate = (ticket.estimateDecision ?? '').toLowerCase()

  if (ticket.completedAt || work === 'completed' || work === 'done') return 'done'
  if (ticket.cancelledAt || work === 'cancelled' || work === 'canceled') return 'done'

  // Current estimate record wins over stale spend_status for estimate cards.
  if (estimate === 'pending_approval') return 'estimate_pending'
  if (estimate === 'rejected') return 'needs_vendor'

  if (spend === 'invoice_pending' || spend === 'pending_payment') return 'invoice_pending'
  // Only treat spend pending_approval as estimate when we lack a decided estimate.
  if (spend === 'pending_approval' && estimate !== 'approved' && estimate !== 'rejected') {
    return 'estimate_pending'
  }

  if (ticket.awaitingLandlordChoiceAt || work === 'declined') return 'needs_vendor'
  if (ticket.scheduledAt) return 'visit_scheduled'
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
    return { waiting_on: 'vendor', waiting_on_name: vendorDisplayName(ticket.vendorName) }
  }
  if (status === 'visit_scheduled' && ticket.scheduledAt && !ticket.scheduleConfirmedAt) {
    return { waiting_on: 'tenant', waiting_on_name: shortTenantForFacts(ticket.residentName) }
  }
  return { waiting_on: 'none', waiting_on_name: null }
}

function resolveKind(
  status: FeedCardStatus,
  waiting_on: FeedCardWaitingOn,
): FeedCardKind {
  if (
    waiting_on === 'you' ||
    status === 'needs_vendor' ||
    status === 'estimate_pending' ||
    status === 'invoice_pending'
  ) {
    return 'needs_you'
  }
  return 'ulo_did'
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
  const mapped = MILESTONE_BY_TYPE[type]
  if (mapped) {
    if (type === 'vendor.alert_sent') {
      const vendor = vendorDisplayName(event.vendorName)
      return vendor ? `Sent to ${vendor}` : mapped
    }
    return mapped
  }
  const label = (event.label ?? event.message ?? '').trim()
  if (!label) return null
  if (looksLikeRawOrJargon(label)) return null
  const words = label.split(/\s+/).filter(Boolean).slice(0, 4)
  if (!words.length) return null
  return words.join(' ')
}

export function looksLikeRawOrJargon(text: string): boolean {
  const value = text.trim()
  if (!value) return true
  if (BANNED_JARGON.test(value)) return true
  // Underscore / snake event leftovers (not plain English sentences).
  if (/\b[a-z]+(?:_[a-z0-9]+){1,}\b/i.test(value)) return true
  if (/^[A-Z]+(?: [A-Z]+)+$/.test(value) && value.split(/\s+/).length >= 2) {
    return true
  }
  // Dotted event types flattened to spaces, e.g. "maintenance vendor availability probed"
  if (
    /^(maintenance|vendor|workflow|ops|sms|tenant|inspection)(?:\s+[a-z0-9]+){1,}$/i.test(value)
  ) {
    return true
  }
  return false
}

export function looksLikePropertyInventoryNoise(text: string | null | undefined): boolean {
  const value = (text ?? '').trim()
  if (!value) return false
  return (
    /\bis a multifamily property\b/i.test(value) ||
    /\bis a single[- ]family property\b/i.test(value) ||
    /\bUnits?\b.+\bare listed\b/i.test(value) ||
    /\bis occupied\b/i.test(value)
  )
}

export function looksLikeEmptyTemplateFeedCopy(text: string | null | undefined): boolean {
  const value = (text ?? '').trim()
  if (!value) return true
  if (/Needs you:\s*they asked for\b/i.test(value)) return true
  if (/:\s*(they asked for|asked for|repair|update)\s*$/i.test(value)) return true
  if (/\bRepair:\s*update\b/i.test(value)) return true
  if (EMPTY_TEMPLATE_ISSUE_RE.test(value)) return true
  return false
}

/** True when a job card must be omitted (no real issue name). */
export function shouldHideFeedFactSheet(facts: FeedFactSheet): boolean {
  if (!facts.issue) return true
  if (/^(Repair|Update)$/i.test(facts.issue)) return true
  return false
}

export function buildFeedFactSheet(
  ticket: FeedTicketFactsInput,
  events: FeedMilestoneEvent[] = [],
): FeedFactSheet {
  const vendor = vendorDisplayName(ticket.vendorName)
  const issue = resolveIssueForFacts(ticket)
  const status = resolveStatus(ticket)
  const waiting = resolveWaitingOn(status, ticket)
  const kind = resolveKind(status, waiting.waiting_on)

  // Amount: estimate record when estimate-related; invoice amount when invoice-related.
  let amount: string | null = null
  if (status === 'estimate_pending' || ticket.estimateDecision === 'rejected') {
    amount = moneyLabel(ticket.estimateAmount) || moneyLabel(ticket.recognizedSpendAmount)
  } else if (status === 'invoice_pending') {
    amount = moneyLabel(ticket.recognizedSpendAmount) || moneyLabel(ticket.estimateAmount)
  } else {
    amount =
      moneyLabel(ticket.estimateAmount) || moneyLabel(ticket.recognizedSpendAmount)
  }

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

  const safetySource = `${ticket.issueHeadline ?? ''} ${ticket.descriptionSummary ?? ''}`
  return {
    kind,
    issue,
    property: (ticket.building ?? '').trim() || null,
    unit: (ticket.unitLabel ?? '').trim() || null,
    vendor,
    amount,
    status,
    waiting_on: waiting.waiting_on,
    waiting_on_name: waiting.waiting_on_name,
    safety: SAFETY_RE.test(safetySource),
    milestones: milestones.slice(-3),
  }
}

export function feedFactsHash(facts: FeedFactSheet): string {
  const payload = JSON.stringify({
    kind: facts.kind,
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

function looksLikeInitialsOnlyVendor(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.length === 1 && /^[A-Z0-9]{1,4}$/.test(words[0]!)
}

/**
 * Validate AI output against facts. Rejects invented names/amounts, jargon,
 * arrows, Repair-as-issue, and initials-only vendor names.
 */
export function validateFeedCardCopy(
  copy: FeedCardCopy,
  facts: FeedFactSheet,
): { ok: true } | { ok: false; reason: string } {
  const headline = (copy.headline ?? '').trim().replace(/\s+/g, ' ')
  const statusLine = (copy.status_line ?? '').trim().replace(/\s+/g, ' ')
  if (!headline) return { ok: false, reason: 'empty_headline' }
  if (wordCount(headline) > 14) return { ok: false, reason: 'headline_too_long' }
  // New voice: no waiting line.
  if (statusLine) return { ok: false, reason: 'status_line_not_allowed' }
  if (/→|->|—|–/.test(headline)) return { ok: false, reason: 'arrows' }
  if (BANNED_JARGON.test(headline)) return { ok: false, reason: 'jargon' }
  if (looksLikeRawOrJargon(headline)) return { ok: false, reason: 'raw_headline' }
  if (/\bRepair\b/i.test(headline) && !facts.issue?.toLowerCase().includes('repair')) {
    return { ok: false, reason: 'repair_as_issue' }
  }
  if (/\b:\s*update\b/i.test(headline) || /\bRepair:\s*update\b/i.test(headline)) {
    return { ok: false, reason: 'update_as_issue' }
  }
  if (looksLikeEmptyTemplateFeedCopy(headline)) {
    return { ok: false, reason: 'empty_template' }
  }

  if (facts.kind === 'ulo_did' && !/^Ulo\b/.test(headline) && !/^⚠\s*Ulo\b/.test(headline)) {
    // Allow safety prefix before Ulo
    if (!/^⚠/.test(headline)) return { ok: false, reason: 'ulo_did_must_start_ulo' }
  }
  if (facts.kind === 'needs_you') {
    if (!/^(⚠\s*)?(Pick|Approve|Review|Confirm)\b/i.test(headline)) {
      return { ok: false, reason: 'needs_you_must_be_imperative' }
    }
  }

  const moneyInOutput = headline.match(/\$[\d,]+(?:\.\d+)?/g) ?? []
  for (const amount of moneyInOutput) {
    if (!facts.amount || facts.amount.replace(/,/g, '') !== amount.replace(/,/g, '')) {
      if (facts.amount !== amount) return { ok: false, reason: `invented_amount:${amount}` }
    }
  }

  if (facts.vendor && looksLikeInitialsOnlyVendor(facts.vendor)) {
    return { ok: false, reason: 'initials_only_vendor' }
  }
  // Reject headlines that use initials-only when a fuller vendor exists
  const vendorMentions = headline.match(/\b[A-Z]{2,4}\b/g) ?? []
  for (const token of vendorMentions) {
    if (['ULO', 'HVAC', 'SMS', 'YES', 'NO'].includes(token)) continue
    if (facts.vendor && facts.vendor.split(/\s+/).length >= 2 && token === facts.vendor.split(/\s+/)[0] && token.length <= 4) {
      // Using only first token of a multi-word vendor is rejected when it's acronym-shaped
      if (/^[A-Z]{2,4}$/.test(token) && !headline.includes(facts.vendor)) {
        return { ok: false, reason: `initials_only_vendor:${token}` }
      }
    }
  }

  const allowed = collectAllowedTokens(facts).map((t) => t.toLowerCase())
  const nameLike =
    headline.match(/\b[A-Z][a-zA-Z0-9'&.-]{1,}(?:\s+[A-Z][a-zA-Z0-9'&.-]{1,}){0,2}\b/g) ?? []
  for (const name of nameLike) {
    const lower = name.toLowerCase()
    if (['ulo', 'pick', 'approve', 'review', 'confirm', 'unit'].includes(lower)) continue
    if (facts.issue && (lower === facts.issue.toLowerCase() || facts.issue.toLowerCase().includes(lower))) {
      continue
    }
    if (facts.vendor && (lower === facts.vendor.toLowerCase() || facts.vendor.toLowerCase().includes(lower))) {
      continue
    }
    if (!allowed.some((token) => token === lower || token.includes(lower) || lower.includes(token))) {
      if (
        /^(Freezer|Dryer|Heater|Water|Photo|Home|Scan|Pick|Sent|Work|Visit|Rent|Invoice|Estimate|Approved|Declined|Opened|Finished|Fire|Seal|Leak|Pest|Control|Services|Appliances|Management|Vendor|Tenant)$/i.test(
          name,
        )
      ) {
        continue
      }
      return { ok: false, reason: `invented_name:${name}` }
    }
  }

  return { ok: true }
}

function issueInSentence(issue: string): string {
  // "Freezer seal" → "the freezer seal"
  return `the ${issue.charAt(0).toLowerCase()}${issue.slice(1)}`
}

export function fallbackFeedCardCopy(facts: FeedFactSheet): FeedCardCopy | null {
  if (shouldHideFeedFactSheet(facts) || !facts.issue) return null

  const issue = facts.issue
  const issuePhrase = issueInSentence(issue)
  const vendor = facts.vendor
  const amount = facts.amount
  let headline: string

  if (facts.kind === 'needs_you') {
    if (facts.status === 'estimate_pending' && amount && vendor) {
      headline = `Approve ${vendor}'s ${amount} estimate`
    } else if (facts.status === 'estimate_pending' && amount) {
      headline = `Approve the ${amount} estimate`
    } else if (facts.status === 'invoice_pending' && amount && vendor) {
      headline = `Approve ${vendor}'s ${amount} invoice`
    } else if (facts.status === 'invoice_pending' && amount) {
      headline = `Approve the ${amount} invoice`
    } else if (facts.safety && facts.status === 'needs_vendor') {
      headline = `⚠ Pick a vendor for ${issuePhrase}`
    } else if (facts.status === 'needs_vendor') {
      headline = `Pick a vendor for ${issuePhrase}`
    } else {
      headline = `Review ${issuePhrase}`
    }
  } else {
    // ulo_did
    if (facts.status === 'done' && vendor) {
      headline = `Ulo finished ${issuePhrase} with ${vendor}`
    } else if (facts.status === 'done') {
      headline = `Ulo finished ${issuePhrase}`
    } else if (facts.status === 'waiting_on_vendor' && vendor) {
      headline = `Ulo sent ${issuePhrase} to ${vendor}`
    } else if (facts.status === 'visit_scheduled') {
      headline = `Ulo confirmed the visit for ${issuePhrase}`
    } else if (vendor) {
      headline = `Ulo updated ${issuePhrase} with ${vendor}`
    } else {
      headline = `Ulo updated ${issuePhrase}`
    }
  }

  const words = headline.split(/\s+/).filter(Boolean)
  if (words.length > 14) headline = words.slice(0, 14).join(' ')

  return { headline, status_line: '' }
}

/** Non-job card templates (vendor activation, home check, photo). */
export function nonJobFeedCardCopy(input: {
  kind:
    | 'vendor_activated'
    | 'vendor_activated_without_docs'
    | 'vendor_invited'
    | 'photo_no_issues'
    | 'equipment_scan_ok'
    | 'home_check_declined'
  vendorName?: string | null
  appliance?: string | null
  tenantName?: string | null
}): FeedCardCopy {
  const vendor = vendorDisplayName(input.vendorName) || 'Vendor'
  switch (input.kind) {
    case 'vendor_activated':
      return { headline: `Ulo activated ${vendor}`, status_line: '' }
    case 'vendor_invited':
      return { headline: `Ulo invited ${vendor} to verify`, status_line: '' }
    case 'vendor_activated_without_docs':
      return { headline: `${vendor} has no documents on file`, status_line: '' }
    case 'photo_no_issues':
    case 'equipment_scan_ok':
      return { headline: 'Ulo checked the equipment scan: no issues', status_line: '' }
    case 'home_check_declined':
      return { headline: `${vendor} declined the home check`, status_line: '' }
    default:
      return { headline: 'Ulo updated the account', status_line: '' }
  }
}

/** Reschedule ask when resident + issue are known; null when facts are missing. */
export function rescheduleNeedsYouCopy(input: {
  residentName?: string | null
  issueHeadline?: string | null
  vendorName?: string | null
}): FeedCardCopy | null {
  const who = shortTenantForFacts(input.residentName)
  const issue = shortIssueForFacts(input.issueHeadline, input.vendorName)
  if (!who || !issue) return null
  return {
    headline: `${who} asked to reschedule the ${issue.charAt(0).toLowerCase()}${issue.slice(1)} visit`,
    status_line: '',
  }
}

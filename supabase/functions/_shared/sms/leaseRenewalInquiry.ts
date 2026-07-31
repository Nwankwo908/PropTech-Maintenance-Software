/**
 * Early (pre-cron) lease renewal SMS detection + friendly acknowledgements.
 * Pipeline updates only — does not escalate to Needs your attention.
 */

export type LeaseInquiryResponse = "renew" | "move_out" | "questions"

export type LeaseInquiryParse = {
  isLeaseInquiry: boolean
  response: LeaseInquiryResponse | null
  preferredTermYears: 1 | 2 | "either" | null
  wantsRenewalTiming: boolean
  /** Short plain-language notes for ack copy (tenant-facing). */
  noted: string[]
}

const LEASE_RENEWAL_SIGNAL =
  /\b(?:lease\s*renew(?:al|ing)?|renew(?:al|ing)?\s+(?:my\s+|our\s+)?lease|renewal\s+lease|new\s+lease|lease\s+extension|extend(?:ing)?\s+(?:my\s+|our\s+)?lease|renew(?:al)?\s+(?:offer|paperwork|documents?|contract))\b/i

const RENEW_INTENT =
  /\b(?:want\s+to\s+renew|like\s+to\s+renew|plan(?:ning)?\s+to\s+renew|will\s+renew|i'?d\s+like\s+to\s+stay|stay\s+(?:another|one\s+more)|renew(?:ing)?)\b/i

const MOVE_OUT_INTENT =
  /\b(?:mov(?:e|ing)\s+out|won'?t\s+renew|not\s+renewing|vacat(?:e|ing)|leaving\s+(?:at\s+)?(?:lease\s+)?end)\b/i

const TIMING_ASK =
  /\b(?:when\s+(?:will|do|can|should|would|i\s+would|i\s+will)|wondering\s+when|have\s+not\s+received|haven'?t\s+received|receive\s+(?:a\s+|my\s+)?renewal|waiting\s+(?:on|for)\s+(?:my\s+)?renewal|renewal\s+(?:ready|coming|sent))\b/i

const TERM_EITHER =
  /\b(?:1|one)\s*(?:-|–|to|or)\s*(?:2|two)\s*years?\b|\b(?:2|two)\s*(?:-|–|to|or)\s*(?:1|one)\s*years?\b|\b1\s*or\s*2\s*years?\b|\bone\s*or\s*two\s*years?\b/i

const TERM_ONE = /\b(?:1|one)[\s-]*year\b/i
const TERM_TWO = /\b(?:2|two)[\s-]*years?\b/i

/** True when inbound SMS is about lease renewal (not maintenance). */
export function isLeaseRenewalInquirySms(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  if (LEASE_RENEWAL_SIGNAL.test(t)) return true
  // "renew" + year/term without "lease" still counts when clearly about term length
  if (/\brenew/i.test(t) && (TERM_EITHER.test(t) || TERM_ONE.test(t) || TERM_TWO.test(t))) {
    return true
  }
  if (/\blease\b/i.test(t) && (TIMING_ASK.test(t) || TERM_EITHER.test(t))) {
    return true
  }
  return false
}

export function parseLeaseRenewalInquiry(body: string): LeaseInquiryParse {
  const t = body.trim()
  const isLeaseInquiry = isLeaseRenewalInquirySms(t)
  if (!isLeaseInquiry) {
    return {
      isLeaseInquiry: false,
      response: null,
      preferredTermYears: null,
      wantsRenewalTiming: false,
      noted: [],
    }
  }

  const noted: string[] = []
  let preferredTermYears: 1 | 2 | "either" | null = null
  if (TERM_EITHER.test(t)) {
    preferredTermYears = "either"
    noted.push("you'd like a 1- or 2-year option")
  } else if (TERM_TWO.test(t) && !TERM_ONE.test(t)) {
    preferredTermYears = 2
    noted.push("you'd prefer a 2-year term")
  } else if (TERM_ONE.test(t)) {
    preferredTermYears = 1
    noted.push("you'd prefer a 1-year term")
  }

  const wantsRenewalTiming = TIMING_ASK.test(t)
  if (wantsRenewalTiming) {
    noted.push("you'd like to know when your renewal will be ready")
  }

  let response: LeaseInquiryResponse | null = null
  if (MOVE_OUT_INTENT.test(t)) {
    response = "move_out"
    noted.push("you're planning to move out")
  } else if (RENEW_INTENT.test(t) || preferredTermYears != null) {
    response = "renew"
    if (preferredTermYears == null) {
      noted.push("you're interested in renewing")
    }
  } else if (wantsRenewalTiming || /\b(?:question|wondering|can we)\b/i.test(t)) {
    response = "questions"
  }

  // Dedupe noted lines
  const uniqueNoted = [...new Set(noted)]

  return {
    isLeaseInquiry: true,
    response,
    preferredTermYears,
    wantsRenewalTiming,
    noted: uniqueNoted,
  }
}

export function buildEarlyLeaseInquiryAckSms(params: {
  parse: LeaseInquiryParse
  leaseEndDate?: string | null
}): string {
  const { parse, leaseEndDate } = params
  const endLabel = leaseEndDate
    ? new Date(`${leaseEndDate}T12:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    : null

  const lines: string[] = [
    "Thanks for reaching out about your lease renewal.",
  ]

  if (parse.noted.length === 1) {
    lines.push(`I've noted that ${parse.noted[0]}.`)
  } else if (parse.noted.length > 1) {
    const last = parse.noted[parse.noted.length - 1]
    const head = parse.noted.slice(0, -1).join(", ")
    lines.push(`I've noted that ${head}, and ${last}.`)
  } else {
    lines.push("I've noted your message for your property management team.")
  }

  if (endLabel) {
    lines.push(`Your current lease ends ${endLabel}.`)
  }

  if (parse.response === "move_out") {
    lines.push(
      "Someone from your property team will follow up about move-out next steps.",
    )
  } else {
    lines.push(
      "Your property management team will follow up with renewal details and next steps. You're all set on this for now — feel free to reply here if anything else comes up.",
    )
  }

  return lines.join(" ")
}

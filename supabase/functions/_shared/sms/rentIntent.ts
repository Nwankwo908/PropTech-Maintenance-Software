/**
 * Semantic rent SMS intent — meaning over word-order regex.
 *
 * Specialized rent sub-intents (due date, payment link, late, …) win first.
 * Balance is detected from amount/owing/balance signals, with or without "rent".
 */
export type RentSmsTopic =
  | "balance"
  | "due_date"
  | "monthly_rent"
  | "payment_link"
  | "payment_status"
  | "late"
  | "already_paid"
  | "partial"
  | "general"

export type RentSmsClassification = {
  /** Maps to tenant SMS intents: rent_balance | rent_late | null (general handoff). */
  kind: "rent_balance" | "rent_late" | "rent_general" | null
  topic: RentSmsTopic | null
  confident: boolean
  /** Competing non-rent amount context — ask before assuming rent. */
  needsClarification: boolean
}

function normalizeRentSms(body: string): string {
  return body
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Non-rent money talk in the recent thread (invoice, deposit, estimate, …). */
export function hasCompetingFinancialContext(
  recentTurns: string | null | undefined,
): boolean {
  if (!recentTurns?.trim()) return false
  return /\b(invoice|deposit|estimate|security deposit|utility|reimbursement|work[\s-]?order (cost|charge|bill)|vendor (bill|invoice)|damage charge|pet fee)\b/i
    .test(recentTurns)
}

function isDueDateAsk(text: string): boolean {
  if (
    /\b(when|what day|which day|what date)\b/.test(text) &&
    /\b(rent|due)\b/.test(text)
  ) {
    return true
  }
  return /\brent due date\b/.test(text) || /\bdue date (for|on) (my )?rent\b/.test(text)
}

function isPaymentLinkAsk(text: string): boolean {
  return (
    /\b(payment link|pay link|link to pay|checkout link)\b/.test(text) ||
    (/\b(send|text|resend|share|give)\b/.test(text) &&
      /\b(link|url)\b/.test(text) &&
      /\b(pay|payment|rent)\b/.test(text)) ||
    /\bsend (me )?(the |a )?link\b/.test(text) && /\b(pay|rent)\b/.test(text)
  )
}

function isPaymentStatusAsk(text: string): boolean {
  if (
    /\b(did|has|have)\b/.test(text) &&
    /\b(payment|rent)\b/.test(text) &&
    /\b(go through|went through|clear|cleared|post|posted|receive|received|get|got|process|processed)\b/
      .test(text)
  ) {
    return true
  }
  return (
    /\bi (already )?paid (my )?rent\b/.test(text) ||
    /\b(payment|rent) (went through|was received|was posted)\b/.test(text)
  )
}

function isLateRent(text: string): boolean {
  return (
    /\b(late|behind)\b/.test(text) && /\brent\b/.test(text) ||
    /\bcan'?t (make|pay) (my )?rent\b/.test(text) ||
    /\bneed more time\b/.test(text) && /\brent\b/.test(text) ||
    /\b(gonna|going to|will) be late\b/.test(text)
  )
}

function isPartialPayment(text: string): boolean {
  return (
    /\b(only|just) pay (half|part|partial|some)\b/.test(text) ||
    /\bpartial (payment|rent)\b/.test(text) ||
    /\bcan only pay\b/.test(text)
  )
}

function isRentIncreaseOrGeneral(text: string): boolean {
  return (
    /\brent (increase|raise|hike|going up)\b/.test(text) ||
    /\b(question|ask(?:ing)?|curious) about (my )?rent\b/.test(text) &&
      !/\b(owe|balance|due|pay|left|outstanding)\b/.test(text)
  )
}

function isMonthlyRentAsk(text: string): boolean {
  // "How much is my rent?" = stated monthly amount, not current balance due.
  if (/\bhow much is (my |the )?rent\b/.test(text)) return true
  if (/\bwhat is (my |the )?monthly rent\b/.test(text)) return true
  if (/\bmonthly rent\b/.test(text) && /\b(how much|what is|what'?s)\b/.test(text)) {
    return true
  }
  if (/\bwhat'?s my rent for this month\b/.test(text)) return true
  return false
}

/**
 * Balance / amount-due meaning — word order does not matter.
 * Does not require the word "rent" for a known tenant SMS.
 */
function isBalanceMeaning(text: string): boolean {
  if (!text) return false

  // Ultra-short SMS: "Balance?", "Rent due?", "Amount due?", "What I owe?"
  if (
    /^(yo\s+)?(my\s+)?(rent\s+)?(balance|amount due|what i owe|how much i owe|how much for rent|rent due|due|outstanding)\b/
      .test(text)
  ) {
    return true
  }
  if (/^(check|send|tell me|can you (tell me |check )?)?(my )?(rent )?balance\b/.test(text)) {
    return true
  }
  if (/^(can you )?(check|tell me) (how much|what) i owe\b/.test(text)) {
    return true
  }

  const hasOwe =
    /\b(owe|owed|owing)\b/.test(text) ||
    /\bwhat i owe\b/.test(text)
  const hasBalance =
    /\b(balance|amount due|outstanding|remaining)\b/.test(text)
  const hasDueAmount =
    /\b(what'?s|what is|how much is|how much)\b/.test(text) &&
    /\b(due|left|remaining|outstanding)\b/.test(text)
  const hasPayAmount =
    /\b(how much|what)\b/.test(text) &&
    /\b(need to pay|have to pay|got to pay|gotta pay|to pay|still (need|have) to pay)\b/
      .test(text)
  const hasLeftToPay =
    /\b(what'?s|what is|is there|anything|what)\b/.test(text) &&
    /\b(left|remaining|outstanding)\b/.test(text) &&
    /\b(pay|payment|rent|owe|on (my )?(rent|account))?\b/.test(text)
  const hasPaidUpAsk =
    /\b(am i (paid up|caught up)|did i pay everything|paid up on rent|caught up on rent)\b/
      .test(text) ||
    /\bdo i (still )?owe (anything|rent|any(thing)?)\b/.test(text) ||
    /\bdo i have (a |any )?(balance|anything outstanding)\b/.test(text) ||
    /\bis there anything (left )?to pay\b/.test(text)
  const hasHowMuchOwe =
    /\bhow much\b/.test(text) &&
    (hasOwe || hasBalance || /\b(still|more|left)\b/.test(text))
  const hasWhatOwe =
    /\bwhat (do )?i (still )?owe\b/.test(text) ||
    /\bwhat'?s? (my )?(rent )?balance\b/.test(text) ||
    /\bwhat'?s? (my )?amount due\b/.test(text) ||
    /\bwhat'?s? left (on my rent|to pay)\b/.test(text) ||
    /\bhow much (more |do i have )?left\b/.test(text)
  const hasRentAmount =
    /\brent\b/.test(text) &&
    (hasOwe || hasBalance || hasDueAmount || hasPayAmount ||
      /\b(how much|what|check|tell me|send)\b/.test(text))

  if (hasPaidUpAsk) return true
  if (hasHowMuchOwe) return true
  if (hasWhatOwe) return true
  if (hasOwe && (hasBalance || /\brent\b/.test(text) || /\b(this month|anything|still|more)\b/.test(text))) {
    return true
  }
  if (hasBalance) return true
  if (hasDueAmount) return true
  if (hasPayAmount) return true
  if (hasLeftToPay && (hasOwe || hasBalance || /\brent\b/.test(text) || /\bpay\b/.test(text))) {
    return true
  }
  if (hasRentAmount && !/\b(when|increase|raise|late)\b/.test(text)) return true

  // Casual: "yo how much i still owe"
  if (/\bhow much\b/.test(text) && /\b(still |more )?(owe|owing)\b/.test(text)) {
    return true
  }
  // "For rent, how much do I owe?" / any order of rent + owe + amount ask
  if (/\brent\b/.test(text) && hasOwe && /\b(how much|what)\b/.test(text)) {
    return true
  }

  return false
}

/**
 * Classify a tenant SMS for rent-related meaning.
 * Call after STOP/HELP; before maintenance routing.
 */
export function classifyRentSmsIntent(
  body: string,
  options?: { recentTurns?: string | null },
): RentSmsClassification {
  const text = normalizeRentSms(body)
  if (!text) {
    return { kind: null, topic: null, confident: false, needsClarification: false }
  }

  if (isLateRent(text)) {
    return { kind: "rent_late", topic: "late", confident: true, needsClarification: false }
  }
  if (isPaymentStatusAsk(text)) {
    return {
      kind: "rent_balance",
      topic: "payment_status",
      confident: true,
      needsClarification: false,
    }
  }
  if (isPaymentLinkAsk(text)) {
    return {
      kind: "rent_balance",
      topic: "payment_link",
      confident: true,
      needsClarification: false,
    }
  }
  if (isDueDateAsk(text)) {
    return {
      kind: "rent_balance",
      topic: "due_date",
      confident: true,
      needsClarification: false,
    }
  }
  if (isPartialPayment(text)) {
    return {
      kind: "rent_general",
      topic: "partial",
      confident: true,
      needsClarification: false,
    }
  }
  if (isRentIncreaseOrGeneral(text)) {
    return {
      kind: "rent_general",
      topic: "general",
      confident: true,
      needsClarification: false,
    }
  }
  if (isMonthlyRentAsk(text)) {
    return {
      kind: "rent_balance",
      topic: "monthly_rent",
      confident: true,
      needsClarification: false,
    }
  }

  if (isBalanceMeaning(text)) {
    const competing = hasCompetingFinancialContext(options?.recentTurns)
    // Bare "how much do I owe?" with a competing invoice/deposit thread → clarify.
    const bareOwe =
      /^(yo\s+)?(hey\s+)?(can you )?(please )?(tell me |check )?(how much|what) (do )?i owe\??$/.test(
        text,
      ) ||
      /^(how much|what) (do )?i owe\??$/.test(text)
    if (competing && bareOwe && !/\brent\b/.test(text)) {
      return {
        kind: "rent_balance",
        topic: "balance",
        confident: false,
        needsClarification: true,
      }
    }
    return {
      kind: "rent_balance",
      topic: "balance",
      confident: true,
      needsClarification: false,
    }
  }

  return { kind: null, topic: null, confident: false, needsClarification: false }
}

/** True when the message means “what do I currently owe?” (balance topic). */
export function looksLikeRentBalanceAsk(
  body: string,
  options?: { recentTurns?: string | null },
): boolean {
  const result = classifyRentSmsIntent(body, options)
  return result.kind === "rent_balance" && result.topic === "balance" &&
    !result.needsClarification
}

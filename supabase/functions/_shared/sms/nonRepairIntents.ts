/**
 * Non-repair inbound topics: lease, move-out and "when is someone coming?".
 *
 * Leaf module with no SMS imports so the interpreter and the intent recognizer
 * read the same rules instead of keeping two copies.
 */

export type LeaseTopic = "lease_copy" | "lease_end" | "lease_info"

const LEASE_COPY =
  /\b((copy|pdf|scan|picture|photo) of (my |our |the )?lease|lease (copy|agreement|document|pdf|file)|send (me )?(my |a )?(copy of (my )?)?lease|email (me )?(my )?lease|need (my |a )?(copy of (my )?)?lease|rental agreement)\b/i

const LEASE_END =
  /\b(when does (my |our )?lease (end|expire)|lease (end|expir(?:e|ation|y)) date|how long is (my |our )?lease)\b/i

const LEASE_GENERAL =
  /\b((interested in |ask(?:ing)? about )?leas(?:e|ing)|my lease|our lease|the lease|lease (info|information|details|dates|start)|when (did|does) (my |our )?lease start|tenancy( agreement)?)\b/i

const MOVE_OUT =
  /\b(mov(?:e|ing) out|vacat(?:e|ing)|i'?m leaving|change my move-?out)\b/i

/** Lease question the resident is asking about — null when the text isn't about a lease. */
export function classifyLeaseTopic(body: string): LeaseTopic | null {
  const text = body.trim()
  if (!text) return null
  if (LEASE_COPY.test(text)) return "lease_copy"
  if (LEASE_END.test(text)) return "lease_end"
  if (LEASE_GENERAL.test(text) && !/\brenew/i.test(text)) return "lease_info"
  return null
}

/** Renewal asks are their own flow, so they are not a move-out. */
export function looksLikeMoveOutIntent(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  return MOVE_OUT.test(text) && !/\brenew\b/i.test(text)
}

/** True when the resident is asking about a lease at all (copy, end date, general). */
export function looksLikeLeaseTopic(body: string): boolean {
  return classifyLeaseTopic(body) !== null
}

const MAINTENANCE_STATUS =
  /\b((status|update) (on|of|for) (my )?(repair|ticket|work order|request|job)|when is (the |my )?(plumber|electrician|vendor|tech|technician)|has (the )?(vendor|plumber|electrician) (been|come|arrived|shown)|any update on (my )?(repair|ticket|work order)|where is (the )?(vendor|plumber))\b/i

const VENDOR_ARRIVAL_ROLE =
  /\b(electrician|plumber|vendor|tech|technician|handyman|contractor|repair(?:s| ?person)?|work order|appointment|visit)\b/i

const VENDOR_ARRIVAL_WHEN =
  /\b(when(?:'s|\s+is|\s+will|\s+would|\s+can)?|what time|eta)\b/i

const VENDOR_ARRIVAL_EVENT =
  /\b(coming|arriv(?:e|ing)|show(?:ing)?\s+up|be here|get here|scheduled|on (?:their|his|her) way)\b/i

/** True when the resident is asking when a vendor will visit — not reporting a new issue. */
export function looksLikeMaintenanceStatusAsk(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (MAINTENANCE_STATUS.test(text)) return true
  if (/\bwhen (?:the )?(?:electrician|plumber|vendor|tech|technician) is coming\b/i.test(text)) {
    return true
  }
  if (
    VENDOR_ARRIVAL_WHEN.test(text) &&
    VENDOR_ARRIVAL_EVENT.test(text) &&
    (VENDOR_ARRIVAL_ROLE.test(text) || /\b(he|she|they|someone)\b/i.test(text))
  ) {
    return true
  }
  if (
    /\b(any (word|news|update) on (the )?(visit|appointment|vendor|electrician|plumber)|has (the )?(visit|appointment) been (set|scheduled))\b/i
      .test(text)
  ) {
    return true
  }
  return false
}

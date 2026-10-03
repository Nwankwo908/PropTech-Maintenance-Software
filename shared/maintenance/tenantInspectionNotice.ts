/**
 * Tenant-forwarded inspection schedule notices (pure).
 * Distinct from landlord HQS fail-letter extract — no deficiency checklist.
 */

export type TenantInspectionNoticeExtraction = {
  isNotice: boolean
  confidence: number
  inspectionDate: string | null
  /** Raw date tokens found (ISO when parseable). */
  inspectionDates: string[]
  signals: string[]
}

const AUTHORITY_SIGNALS = [
  /\bHABC\b/i,
  /\bHousing\s+Authority\b/i,
  /\bHQS\b/i,
  /\bNSPIRE\b/i,
  /\bSection\s*8\b/i,
  /\binspection\s+(?:notice|letter|appointment|visit)\b/i,
  /\bannual\s+inspection\b/i,
  /\bscheduled\s+(?:an?\s+)?inspection\b/i,
  /\binspection\s+(?:is\s+)?(?:being\s+)?(?:switched|moved|rescheduled|changed)\b/i,
  /\binspection\s+(?:date|on|for)\b/i,
]

const DATE_PATTERNS: RegExp[] = [
  // 10/08/2026 or 10-8-26
  /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g,
  // October 8, 2026 / Oct 8 2026
  /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?))\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi,
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function normalizeMdy(month: number, day: number, yearRaw: number): string | null {
  let year = yearRaw
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (year < 2000 || year > 2100) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export function extractInspectionDatesFromText(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (iso: string | null) => {
    if (!iso || seen.has(iso)) return
    seen.add(iso)
    out.push(iso)
  }

  for (const re of DATE_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[3] && /^\d{2,4}$/.test(m[3]) && /^\d{1,2}$/.test(m[1]!)) {
        // numeric m/d/y
        if (/^\d+$/.test(m[1]!) && /^\d+$/.test(m[2]!)) {
          push(normalizeMdy(Number(m[1]), Number(m[2]), Number(m[3])))
          continue
        }
      }
      const monthName = String(m[1] ?? '').toLowerCase()
      const month = MONTH_INDEX[monthName]
      if (month && m[2] && m[3]) {
        push(normalizeMdy(month, Number(m[2]), Number(m[3])))
      }
    }
  }
  return out
}

/**
 * True when the resident is forwarding / reporting an upcoming housing
 * inspection appointment — not a repair ask by itself.
 */
export function looksLikeTenantInspectionNotice(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  const signals = AUTHORITY_SIGNALS.filter((re) => re.test(t))
  if (signals.length === 0) return false
  // Prefer notices that name a date or explicit schedule language.
  const hasDate = extractInspectionDatesFromText(t).length > 0
  const scheduleVerb =
    /\b(?:scheduled|switched|moved|rescheduled|changed|coming|upcoming)\b/i.test(t)
  if (hasDate) return true
  if (scheduleVerb && /\binspection\b/i.test(t)) return true
  // HABC / Housing Authority + inspection without a repair problem statement
  if (signals.length >= 1 && /\binspection\b/i.test(t) && !hasStrongRepairAsk(t)) {
    return true
  }
  return false
}

/** Repair content strong enough that the message is also a work request. */
export function hasStrongRepairAsk(text: string): boolean {
  return (
    /\b(?:paint|painted|painting|patch|patched|patching|door|ceiling|wall|leak|leaking|broken|fix|repair|outlet|spark|clog|mold|hole)\b/i.test(
      text,
    ) &&
    /\b(?:need|needs|needed|isn'?t|is not|never got|before the inspection|have to|should)\b/i.test(
      text,
    )
  )
}

/**
 * Mentions an upcoming inspection as deadline context for repairs
 * ("before the inspection") without being the notice itself.
 */
export function mentionsUpcomingInspectionDeadline(text: string): boolean {
  return (
    /\bbefore\s+(?:the\s+)?inspection\b/i.test(text) ||
    /\bahead\s+of\s+(?:the\s+)?inspection\b/i.test(text) ||
    /\binspection\s+(?:is\s+)?(?:on|coming|scheduled)\b/i.test(text)
  )
}

export function extractTenantInspectionNotice(
  text: string,
): TenantInspectionNoticeExtraction {
  const t = text.trim()
  const signals = AUTHORITY_SIGNALS.filter((re) => re.test(t)).map((re) =>
    re.source,
  )
  const dates = extractInspectionDatesFromText(t)
  const isNotice = looksLikeTenantInspectionNotice(t)
  let confidence = 0
  if (isNotice) {
    confidence = 0.55
    if (dates.length > 0) confidence += 0.25
    if (/\bHABC\b|\bHousing\s+Authority\b/i.test(t)) confidence += 0.15
    if (/\b(?:switched|rescheduled|moved|scheduled)\b/i.test(t)) confidence += 0.05
  }
  return {
    isNotice,
    confidence: Math.min(1, confidence),
    inspectionDate: dates[0] ?? null,
    inspectionDates: dates,
    signals,
  }
}

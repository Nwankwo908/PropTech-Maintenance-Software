/**
 * HQS / housing-compliance fail-letter classification + extraction (pure).
 * PDF text or vision OCR text both land here — no I/O.
 */

export type HqsLetterType = 'standard_fail' | 'hap_abatement'

export type HqsDeficiencySection = 'emergency' | 'standard'

export type HqsResponsibility = 'owner' | 'tenant' | 'unknown'

export type HqsDeficiencyRow = {
  responsibility: HqsResponsibility
  roomOrArea: string | null
  failItemCategory: string
  notes: string | null
  section: HqsDeficiencySection
}

export type HqsLetterExtraction = {
  isHqsLetter: boolean
  confidence: number
  ownerIdExternal: string | null
  tenantIdExternal: string | null
  inspectionIdExternal: string | null
  letterDate: string | null
  inspectionDates: string[]
  letterType: HqsLetterType
  isAbated: boolean
  reinspectionDate: string | null
  reinspectionFee: number | null
  deficiencies: HqsDeficiencyRow[]
  emergencyItemCount: number
  standardItemCount: number
  rawSignals: string[]
}

const HQS_LETTER_SIGNALS = [
  /\bHQS\b/i,
  /\bHousing\s+Quality\s+Standards?\b/i,
  /\bNSPIRE\b/i,
  /\bfail(?:ed|ure)?\s+items?\b/i,
  /\bre-?inspection\b/i,
  /\bHousing\s+Assistance\s+Payment\b/i,
  /\bHAP\s+abatement\b/i,
  /\bHousing\s+Authority\b/i,
  /\bowner\s+id\b/i,
  /\btenant\s+id\b/i,
  /\binspection\s+id\b/i,
]

const ABATEMENT_SIGNALS = [
  /\bHAP\s+abatement\b/i,
  /\babatement\s+of\s+(?:housing\s+assistance\s+)?payments?\b/i,
  /\bpayment(?:s)?\s+(?:will\s+be\s+|have\s+been\s+)?abat(?:ed|ement)\b/i,
  /\btwo\s+prior\s+fails?\b/i,
  /\bthird\s+fail(?:ure)?\b/i,
  /\bhousing\s+assistance\s+payments?\s+(?:will\s+)?(?:be\s+)?stopp?ed\b/i,
]

function normalizeDateToken(raw: string): string | null {
  const t = raw.trim()
  const mdy = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (mdy) {
    const month = Number(mdy[1])
    const day = Number(mdy[2])
    let year = Number(mdy[3])
    if (year < 100) year += 2000
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const parsed = Date.parse(t)
  if (!Number.isFinite(parsed)) return null
  const d = new Date(parsed)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function pickId(label: RegExp, text: string): string | null {
  const m = text.match(label)
  if (!m?.[1]) return null
  return m[1].trim().replace(/\s+/g, '')
}

function pickFee(text: string): number | null {
  const m = text.match(/re-?inspection\s+fee[^$\d]{0,40}\$?\s*([\d,]+(?:\.\d{2})?)/i)
  if (!m?.[1]) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function pickDatesAfter(label: RegExp, text: string): string[] {
  const out: string[] = []
  const re = new RegExp(
    `${label.source}[^\\d]{0,40}(\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4})`,
    label.flags.includes('i') ? 'gi' : 'g',
  )
  for (const m of text.matchAll(re)) {
    const iso = normalizeDateToken(m[1] ?? '')
    if (iso && !out.includes(iso)) out.push(iso)
  }
  return out
}

function classifyResponsibility(raw: string): HqsResponsibility {
  const t = raw.toLowerCase()
  if (/\bowner\b/.test(t) || /\blandlord\b/.test(t)) return 'owner'
  if (/\btenant\b/.test(t) || /\bresiden/.test(t)) return 'tenant'
  return 'unknown'
}

/**
 * Classify whether free text (PDF extract or vision OCR) is an HQS/compliance fail letter.
 * Does not require a landlord keyword — attachment content alone is enough.
 */
export function classifyHqsInspectionLetter(text: string): {
  isHqsLetter: boolean
  confidence: number
  signals: string[]
} {
  const hay = text.trim()
  if (!hay) return { isHqsLetter: false, confidence: 0, signals: [] }
  const signals: string[] = []
  for (const re of HQS_LETTER_SIGNALS) {
    if (re.test(hay)) signals.push(re.source)
  }
  const score = signals.length / HQS_LETTER_SIGNALS.length
  return {
    isHqsLetter: signals.length >= 2 || (signals.length >= 1 && /\bfail\b/i.test(hay)),
    confidence: Math.min(1, score + (/\bfail\b/i.test(hay) ? 0.15 : 0)),
    signals,
  }
}

function detectAbatement(text: string): boolean {
  return ABATEMENT_SIGNALS.some((re) => re.test(text))
}

/**
 * Split letter body into emergency (24-hr) vs standard (30-day) sections.
 * Emergency section may be entirely absent (Doc 2).
 */
export function splitHqsDeficiencySections(text: string): {
  emergencyBody: string | null
  standardBody: string
  hasEmergencyHeader: boolean
} {
  const emergencyHeader =
    /(?:^|\n)\s*(?:Emergency(?:\s+Items?)?(?:\s*\(24[\s\-]*h(?:ou)?r?s?\))?|24[\s\-]*Hour(?:\s+Emergency)?(?:\s+Items?)?)\s*:?\s*(?:\n|$)/i
  const standardHeader =
    /(?:^|\n)\s*(?:Standard(?:\s+Items?)?(?:\s*\(30[\s\-]*days?\))?|30[\s\-]*Day(?:\s+Items?)?|Non[\s\-]?Emergency(?:\s+Items?)?)\s*:?\s*(?:\n|$)/i

  const em = text.match(emergencyHeader)
  const st = text.match(standardHeader)

  if (!em) {
    return {
      emergencyBody: null,
      standardBody: text,
      hasEmergencyHeader: false,
    }
  }

  const emStart = em.index ?? 0
  const emBodyStart = emStart + em[0].length
  if (!st || (st.index ?? 0) < emStart) {
    // Emergency header then rest of doc (or standard comes first elsewhere)
    const stAfter = text.slice(emBodyStart).match(standardHeader)
    if (stAfter && stAfter.index != null) {
      return {
        emergencyBody: text.slice(emBodyStart, emBodyStart + stAfter.index),
        standardBody: text.slice(emBodyStart + stAfter.index + stAfter[0].length),
        hasEmergencyHeader: true,
      }
    }
    return {
      emergencyBody: text.slice(emBodyStart),
      standardBody: text.slice(0, emStart),
      hasEmergencyHeader: true,
    }
  }

  const stStart = st.index ?? 0
  if (stStart < emStart) {
    return {
      emergencyBody: text.slice(emBodyStart),
      standardBody: text.slice(stStart + st[0].length, emStart),
      hasEmergencyHeader: true,
    }
  }

  return {
    emergencyBody: text.slice(emBodyStart, stStart),
    standardBody: text.slice(stStart + st[0].length),
    hasEmergencyHeader: true,
  }
}

/** Parse deficiency rows from a section body. Tolerates table-ish and bullet layouts. */
export function parseHqsDeficiencyRows(
  sectionBody: string,
  section: HqsDeficiencySection,
): HqsDeficiencyRow[] {
  const lines = sectionBody
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)

  const rows: HqsDeficiencyRow[] = []
  for (const line of lines) {
    if (/^(fail\s*items?|item|category|responsibility|room|area|notes|section)\b/i.test(line)) {
      continue
    }
    if (line.length < 4) continue

    // "Owner | Kitchen | Gas Range/Oven | No pilot light"
    const pipe = line.split('|').map((p) => p.trim()).filter(Boolean)
    if (pipe.length >= 3) {
      const responsibility = classifyResponsibility(pipe[0]!)
      const maybeRoom = pipe.length >= 4 ? pipe[1]! : null
      const category = pipe.length >= 4 ? pipe[2]! : pipe[1]!
      const notes = pipe.length >= 4 ? pipe.slice(3).join(' | ') : pipe.slice(2).join(' | ')
      rows.push({
        responsibility,
        roomOrArea: maybeRoom,
        failItemCategory: category,
        notes: notes || null,
        section,
      })
      continue
    }

    // "Owner — Kitchen — Gas Range/Oven: note"
    const dash = line.split(/\s+[—–\-]\s+/).map((p) => p.trim()).filter(Boolean)
    if (dash.length >= 3 && /\b(owner|tenant|landlord)\b/i.test(dash[0]!)) {
      const responsibility = classifyResponsibility(dash[0]!)
      const roomOrArea = dash[1] ?? null
      const rest = dash.slice(2).join(' — ')
      const [cat, ...noteParts] = rest.split(':').map((p) => p.trim())
      rows.push({
        responsibility,
        roomOrArea,
        failItemCategory: cat || rest,
        notes: noteParts.length ? noteParts.join(': ') : null,
        section,
      })
      continue
    }

    // Bullet: "• Gas Range/Oven (Kitchen) — Owner — note"
    const bullet = line.match(
      /^[•\-\*\d\.\)\s]+(.+?)(?:\s*\(([^)]+)\))?\s*[—–\-]\s*(Owner|Tenant|Landlord)\b(?:\s*[—–\-:\s]+(.+))?$/i,
    )
    if (bullet) {
      rows.push({
        responsibility: classifyResponsibility(bullet[3] ?? ''),
        roomOrArea: bullet[2]?.trim() || null,
        failItemCategory: bullet[1]!.trim(),
        notes: bullet[4]?.trim() || null,
        section,
      })
    }
  }
  return rows
}

export function extractHqsInspectionLetter(text: string): HqsLetterExtraction {
  const classified = classifyHqsInspectionLetter(text)
  const rawSignals = [...classified.signals]
  if (!classified.isHqsLetter) {
    return {
      isHqsLetter: false,
      confidence: classified.confidence,
      ownerIdExternal: null,
      tenantIdExternal: null,
      inspectionIdExternal: null,
      letterDate: null,
      inspectionDates: [],
      letterType: 'standard_fail',
      isAbated: false,
      reinspectionDate: null,
      reinspectionFee: null,
      deficiencies: [],
      emergencyItemCount: 0,
      standardItemCount: 0,
      rawSignals,
    }
  }

  const isAbated = detectAbatement(text)
  if (isAbated) rawSignals.push('abatement')

  const ownerIdExternal =
    pickId(/\bOwner\s*I\.?D\.?\s*[:#]?\s*([A-Za-z0-9\-]+)/i, text) ||
    pickId(/\bOwner\s*#\s*([A-Za-z0-9\-]+)/i, text)
  const tenantIdExternal =
    pickId(/\bTenant\s*I\.?D\.?\s*[:#]?\s*([A-Za-z0-9\-]+)/i, text) ||
    pickId(/\bTenant\s*#\s*([A-Za-z0-9\-]+)/i, text)
  const inspectionIdExternal =
    pickId(/\bInspection\s*I\.?D\.?\s*[:#]?\s*([A-Za-z0-9\-]+)/i, text) ||
    pickId(/\bInspection\s*#\s*([A-Za-z0-9\-]+)/i, text)

  const letterDates = pickDatesAfter(/\bLetter\s+Date\b/i, text)
  const inspectionDates = [
    ...pickDatesAfter(/\bInspection\s+Date(?:s)?\b/i, text),
    ...pickDatesAfter(/\bDate\s+of\s+Inspection\b/i, text),
  ]
  const reinspectionDates = pickDatesAfter(/\bRe-?inspection\s+Date\b/i, text)

  const { emergencyBody, standardBody, hasEmergencyHeader } = splitHqsDeficiencySections(text)
  if (hasEmergencyHeader) rawSignals.push('emergency_section')
  else rawSignals.push('no_emergency_section')

  const deficiencies = [
    ...(emergencyBody ? parseHqsDeficiencyRows(emergencyBody, 'emergency') : []),
    ...parseHqsDeficiencyRows(standardBody, 'standard'),
  ]

  return {
    isHqsLetter: true,
    confidence: classified.confidence,
    ownerIdExternal,
    tenantIdExternal,
    inspectionIdExternal,
    letterDate: letterDates[0] ?? null,
    inspectionDates,
    letterType: isAbated ? 'hap_abatement' : 'standard_fail',
    isAbated,
    reinspectionDate: reinspectionDates[0] ?? null,
    reinspectionFee: pickFee(text),
    deficiencies,
    emergencyItemCount: deficiencies.filter((d) => d.section === 'emergency').length,
    standardItemCount: deficiencies.filter((d) => d.section === 'standard').length,
    rawSignals,
  }
}

/** Owner-responsibility rows only — these become work orders. */
export function ownerResponsibilityDeficiencies(
  extraction: HqsLetterExtraction,
): HqsDeficiencyRow[] {
  return extraction.deficiencies.filter((d) => d.responsibility === 'owner')
}

/**
 * Due date for a deficiency row.
 * Emergency: caller sets habitability urgency separately.
 * Standard: stated reinspection date, else inspection date + 30 days.
 */
export function resolveHqsDeficiencyDueDateIso(
  extraction: HqsLetterExtraction,
  deficiency: HqsDeficiencyRow,
  todayIso?: string,
): string | null {
  if (deficiency.section === 'emergency') {
    // Immediate / habitability — due today + 1 day for board display; urgency carries the SLA.
    const base = todayIso ?? new Date().toISOString().slice(0, 10)
    return addDaysIso(base, 1)
  }
  if (extraction.reinspectionDate) return extraction.reinspectionDate
  const inspection = extraction.inspectionDates[0]
  if (inspection) return addDaysIso(inspection, 30)
  return null
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** Build landlord SMS summary before creating records. */
export function buildHqsLetterConfirmSummarySms(input: {
  extraction: HqsLetterExtraction
  unitLabel: string | null
  propertyLabel?: string | null
}): string {
  const { extraction, unitLabel, propertyLabel } = input
  const typeLine = extraction.isAbated
    ? 'HAP abatement letter (payment abatement)'
    : 'Standard fail letter (re-inspection scheduled or due)'
  const where = [propertyLabel, unitLabel ? `Unit ${unitLabel}` : null].filter(Boolean).join(' · ')
  return [
    'Ulo: inspection letter received',
    '',
    typeLine,
    where ? `Property: ${where}` : 'Property: (unit not confirmed yet)',
    `Emergency items: ${extraction.emergencyItemCount}`,
    `Standard items: ${extraction.standardItemCount}`,
    extraction.isAbated ? 'Abatement: YES — housing assistance payment at risk' : 'Abatement: no',
    extraction.reinspectionDate
      ? `Re-inspection: ${extraction.reinspectionDate}`
      : 'Re-inspection date: not stated (standard items due inspection date + 30 days)',
    '',
    'Reply YES to create the inspection record and work orders for owner items, or NO to cancel.',
  ].join('\n')
}

export function buildHqsUnitAskSms(input: {
  ownerId: string | null
  tenantId: string | null
}): string {
  const bits = [
    input.ownerId ? `owner ${input.ownerId}` : null,
    input.tenantId ? `tenant ${input.tenantId}` : null,
  ].filter(Boolean)
  return [
    'Ulo: inspection letter received',
    '',
    bits.length
      ? `I found ids (${bits.join(', ')}) but I don't have a unit mapped yet.`
      : "I couldn't match this letter to a unit yet.",
    '',
    'Reply with the unit (for example: 646 Bartlett Unit 1) and I will save that mapping.',
  ].join('\n')
}

/**
 * Shared maintenance-request fact extraction + display summary.
 *
 * Separates physical location, equipment, and floor-served so one answer
 * cannot overwrite another. AI polish (edge) must validate against these
 * facts; deterministic fallback never invents unsupported details.
 */
import { generateIssueSummary } from './generateIssueSummary.ts'
import { parseIntakeDescriptionParts } from './intakeDescriptionParse.ts'
import { stripTenantMessageFiller } from './issueNounPhrase.ts'

export type MaintenanceRequestFacts = {
  /** Affected equipment / fixture (e.g. baseboard heater). */
  equipment: string | null
  /** Where the equipment/problem physically is (e.g. Basement). */
  physicalLocation: string | null
  /** Floor/area the equipment serves when distinct from physical location. */
  servesFloor: string | null
  /** Symptom words (leak, no heat, sparking, …). */
  symptoms: string[]
  /**
   * Resident-reported condition / suspected cause, still attributed as
   * reported — never a verified diagnosis.
   */
  reportedCondition: string | null
  /** Cleaned resident-authored text (greetings / Ulo prompts removed). */
  authoredText: string
  /** Short clarification Ulo should ask when facts conflict or a location is missing. */
  needsClarification: string | null
}

export type MaintenanceRequestSummary = {
  title: string
  /** Display location = physical location only. */
  location: string | null
  description: string
  facts: MaintenanceRequestFacts
  source: 'deterministic' | 'llm' | 'fallback'
}

const ULO_PROMPT_RE =
  /^(?:hi\s+\w+|i(?:'ve| have) passed|could you|please (?:add|text|reply|send)|we(?:'ll| will| read your)|sorry for|property (?:manager|management)|i didn'?t quite|reply (?:yes|no|paid|partial)|meet ulo)\b/i

const GREETING_ONLY_RE =
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))[.!,]*$/i

const PHYSICAL_PLACE_RE =
  /\b(?:basement|crawl\s*space|attic|garage|kitchen|bathroom|bedroom|living\s*room|laundry|hallway|yard|utility\s*room|foundation|(?:back|front)\s+porch|porch)\b/i

const LOCATION_PHRASE_RE =
  /\b(?:(?:in|near|by|under|behind|around|at)\s+(?:the\s+)?)?(?:foundation|back\s+porch|front\s+porch|basement|crawl\s*space|kitchen|bathroom|bedroom|attic|garage|yard|utility\s*room)\b/i

const FLOOR_SERVED_RE =
  /\b(?:(?:for|serving|serves|on)\s+(?:the\s+)?)?(?:first|1st|second|2nd|third|3rd|ground|main)\s+floor\b/i

const EQUIPMENT_RE =
  /\b(?:baseboard\s+heat(?:er|ing)?|water\s+heater|furnace|boiler|radiator|toilet|kitchen\s+sink|bathroom\s+sink|sink|faucet|dishwasher|washer|dryer|outlet|ceiling\s+light|light(?:\s*fixture)?|ac|air\s*condition(?:er|ing)?|refrigerator|fridge|freezer|stove|oven)\b/i

const SYMPTOM_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:leak(?:ing)?|drip(?:ping)?)\b/i, 'leak'],
  [/\bno\s*heat\b|\bheat(?:er|ing)?\s+(?:is\s+)?(?:out|off|broken|not\s+working)\b/i, 'no heat'],
  [/\bno\s*hot\s*water\b/i, 'no hot water'],
  [/\bspark(?:ing)?\b/i, 'sparking'],
  [/\bclog(?:ged)?\b|\bbackup\b/i, 'clog'],
  [/\bnot\s+(?:cool(?:ing)?|working)|won'?t\s+turn\s+on\b/i, 'not working'],
]

const GENERIC_TITLE_RE =
  /^(?:a |an )?(?:plumbing|hvac|electrical|appliance|maintenance|pest)(?: leak| issue| request)?$/i

function sentenceCase(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Sentence-case a place or equipment label (Basement, Baseboard heater, First floor). */
function labelCase(place: string): string {
  const t = place.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return t
  return (t.charAt(0).toUpperCase() + t.slice(1)).replace(/\bac\b/g, 'AC')
}

/**
 * Split a collapsed intake blob so Ulo prompts glued onto resident text
 * (newlines already flattened by parseIntakeDescriptionParts) can be dropped.
 */
function splitAuthoredUnits(blob: string): string[] {
  return blob
    .split(
      /\n+|(?<=[.!?])\s+|(?=\b(?:Could you|Please add|I(?:'ve| have) passed|We read your|Sorry for the mix-up|I didn'?t quite)\b)/i,
    )
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Drop Ulo prompts, greetings-only lines, and empty lines from a message corpus. */
export function filterResidentAuthoredLines(raw: string): string[] {
  const parts = parseIntakeDescriptionParts(raw)
  const blobs = [parts.openingMessage, ...parts.tenantUpdates].filter(Boolean)
  const lines: string[] = []
  for (const blob of blobs) {
    for (const line of splitAuthoredUnits(blob)) {
      const trimmed = line.replace(/\s+/g, ' ').trim()
      if (!trimmed) continue
      if (GREETING_ONLY_RE.test(trimmed)) continue
      if (ULO_PROMPT_RE.test(trimmed)) continue
      if (/^\[property manager\]/i.test(trimmed)) continue
      if (/affected area:|entry if not home:|resident availability:|safety concerns:/i.test(trimmed)) {
        continue
      }
      const cleaned = stripTenantMessageFiller(trimmed)
      if (!cleaned || GREETING_ONLY_RE.test(cleaned)) continue
      if (ULO_PROMPT_RE.test(cleaned)) continue
      lines.push(cleaned)
    }
  }
  // Labeled affected area is resident-confirmed place — keep as a fact line.
  const affected = parts.labeledFields['Affected area']?.trim()
  if (affected && !/^(?:n\/?a|unknown|see above)$/i.test(affected)) {
    lines.push(`Affected area: ${affected}`)
  }
  return lines
}

function dedupeKeepOrder(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function extractEquipment(hay: string): string | null {
  const m = hay.match(EQUIPMENT_RE)
  if (!m) return null
  return labelCase(m[0]!.replace(/\s+/g, ' '))
}

function extractPhysicalLocation(lines: string[], hay: string): string | null {
  // Prefer a short standalone "In the basement" / Affected area that is only a place.
  for (const line of [...lines].reverse()) {
    const affected = line.match(/^affected area:\s*(.+)$/i)?.[1]?.trim()
    if (affected) {
      // "Basement — first-floor baseboard heater" → Basement
      const placeOnly = affected.split(/\s*[—\-–]\s*/)[0]?.trim() ?? affected
      const m = placeOnly.match(PHYSICAL_PLACE_RE)
      if (m) return labelCase(m[0]!)
      if (placeOnly.split(/\s+/).length <= 3 && !EQUIPMENT_RE.test(placeOnly)) {
        return labelCase(placeOnly)
      }
    }
    // Standalone location correction: "In the basement"
    const alone = line.match(
      /^(?:(?:it(?:'s| is)|the leak is|located)?\s*)?(?:in|at)\s+(?:the\s+)?([a-z][a-z\s-]{2,30})$/i,
    )
    if (alone?.[1] && PHYSICAL_PLACE_RE.test(alone[1]) && !EQUIPMENT_RE.test(alone[1])) {
      return labelCase(alone[1].replace(/\s+/g, ' '))
    }
    const trailing = line.match(/\bin\s+(?:the\s+)?(basement|attic|garage|crawl\s*space)\s*[.!]?\s*$/i)
    if (trailing?.[1]) return labelCase(trailing[1])
  }
  for (const line of [...lines].reverse()) {
    const phrase = line.match(LOCATION_PHRASE_RE)
    if (phrase?.[0]) {
      return labelCase(
        phrase[0]
          .replace(/^(?:in|near|by|under|behind|around|at)\s+(?:the\s+)?/i, '')
          .trim(),
      )
    }
  }
  const m = hay.match(PHYSICAL_PLACE_RE)
  return m ? labelCase(m[0]!) : null
}

function extractServesFloor(hay: string, physicalLocation: string | null): string | null {
  const m = hay.match(FLOOR_SERVED_RE)
  if (!m) return null
  const floor = m[0]!
    .replace(/^(?:for|serving|serves|on)\s+(?:the\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const labeled = labelCase(floor)
  // Do not treat physical basement as the floor served.
  if (physicalLocation && labeled.toLowerCase() === physicalLocation.toLowerCase()) {
    return null
  }
  return labeled
}

function extractSymptoms(hay: string): string[] {
  const out: string[] = []
  for (const [re, label] of SYMPTOM_PATTERNS) {
    if (re.test(hay)) out.push(label)
  }
  return dedupeKeepOrder(out)
}

function extractReportedCondition(lines: string[]): string | null {
  for (const line of lines) {
    if (/\bvalve\b/i.test(line) && /\brust/i.test(line)) {
      const mayReplace =
        /\bmay need(?:s)?(?:\s+to\s+be)?\s+replac(?:ed|ement)|needs? to be replaced|should be replaced\b/i.test(
          line,
        )
      return mayReplace
        ? 'The valve is heavily rusted and may need replacement'
        : 'The valve is heavily rusted'
    }
    if (/\brust/i.test(line) && /\b(?:pipe|fitting|connector)\b/i.test(line)) {
      return stripTenantMessageFiller(line).replace(/[.!?]+$/g, '')
    }
  }
  return null
}

function detectConflicts(lines: string[]): string | null {
  const places = new Set<string>()
  for (const line of lines) {
    if (/^affected area:/i.test(line)) continue
    // Skip floor-served mentions when scanning for conflicting rooms.
    const withoutFloor = line.replace(FLOOR_SERVED_RE, ' ')
    const matches = withoutFloor.match(
      /\b(?:basement|kitchen|bathroom|bedroom|attic|garage|living\s*room)\b/gi,
    )
    for (const m of matches ?? []) places.add(m.toLowerCase())
  }
  if (places.size >= 2) {
    return 'Which room should we send the technician to?'
  }
  return null
}

/**
 * Extract confirmed resident facts. Never treats Ulo questions as facts.
 */
export function extractMaintenanceRequestFacts(
  rawDescription: string,
  opts?: { category?: string | null },
): MaintenanceRequestFacts {
  const lines = filterResidentAuthoredLines(rawDescription)
  const authoredText = dedupeKeepOrder(lines)
    .map((l) => l.replace(/^affected area:\s*/i, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const hay = authoredText.toLowerCase()

  const equipment = extractEquipment(hay)
  const physicalLocation = extractPhysicalLocation(lines, hay)
  const servesFloor = extractServesFloor(hay, physicalLocation)
  const symptoms = extractSymptoms(hay)
  const reportedCondition = extractReportedCondition(lines)
  let needsClarification = detectConflicts(lines)

  if (!physicalLocation && equipment && !needsClarification) {
    needsClarification = `Where is the ${equipment.toLowerCase()} located?`
  }

  // Category unused today but reserved for trade-specific extractors.
  void opts?.category

  return {
    equipment,
    physicalLocation,
    servesFloor,
    symptoms,
    reportedCondition,
    authoredText,
    needsClarification,
  }
}

function buildTitle(
  facts: MaintenanceRequestFacts,
  category?: string | null,
  rawDescription?: string,
): string {
  if (facts.equipment && facts.symptoms.includes('leak')) {
    return `${facts.equipment} leak`.replace(/\s+/g, ' ')
  }
  if (facts.equipment && facts.symptoms.includes('no heat')) {
    return `No heat — ${facts.equipment}`
  }
  if (facts.equipment && facts.symptoms.length > 0) {
    return sentenceCase(`${facts.equipment} ${facts.symptoms[0]}`)
  }
  // Prefer the original intake blob so Tenant update fragments stay out of the title.
  const fromText = generateIssueSummary(rawDescription || facts.authoredText || facts.equipment || '', {
    format: 'title',
    category: category ?? null,
    maxChars: 50,
  })
  if (fromText && !GENERIC_TITLE_RE.test(fromText)) return fromText
  if (facts.equipment) return facts.equipment
  return 'Maintenance request'
}

/**
 * Deterministic description from confirmed facts — factual fallback when AI
 * is unavailable or fails validation.
 */
export function buildDeterministicDescription(facts: MaintenanceRequestFacts): string {
  const bits: string[] = []
  const equip = facts.equipment?.toLowerCase() ?? null
  const place = facts.physicalLocation?.toLowerCase() ?? null
  const serves = facts.servesFloor?.toLowerCase() ?? null
  const leak = facts.symptoms.includes('leak')

  if (leak && equip && place && serves) {
    bits.push(
      `The tenant reports a leak from the ${place} ${equip} serving the ${serves}.`,
    )
  } else if (leak && equip && place) {
    bits.push(`The tenant reports a leak from the ${equip} in the ${place}.`)
  } else if (leak && equip && serves) {
    bits.push(`The tenant reports a leak from the ${equip} serving the ${serves}.`)
  } else if (leak && equip) {
    bits.push(`The tenant reports a leak from the ${equip}.`)
  } else if (facts.authoredText) {
    bits.push(`The tenant reports: ${facts.authoredText.replace(/[.!?]+$/g, '')}.`)
  } else {
    bits.push('The tenant reported a maintenance issue.')
  }

  if (facts.reportedCondition) {
    const cond = facts.reportedCondition.replace(/[.!?]+$/g, '').trim()
    // Already attributed phrasing for valve case.
    if (/^the valve is/i.test(cond)) {
      bits.push(`${sentenceCase(cond)}.`)
    } else {
      bits.push(`The tenant reports ${cond.charAt(0).toLowerCase()}${cond.slice(1)}.`)
    }
  }

  return bits.join(' ').replace(/\s+/g, ' ').trim()
}

export function summarizeMaintenanceRequestDeterministic(
  rawDescription: string,
  opts?: { category?: string | null },
): MaintenanceRequestSummary {
  const facts = extractMaintenanceRequestFacts(rawDescription, opts)
  const title = buildTitle(facts, opts?.category, rawDescription)
  const description = buildDeterministicDescription(facts)
  return {
    title: GENERIC_TITLE_RE.test(title) ? (facts.equipment ?? 'Maintenance request') : title,
    location: facts.physicalLocation,
    description,
    facts,
    source: 'deterministic',
  }
}

const ALLOWED_CONNECTORS =
  /\b(?:the|tenant|reports?|a|an|from|in|on|at|of|and|or|to|be|is|are|may|need|needs|needed|replacement|replaced|serving|serves|for|with|heavily|entire|valve|leak|leaking)\b/i

/**
 * Validate AI prose against extracted facts. Reject unsupported inventions.
 */
export function validateSummaryAgainstFacts(
  candidate: {
    title?: string | null
    location?: string | null
    description?: string | null
  },
  facts: MaintenanceRequestFacts,
): { ok: true; title: string; location: string | null; description: string } | { ok: false; reason: string } {
  const title = (candidate.title ?? '').replace(/\s+/g, ' ').trim()
  const location = (candidate.location ?? '').replace(/\s+/g, ' ').trim() || null
  const description = (candidate.description ?? '').replace(/\s+/g, ' ').trim()

  if (!title || GENERIC_TITLE_RE.test(title)) {
    return { ok: false, reason: 'generic_or_empty_title' }
  }
  if (!description || description.length < 12) {
    return { ok: false, reason: 'empty_description' }
  }
  if (/\b(?:plumbing|hvac|electrical) issue\b/i.test(description) && !facts.authoredText) {
    return { ok: false, reason: 'generic_description' }
  }

  // Location must be physical place only — not a mashup with floor served.
  if (location && facts.servesFloor) {
    const locLower = location.toLowerCase()
    if (
      locLower.includes(facts.servesFloor.toLowerCase()) &&
      facts.physicalLocation &&
      locLower !== facts.physicalLocation.toLowerCase()
    ) {
      return { ok: false, reason: 'location_mixed_with_serves_floor' }
    }
  }
  if (facts.physicalLocation && location) {
    if (!location.toLowerCase().includes(facts.physicalLocation.toLowerCase().split(/\s+/)[0]!)) {
      return { ok: false, reason: 'location_mismatch' }
    }
  }
  if (facts.physicalLocation && !location) {
    return { ok: false, reason: 'missing_required_location' }
  }

  if (facts.equipment) {
    const equipToken = facts.equipment.toLowerCase().split(/\s+/)[0]!
    if (!title.toLowerCase().includes(equipToken) && !description.toLowerCase().includes(equipToken)) {
      return { ok: false, reason: 'missing_equipment' }
    }
  }

  if (facts.symptoms.includes('leak') && !/\bleak/i.test(description)) {
    return { ok: false, reason: 'missing_symptom' }
  }

  if (facts.reportedCondition && /\bvalve\b/i.test(facts.reportedCondition)) {
    if (!/\bvalve\b/i.test(description)) {
      return { ok: false, reason: 'missing_reported_condition' }
    }
    // Diagnosis language must stay attributed.
    if (
      /\b(?:must be replaced|needs replacement|requires replacement)\b/i.test(description) &&
      !/\b(?:tenant reports?|resident reports?|may need)\b/i.test(description)
    ) {
      return { ok: false, reason: 'unattributed_diagnosis' }
    }
  }

  // Reject brand-new room words not in facts / authored text.
  const known = `${facts.authoredText} ${facts.physicalLocation ?? ''} ${facts.servesFloor ?? ''} ${facts.equipment ?? ''}`.toLowerCase()
  const roomHits = description.match(
    /\b(?:basement|kitchen|bathroom|bedroom|attic|garage|crawl\s*space|living\s*room)\b/gi,
  )
  for (const hit of roomHits ?? []) {
    if (!known.includes(hit.toLowerCase())) {
      return { ok: false, reason: `unsupported_place:${hit}` }
    }
  }

  void ALLOWED_CONNECTORS
  return {
    ok: true,
    title: sentenceCase(title.replace(/\.$/, '')),
    location: location ? labelCase(location) : facts.physicalLocation,
    description: /[.!?]$/.test(description) ? description : `${description}.`,
  }
}

const OPERATIONAL_TAIL_RE =
  /^(?:Entry if not home|Access instructions|Access):/i

/** Keep entry permission / access lines from the prior description. */
export function preserveOperationalDescriptionTail(
  originalDescription: string | null | undefined,
  nextBody: string,
): string {
  const tails = String(originalDescription ?? '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => OPERATIONAL_TAIL_RE.test(l))
  let out = nextBody.trim()
  for (const line of tails) {
    if (!out.toLowerCase().includes(line.toLowerCase())) {
      out = `${out}\n\n${line}`
    }
  }
  return out
}

/**
 * Labeled persistence block so equipment / physical location / serves-floor
 * stay separable after save (one answer cannot overwrite another).
 */
export function formatPersistedDescription(
  summary: MaintenanceRequestSummary,
  originalDescription?: string | null,
): string {
  const lines = [summary.description]
  if (summary.facts.physicalLocation) {
    lines.push(`Affected area: ${summary.facts.physicalLocation}`)
  }
  if (summary.facts.equipment) {
    lines.push(`Equipment: ${summary.facts.equipment}`)
  }
  if (summary.facts.servesFloor) {
    lines.push(`Serves floor: ${summary.facts.servesFloor}`)
  }
  return preserveOperationalDescriptionTail(originalDescription, lines.join('\n'))
}

/** Adapt length for Active Tasks secondary line without changing meaning. */
export function formatSummaryForSurface(
  summary: MaintenanceRequestSummary,
  surface: 'active_tasks' | 'work_order' | 'landlord' | 'vendor',
): { title: string; location: string | null; description: string } {
  const title = summary.title
  const location = summary.location
  if (surface === 'active_tasks') {
    const first = summary.description.split(/(?<=\.)\s+/)[0] ?? summary.description
    return { title, location, description: first }
  }
  if (surface === 'landlord') {
    const short = summary.description.length > 160
      ? `${summary.description.slice(0, 157).replace(/\s+\S*$/, '')}…`
      : summary.description
    return { title, location, description: short }
  }
  return { title, location, description: summary.description }
}

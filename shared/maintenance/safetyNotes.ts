/**
 * Safety notes stay one string so older records still read.
 * Several concerns are separate lines. A resolved concern keeps its text
 * on a "Resolved:" line and is described as stopped, not as a current hazard.
 */

export const RESOLVED_SAFETY_PREFIX = "Resolved: "

export type ParsedSafetyNotes = {
  active: string[]
  resolved: string[]
}

function noteKey(note: string): string {
  return note.trim().toLowerCase()
}

/** Split a stored safety field. A single legacy sentence is one active note. */
export function parseSafetyNotes(value: string | null | undefined): ParsedSafetyNotes {
  const active: string[] = []
  const resolved: string[] = []
  const seenActive = new Set<string>()
  const seenResolved = new Set<string>()
  for (const rawLine of (value ?? "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const marked = line.toLowerCase().startsWith(RESOLVED_SAFETY_PREFIX.toLowerCase())
    const body = (marked ? line.slice(RESOLVED_SAFETY_PREFIX.length) : line).trim()
    if (!body) continue
    const key = noteKey(body)
    if (marked) {
      if (seenActive.has(key) || seenResolved.has(key)) continue
      seenResolved.add(key)
      resolved.push(body)
      continue
    }
    if (seenActive.has(key)) continue
    seenActive.add(key)
    active.push(body)
  }
  return { active, resolved }
}

export function activeSafetyNotes(value: string | null | undefined): string[] {
  return parseSafetyNotes(value).active
}

export function resolvedSafetyNotes(value: string | null | undefined): string[] {
  return parseSafetyNotes(value).resolved
}

const SAFETY_COPY: Record<string, { active: string; resolved: string }> = {
  "Water is actively overflowing or leaking": {
    active: "Water is actively overflowing or leaking.",
    resolved: "Water was overflowing, and that has stopped.",
  },
  "Water is not actively overflowing": {
    active: "Water is not actively overflowing.",
    resolved: "Water was not actively overflowing.",
  },
  "Unable to secure the home": {
    active: "The home cannot be secured.",
    resolved: "The home could not be secured earlier, and that has changed.",
  },
  "Home can be secured": {
    active: "The home can be secured.",
    resolved: "The home could be secured.",
  },
  "Door may be stuck, hanging loose, or at risk of falling": {
    active: "The door may be stuck, hanging loose, or at risk of falling.",
    resolved: "The door was at risk, and that has stopped.",
  },
  "Door is not hanging or at risk of falling": {
    active: "The door is not hanging or at risk of falling.",
    resolved: "The door was not hanging or at risk of falling.",
  },
  "Home is becoming dangerously hot or cold": {
    active: "The temperature in the home feels dangerous.",
    resolved: "The home felt dangerously hot or cold, and that has eased.",
  },
  "Someone in the home may be unwell from the heat": {
    active: "Someone in the home feels unwell.",
    resolved: "Someone felt unwell from the heat, and that has eased.",
  },
  "Sparks, smoke, or burning smell reported": {
    active: "Sparks, smoke, or a burning smell were reported.",
    resolved: "Sparks or a burning smell were reported earlier, and that has stopped.",
  },
  "Sparks reported": {
    active: "Sparks were reported.",
    resolved: "Sparks were reported earlier, and that has stopped.",
  },
  "Smoke reported": {
    active: "Smoke was reported.",
    resolved: "Smoke was reported earlier, and that has stopped.",
  },
  "Burning smell reported": {
    active: "A burning smell was reported.",
    resolved: "A burning smell was reported earlier, and that has stopped.",
  },
  "Water coming through structural damage": {
    active: "Water is coming through the damaged area.",
    resolved: "Water was coming through the damaged area, and that has stopped.",
  },
  "Possible collapse or sagging": {
    active: "There may be sagging or a risk of collapse.",
    resolved: "Sagging or a risk of collapse was reported earlier, and that has stopped.",
  },
  "Appliance leaking water": {
    active: "The appliance is leaking water.",
    resolved: "The appliance was leaking, and that has stopped.",
  },
}

/** Current or stopped wording for a stored note. */
export function safetyConcernSentence(
  note: string,
  status: "active" | "resolved",
): string | null {
  const trimmed = note.trim()
  if (!trimmed || /^none reported$/i.test(trimmed)) return null
  const known = SAFETY_COPY[trimmed]
  if (known) return known[status]
  const base = trimmed.replace(/[.]+$/g, "")
  const sentence = base.charAt(0).toUpperCase() + base.slice(1)
  if (status === "resolved") return `Earlier: ${sentence}. That has stopped.`
  return `${sentence}.`
}

export function formatSafetyNotes(
  active: string[],
  resolved: string[],
): string | undefined {
  const lines = [
    ...active,
    ...resolved.map((note) => `${RESOLVED_SAFETY_PREFIX}${note}`),
  ]
  return lines.length > 0 ? lines.join("\n") : undefined
}

/** Add a concern once. A resolved copy of the same concern becomes active again. */
export function upsertActiveSafetyNote(
  current: string | null | undefined,
  note: string,
): string {
  const trimmed = note.trim()
  const key = noteKey(trimmed)
  const parsed = parseSafetyNotes(current)
  const alreadyActive = parsed.active.some((item) => noteKey(item) === key)
  const wasResolved = parsed.resolved.some((item) => noteKey(item) === key)
  if (alreadyActive && !wasResolved) return (current ?? "").trim()
  const active = [
    ...parsed.active.filter((item) => noteKey(item) !== key),
    trimmed,
  ]
  const resolved = parsed.resolved.filter((item) => noteKey(item) !== key)
  return formatSafetyNotes(active, resolved) ?? trimmed
}

/**
 * Move one active concern onto its history line.
 * Does nothing when that concern was never saved.
 */
export function resolveSafetyNote(
  current: string | null | undefined,
  note: string,
): string | undefined {
  const trimmed = note.trim()
  const key = noteKey(trimmed)
  const parsed = parseSafetyNotes(current)
  if (!parsed.active.some((item) => noteKey(item) === key)) {
    const kept = (current ?? "").trim()
    return kept || undefined
  }
  const active = parsed.active.filter((item) => noteKey(item) !== key)
  const resolved = parsed.resolved.some((item) => noteKey(item) === key)
    ? parsed.resolved
    : [...parsed.resolved, trimmed]
  return formatSafetyNotes(active, resolved)
}

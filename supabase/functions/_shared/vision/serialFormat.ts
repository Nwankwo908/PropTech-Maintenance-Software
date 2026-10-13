/**
 * Serial-number checks for equipment nameplate reads.
 * Uncertain lookalikes and brand shape are flagged before the serial is saved.
 */

export type SerialCharacterFlag = {
  index: number
  char: string
  alternatives: string[]
}

export type SerialReview = {
  serial: string | null
  readable: boolean
  formatOk: boolean
  formatReason: string | null
  uncertainCharacters: SerialCharacterFlag[]
  retake: boolean
  retakePrompt: string | null
  provider: "gemini-3.8-flash" | "claude-sonnet-5-5" | null
  paired: boolean
}

const LOOKALIKES = new Set(["0", "O", "1", "I", "L", "5", "S", "8", "B", "2", "Z"])

const BRAND_RULES: Array<{ brand: RegExp; pattern: RegExp; reason: string }> = [
  {
    brand: /\b(ge|general electric|hotpoint|cafe|monogram)\b/i,
    pattern: /^[A-Z]{1,2}\d{6}[A-Z0-9]{0,6}$/,
    reason: "GE serials usually start with one or two letters and then six digits.",
  },
  {
    brand: /\b(whirlpool|maytag|kitchenaid|amana|jenn-?air)\b/i,
    pattern: /^[A-Z0-9]{10,12}$/,
    reason: "Whirlpool-family serials are usually 10 to 12 letters and numbers.",
  },
  {
    brand: /\b(lg)\b/i,
    pattern: /^[0-9]{3}[A-Z]{2}[A-Z0-9]{5,8}$/,
    reason: "LG serials usually start with three digits and two letters.",
  },
  {
    brand: /\b(samsung)\b/i,
    pattern: /^[A-Z0-9]{10,15}$/,
    reason: "Samsung serials are usually 10 to 15 letters and numbers.",
  },
  {
    brand: /\b(rheem|ruud)\b/i,
    pattern: /^[A-Z]{1,2}\d{6,12}$/,
    reason: "Rheem serials usually start with a letter and then digits.",
  },
]

export function normalizeSerial(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "")
  return cleaned.length > 0 ? cleaned : null
}

export function checkSerialFormat(
  brand: string | null | undefined,
  serial: string | null,
): { ok: boolean; reason: string | null } {
  if (!serial) return { ok: false, reason: "No serial number was readable." }
  if (serial.length < 5 || serial.length > 20) {
    return { ok: false, reason: "Serial numbers are usually 5 to 20 characters." }
  }
  const rule = BRAND_RULES.find((entry) => entry.brand.test(brand ?? ""))
  if (rule && !rule.pattern.test(serial)) {
    return { ok: false, reason: rule.reason }
  }
  if (!/^[A-Z0-9-]+$/.test(serial)) {
    return { ok: false, reason: "Serial numbers use letters, numbers, and hyphens." }
  }
  return { ok: true, reason: null }
}

export function uncertainCharactersFromModel(raw: unknown): SerialCharacterFlag[] {
  if (!Array.isArray(raw)) return []
  const flags: SerialCharacterFlag[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (row.uncertain !== true) continue
    const index = typeof row.index === "number" ? row.index : flags.length
    const char = typeof row.char === "string" ? row.char.slice(0, 1).toUpperCase() : "?"
    const alternatives = Array.isArray(row.alternatives)
      ? row.alternatives.filter((value): value is string => typeof value === "string").map((value) =>
        value.slice(0, 1).toUpperCase()
      )
      : []
    flags.push({ index, char, alternatives })
  }
  return flags
}

export function buildSerialReview(input: {
  brand?: string | null
  serial: string | null
  readable: boolean
  uncertainCharacters: SerialCharacterFlag[]
  provider: SerialReview["provider"]
  paired: boolean
}): SerialReview {
  const serial = normalizeSerial(input.serial)
  const format = checkSerialFormat(input.brand, serial)
  const risky = input.uncertainCharacters.filter(
    (flag) => LOOKALIKES.has(flag.char) || flag.alternatives.length > 0,
  )
  const uncertainCharacters = risky.length > 0 ? risky : input.uncertainCharacters
  let retakePrompt: string | null = null
  if (!input.readable || !serial) {
    retakePrompt = input.paired
      ? "Retake the label close-up. Fill the frame with the serial number and hold the camera steady."
      : "Take two photos: the equipment, then a close-up of the serial label."
  } else if (uncertainCharacters.length > 0) {
    const marks = uncertainCharacters
      .map((flag) => `${flag.char} at position ${flag.index + 1}`)
      .join(", ")
    retakePrompt = `Retake the serial label. These characters were hard to read: ${marks}.`
  } else if (!format.ok) {
    retakePrompt = `${format.reason} Retake a close-up of the serial label.`
  }
  return {
    serial,
    readable: input.readable && Boolean(serial),
    formatOk: Boolean(serial) && format.ok && uncertainCharacters.length === 0,
    formatReason: format.reason,
    uncertainCharacters,
    retake: Boolean(retakePrompt),
    retakePrompt,
    provider: input.provider,
    paired: input.paired,
  }
}

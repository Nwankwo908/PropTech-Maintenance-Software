import type { ApplianceVisionResult } from './types.ts'

export type ManufactureDateParts = {
  year: number | null
  month: number | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function validYear(year: number, now: Date): boolean {
  return Number.isInteger(year) && year >= 1970 && year <= now.getUTCFullYear()
}

function validMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12
}

/** Pull a printed month and year. Several different dates means the label is unclear. */
export function parsePrintedManufactureDate(text: string, now: Date): ManufactureDateParts | 'unclear' | null {
  const source = text.trim()
  if (!source) return null
  const found = new Map<string, ManufactureDateParts>()
  const add = (year: number, month: number) => {
    if (!validYear(year, now) || !validMonth(month)) return
    found.set(`${year}-${month}`, { year, month })
  }
  for (const match of source.matchAll(/\b(0?[1-9]|1[0-2])\s*[/-]\s*((?:19|20)\d{2})\b/g)) {
    add(Number(match[2]), Number(match[1]))
  }
  for (const match of source.matchAll(/\b((?:19|20)\d{2})\s*[/-]\s*(0?[1-9]|1[0-2])\b/g)) {
    add(Number(match[1]), Number(match[2]))
  }
  for (const match of source.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[- ]\s*((?:19|20)\d{2})\b/gi)) {
    add(Number(match[2]), MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1)
  }
  if (found.size > 1) return 'unclear'
  if (found.size === 1) return [...found.values()][0]
  const yearOnly = source.match(
    /\b(?:manufacture(?:d)?|mfg|date of manufacture)[^0-9]{0,40}((?:19|20)\d{2})\b/i,
  )
  if (yearOnly && validYear(Number(yearOnly[1]), now)) {
    return { year: Number(yearOnly[1]), month: null }
  }
  return null
}

function monthName(month: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1]
}

function asOf(now: Date): string {
  return `${monthName(now.getUTCMonth() + 1)} ${now.getUTCDate()}, ${now.getUTCFullYear()}`
}

/** Completed years from a confirmed month and year. The anniversary month stays unknown without a day. */
export function ageYearsFromManufactureDate(
  date: ManufactureDateParts,
  now: Date,
): { value: number | null; confidence: 'low' | 'high'; basis: string } | null {
  if (date.year == null || !validYear(date.year, now)) return null
  if (date.month == null || !validMonth(date.month)) {
    return {
      value: null,
      confidence: 'low',
      basis: `Manufacture year ${date.year} is visible, but the month is not, so age stays unknown.`,
    }
  }
  const years = now.getUTCFullYear() - date.year
  const nowMonth = now.getUTCMonth() + 1
  if (nowMonth === date.month) {
    return {
      value: null,
      confidence: 'low',
      basis: `Manufacture month is ${monthName(date.month)} ${date.year}, but the day is not on the label. Age could be ${years - 1} or ${years} years as of ${asOf(now)}, so it stays unknown.`,
    }
  }
  const value = nowMonth > date.month ? years : years - 1
  return {
    value,
    confidence: 'high',
    basis: `Manufacture date ${monthName(date.month)} ${date.year}. Age is ${value} years as of ${asOf(now)}.`,
  }
}

function printedDateFrom(texts: string[], now: Date): ManufactureDateParts | 'unclear' | null {
  let parsed: ManufactureDateParts | null = null
  for (const text of texts) {
    const next = parsePrintedManufactureDate(text, now)
    if (next === 'unclear') return 'unclear'
    if (!next) continue
    if (parsed && (parsed.year !== next.year || parsed.month !== next.month)) return 'unclear'
    parsed = next
  }
  return parsed
}

function structuredDate(raw: unknown, now: Date): ManufactureDateParts | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const year = typeof input.year === 'number' ? input.year : null
  const month = typeof input.month === 'number' ? input.month : null
  if (year == null && month == null) return null
  if (year != null && !validYear(year, now)) return null
  if (month != null && !validMonth(month)) return null
  return { year, month }
}

/**
 * Replace a model's age arithmetic when a manufacture date was actually read.
 * A serial-only estimate is left alone. An unclear date clears the guessed age.
 */
export function applyEquipmentManufactureAge<T extends ApplianceVisionResult>(
  result: T,
  now = new Date(),
  sourceBasis = '',
): T {
  const fromModel = structuredDate(
    (result as T & { manufactureDate?: unknown }).manufactureDate,
    now,
  )
  const fromText = printedDateFrom([sourceBasis, result.estimatedAge.basis || ''], now)
  if (fromText === 'unclear') {
    return {
      ...result,
      estimatedAge: {
        value: null,
        confidence: 'low',
        basis: 'The manufacture date is unclear, so age stays unknown.',
      },
    }
  }
  if (fromModel && fromText) {
    const yearConflict = fromModel.year != null && fromText.year != null && fromModel.year !== fromText.year
    const monthConflict = fromModel.month != null && fromText.month != null && fromModel.month !== fromText.month
    if (yearConflict || monthConflict) {
      return {
        ...result,
        estimatedAge: {
          value: null,
          confidence: 'low',
          basis: 'The manufacture date is unclear, so age stays unknown.',
        },
      }
    }
  }
  const date = fromText?.month != null
    ? fromText
    : fromModel?.month != null
      ? fromModel
      : fromText ?? (fromModel?.year != null ? fromModel : null)
  if (!date) return result
  const age = ageYearsFromManufactureDate(date, now)
  if (!age) return result
  return { ...result, estimatedAge: age }
}

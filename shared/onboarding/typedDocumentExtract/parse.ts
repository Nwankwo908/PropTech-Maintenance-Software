const PLACEHOLDER =
  /^(n\/a|na|none|null|undefined|unknown|string|number|-|—|–)$/i

export function asTrimmed(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return ''
  return value.trim()
}

export function cleanExtractedName(value: unknown): string | null {
  const text = asTrimmed(value)
  if (!text || PLACEHOLDER.test(text)) return null
  return text
}

export function uniqueNames(values: unknown): string[] {
  const list = Array.isArray(values) ? values : values == null || values === '' ? [] : [values]
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of list) {
    const name = cleanExtractedName(item)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

export function parseIsoDate(value: unknown): string | null {
  const text = asTrimmed(value)
  if (!text || PLACEHOLDER.test(text)) return null
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return text
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (us) {
    const month = Number(us[1])
    const day = Number(us[2])
    let year = Number(us[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = asTrimmed(value)
  if (!text || PLACEHOLDER.test(text)) return null
  const stripped = text.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null
  const amount = Number(stripped)
  return Number.isFinite(amount) ? amount : null
}

/** Coverage limits: 0 is valid (excluded). Never treat 0 as missing. */
export function parseCoverageLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = asTrimmed(value)
  if (!text) return null
  if (/^(excluded|not\s+covered|n\/c|none)$/i.test(text)) return 0
  return parseMoney(value)
}

const KEEP_UPPER_NAME_TOKENS = new Set([
  'ISAOA',
  'ATIMA',
  'FKA',
  'DBA',
  'NMLS',
  'LLC',
  'LLP',
  'LP',
  'NA',
  'PO',
  'N.A.',
])

/** Title-case all-caps names but keep mortgagee clause suffixes (ISAOA ATIMA). */
export function formatInsurancePartyName(value: unknown): string | null {
  const text = cleanExtractedName(value)
  if (!text) return null
  const words = text.split(/\s+/).filter(Boolean)
  const mostlyUpper = words.filter((word) => /[A-Za-z]/.test(word)).every((word) => word === word.toUpperCase())
  if (!mostlyUpper) return text
  return words
    .map((word) => {
      const core = word.replace(/[.,]/g, '')
      const upper = core.toUpperCase()
      if (KEEP_UPPER_NAME_TOKENS.has(upper) || KEEP_UPPER_NAME_TOKENS.has(core.toUpperCase())) {
        return upper === 'PO' ? 'PO' : upper
      }
      if (upper === 'INC' || upper === 'INC.') return word.endsWith('.') ? 'Inc.' : 'Inc'
      if (core.length <= 3 && /^[A-Z0-9]+$/.test(core)) return upper
      return core.charAt(0).toUpperCase() + core.slice(1).toLowerCase()
    })
    .join(' ')
}

export function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(asTrimmed(value))
  if (!Number.isFinite(n)) return 80
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function formatMoney(value: number | null): string {
  if (value == null) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function readField(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in row && row[key] != null && row[key] !== '') return row[key]
  }
  return undefined
}

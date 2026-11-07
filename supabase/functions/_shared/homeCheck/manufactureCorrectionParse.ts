import type { HomeCheckAsset, HomeCheckSystem } from '../../../../shared/homeCheck.ts'

/** Keep this file free of Edge service imports so Node/vitest can unit-test it. */
function phonesMatch(a: string, b: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, '')
  const left = digits(a)
  const right = digits(b)
  if (!left || !right) return false
  return left === right || left.endsWith(right) || right.endsWith(left)
}

function addressedHomeCheckSummary(
  latest: { id?: string; body?: string; raw_payload?: { source?: string }; provider_status?: string; from_number?: string; to_number?: string } | null,
  from: string,
  to: string,
): boolean {
  return !!latest?.id &&
    /^Results:/i.test(latest.body ?? '') &&
    latest.raw_payload?.source === 'home_check' &&
    latest.provider_status !== 'failed' &&
    phonesMatch(latest.from_number ?? '', to) &&
    phonesMatch(latest.to_number ?? '', from)
}

export type HomeCheckManufactureCorrection = {
  system: HomeCheckSystem
  year: number
  month: number | null
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
}

function parseMonthToken(token: string | undefined): number | null {
  if (!token) return null
  const asNum = Number(token)
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 12) return asNum
  return MONTH_NAMES[token.toLowerCase()] ?? null
}

function systemFromPhrase(phrase: string): HomeCheckSystem | null {
  const text = phrase.toLowerCase()
  if (/water\s*heater|wh\b|tank\b/.test(text)) return 'water_heater'
  if (/heating|furnace|boiler|hvac|heater\b/.test(text)) return 'heating'
  return null
}

/**
 * Parse an SMS correction to manufacture year (and optional month) while Results
 * are awaiting OK. Examples: "Age of heating system 2014", "water heater July 2010".
 */
export function parseHomeCheckManufactureCorrection(
  body: string,
  now = new Date(),
): HomeCheckManufactureCorrection | null {
  const text = body.trim().replace(/\s+/g, ' ')
  if (!text || text.length > 160) return null
  const currentYear = now.getUTCFullYear()
  const yearOk = (year: number) => Number.isInteger(year) && year >= 1970 && year <= currentYear

  const patterns: Array<RegExp> = [
    /(?:age\s+(?:of\s+)?(?:the\s+)?)?(?<system>water\s*heater|heating(?:\s+system)?|furnace|boiler|hvac)\s*(?:age|made|year|is|:)?\s*(?:is\s+|was\s+|of\s+|in\s+)?(?:(?<month>[A-Za-z]{3,9}|0?[1-9]|1[0-2])[\s\/\-]+)?(?<year>19\d{2}|20\d{2})\b/i,
    /(?:made|year|age)\s*(?:is\s+|was\s+|of\s+|in\s+)?(?:(?<month>[A-Za-z]{3,9}|0?[1-9]|1[0-2])[\s\/\-]+)?(?<year>19\d{2}|20\d{2})\s*(?:for\s+|on\s+)?(?:the\s+)?(?<system>water\s*heater|heating(?:\s+system)?|furnace|boiler|hvac)\b/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.groups) continue
    const system = systemFromPhrase(match.groups.system ?? '')
    const year = Number(match.groups.year)
    if (!system || !yearOk(year)) continue
    return { system, year, month: parseMonthToken(match.groups.month) }
  }
  return null
}

export function homeCheckManufactureCorrectionHelp(): string {
  return 'Reply OK to confirm these records, or text a manufacture year to update them (for example: Heating system 2014 or Water heater July 2010).'
}

/** Latest outbound is a Home Check Results summary still asking for OK. */
export function isHomeCheckResultsAwaitingOk(
  latest: { id?: string; body?: string; raw_payload?: { source?: string }; provider_status?: string; from_number?: string; to_number?: string } | null,
  from: string,
  to: string,
): boolean {
  if (!addressedHomeCheckSummary(latest, from, to)) return false
  return /Reply OK to confirm/i.test(String(latest?.body ?? ''))
}

export function assetsFromUnitAssetRows(
  rows: Array<{ home_check_system?: string | null; metadata?: Record<string, unknown> | null }>,
): HomeCheckAsset[] {
  const bySystem = new Map<HomeCheckSystem, HomeCheckAsset>()
  for (const row of rows) {
    const system = row.home_check_system === 'water_heater' || row.home_check_system === 'heating'
      ? row.home_check_system
      : null
    const homeCheck = row.metadata?.homeCheck
    if (!system || !homeCheck || typeof homeCheck !== 'object') continue
    bySystem.set(system, homeCheck as HomeCheckAsset)
  }
  return (['water_heater', 'heating'] as const)
    .map((system) => bySystem.get(system))
    .filter((asset): asset is HomeCheckAsset => Boolean(asset))
}

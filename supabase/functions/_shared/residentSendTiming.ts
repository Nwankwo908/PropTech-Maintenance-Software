/**
 * Resident-facing send timing: quiet hours + timezone precedence.
 *
 * Precedence for local clock: resident.timezone > property.timezone > DEFAULT_RESIDENT_TIME_ZONE
 * (never UTC). Quiet hours: resident override hours or DEFAULT_QUIET_HOURS_* (one source).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Inclusive quiet-hours start (local hour). Column default + runtime fallback. */
export const DEFAULT_QUIET_HOURS_START = 21
/** Exclusive quiet-hours end (local hour). Column default + runtime fallback. */
export const DEFAULT_QUIET_HOURS_END = 8

/**
 * Documented default when no resident or property IANA zone resolves.
 * Never use UTC for resident-facing send timing.
 */
export const DEFAULT_RESIDENT_TIME_ZONE = "America/New_York"

export type QuietHoursWindow = {
  startHour: number
  endHour: number
  source: "resident_override" | "default"
}

export type ResidentTimeZoneTier =
  | "resident_timezone"
  | "property_timezone"
  | "default_america_new_york"

export type ResolvedResidentSendTiming = {
  timeZone: string
  timeZoneTier: ResidentTimeZoneTier
  quietHours: QuietHoursWindow
}

export type ResidentQuietHoursRow = {
  quiet_hours_start?: number | null
  quiet_hours_end?: number | null
  timezone?: string | null
}

/** US state / territory → dominant IANA zone (address geocode proxy). */
const US_STATE_TIME_ZONES: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
}

/**
 * States with a single civil timezone (safe to auto-backfill / persist).
 * Multi-zone states stay null so send-time uses the logged default fallback
 * rather than a silent wrong clock.
 */
export const HIGH_CONFIDENCE_US_STATE_TIME_ZONES: ReadonlySet<string> = new Set([
  "AL",
  "AR",
  "AZ",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "GA",
  "HI",
  "IA",
  "IL",
  "LA",
  "MA",
  "MD",
  "ME",
  "MN",
  "MS",
  "MO",
  "MT",
  "NC",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "PA",
  "RI",
  "SC",
  "UT",
  "VA",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
])

/** Multi-zone / ambiguous US states — do not auto-backfill from state alone. */
export const AMBIGUOUS_MULTI_ZONE_US_STATES: ReadonlySet<string> = new Set([
  "AK",
  "FL",
  "ID",
  "IN",
  "KS",
  "KY",
  "MI",
  "ND",
  "NE",
  "OR",
  "SD",
  "TN",
  "TX",
])

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
}

export function normalizeUsStateCode(state: string | null | undefined): string | null {
  const raw = (state ?? "").trim()
  if (!raw) return null
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase()
  return US_STATE_NAME_TO_CODE[raw.toLowerCase()] ?? null
}

/** Infer IANA zone from property address state — high-confidence single-zone only. */
export function inferTimeZoneFromUsState(
  state: string | null | undefined,
): string | null {
  const code = normalizeUsStateCode(state)
  if (!code) return null
  if (!HIGH_CONFIDENCE_US_STATE_TIME_ZONES.has(code)) return null
  return US_STATE_TIME_ZONES[code] ?? null
}

/** Normalize to 5-digit ZIP (drop ZIP+4). */
export function normalizeUsZip5(zip: string | null | undefined): string | null {
  const digits = String(zip ?? "").replace(/\D/g, "")
  if (digits.length < 5) return null
  return digits.slice(0, 5)
}

/**
 * Minority-zone ZIP3 islands inside otherwise-majority multi-zone states.
 * Listed ZIP3 → that zone; any other valid ZIP in the state → majority zone.
 */
const MULTI_ZONE_MINORITY_ZIP3: Record<string, Record<string, string>> = {
  // FL panhandle is Central; rest of FL is Eastern (incl. 33461 Palm Springs).
  FL: { "324": "America/Chicago", "325": "America/Chicago" },
  // OR Malheur (Ontario / Idaho border ~97914) is Mountain; Portland-metro Pacific.
  OR: { "979": "America/Denver" },
  ID: { "838": "America/Los_Angeles" },
  TX: { "798": "America/Denver", "799": "America/Denver" },
  KS: { "677": "America/Denver", "678": "America/Denver", "679": "America/Denver" },
  ND: { "586": "America/Denver", "588": "America/Denver" },
  NE: { "693": "America/Denver" },
  SD: { "577": "America/Denver" },
  TN: {
    "376": "America/New_York",
    "377": "America/New_York",
    "378": "America/New_York",
    "379": "America/New_York",
  },
  KY: { "420": "America/Chicago" },
  MI: { "499": "America/Chicago" },
}

const MULTI_ZONE_MAJORITY_TIME_ZONE: Record<string, string> = {
  FL: "America/New_York",
  OR: "America/Los_Angeles",
  ID: "America/Boise",
  TX: "America/Chicago",
  KS: "America/Chicago",
  ND: "America/Chicago",
  NE: "America/Chicago",
  SD: "America/Chicago",
  TN: "America/Chicago",
  KY: "America/New_York",
  MI: "America/Detroit",
}

export type AddressTimeZoneResolution = {
  timeZone: string | null
  source: "zip_prefix" | "zip_majority" | "state_single_zone" | "none"
  confidence: "high_confidence" | "manual_review" | "missing" | "malformed"
  reason?: string
}

/**
 * Resolve IANA timezone from state + ZIP.
 * ZIP pass first for multi-zone states; only manual_review when ZIP can't disambiguate
 * (no ZIP, or IN/AK-style states without a majority ZIP rule).
 */
export function resolveTimeZoneFromUsStateAndZip(params: {
  state?: string | null
  zip?: string | null
}): AddressTimeZoneResolution {
  const stateCode = normalizeUsStateCode(params.state)
  const zip5 = normalizeUsZip5(params.zip)

  if (!stateCode && !zip5) {
    return {
      timeZone: null,
      source: "none",
      confidence: "missing",
      reason: "missing_state_and_zip",
    }
  }
  if (!stateCode) {
    return {
      timeZone: null,
      source: "none",
      confidence: zip5 ? "manual_review" : "malformed",
      reason: zip5 ? "zip_without_state" : "malformed_state",
    }
  }

  if (AMBIGUOUS_MULTI_ZONE_US_STATES.has(stateCode)) {
    if (!zip5) {
      return {
        timeZone: null,
        source: "none",
        confidence: "manual_review",
        reason: `multi_zone_state_no_zip:${stateCode}`,
      }
    }
    const zip3 = zip5.slice(0, 3)
    const minority = MULTI_ZONE_MINORITY_ZIP3[stateCode]?.[zip3]
    if (minority) {
      return {
        timeZone: minority,
        source: "zip_prefix",
        confidence: "high_confidence",
      }
    }
    const majority = MULTI_ZONE_MAJORITY_TIME_ZONE[stateCode]
    if (majority) {
      return {
        timeZone: majority,
        source: "zip_majority",
        confidence: "high_confidence",
      }
    }
    return {
      timeZone: null,
      source: "none",
      confidence: "manual_review",
      reason: `multi_zone_zip_unresolved:${stateCode}:${zip5}`,
    }
  }

  if (HIGH_CONFIDENCE_US_STATE_TIME_ZONES.has(stateCode)) {
    const tz = US_STATE_TIME_ZONES[stateCode]
    if (tz) {
      return {
        timeZone: tz,
        source: "state_single_zone",
        confidence: "high_confidence",
      }
    }
  }

  return {
    timeZone: null,
    source: "none",
    confidence: "malformed",
    reason: `unknown_state:${stateCode}`,
  }
}

/** High-confidence infer for backfill/persist (state + ZIP). */
export function inferTimeZoneFromUsAddress(params: {
  state?: string | null
  zip?: string | null
}): string | null {
  return resolveTimeZoneFromUsStateAndZip(params).timeZone
}

export type PropertyTimezoneBackfillConfidence =
  | "high_confidence"
  | "manual_review"
  | "missing"
  | "malformed"

/**
 * Classify property timezone backfill confidence (state + optional ZIP).
 * Multi-zone states become high_confidence when ZIP maps unambiguously.
 */
export function classifyPropertyTimezoneBackfillConfidence(
  state: string | null | undefined,
  zip?: string | null,
): PropertyTimezoneBackfillConfidence {
  return resolveTimeZoneFromUsStateAndZip({ state, zip }).confidence
}

export function isValidIanaTimeZone(timeZone: string | null | undefined): boolean {
  const tz = timeZone?.trim()
  if (!tz || tz.toUpperCase() === "UTC" || tz.toUpperCase() === "ETC/UTC") {
    return false
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function resolveQuietHoursWindow(
  resident?: ResidentQuietHoursRow | null,
): QuietHoursWindow {
  const start = resident?.quiet_hours_start
  const end = resident?.quiet_hours_end
  const hasOverride =
    typeof start === "number" &&
    Number.isFinite(start) &&
    typeof end === "number" &&
    Number.isFinite(end) &&
    start >= 0 &&
    start <= 23 &&
    end >= 0 &&
    end <= 23
  if (hasOverride) {
    return {
      startHour: Math.trunc(start as number),
      endHour: Math.trunc(end as number),
      source: "resident_override",
    }
  }
  return {
    startHour: DEFAULT_QUIET_HOURS_START,
    endHour: DEFAULT_QUIET_HOURS_END,
    source: "default",
  }
}

/**
 * Local hour in IANA zone (0–23). Returns null if zone invalid.
 */
export function localHourInTimeZone(nowMs: number, timeZone: string): number | null {
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(new Date(nowMs))
    let hour = Number(hourStr)
    if (hour === 24) hour = 0
    return Number.isFinite(hour) ? hour : null
  } catch {
    return null
  }
}

/**
 * Inclusive start, exclusive end. Supports overnight windows (e.g. 21→8).
 */
export function isWithinQuietHoursWindow(
  nowMs: number,
  timeZone: string,
  startHour: number,
  endHour: number,
): boolean {
  const hour = localHourInTimeZone(nowMs, timeZone)
  if (hour == null) return false
  if (startHour === endHour) return true
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour
  }
  return hour >= startHour || hour < endHour
}

/**
 * Next local instant when quiet hours end for this resident (start of endHour).
 * Used to reschedule deferred reminders without batching all TZs together.
 */
export function nextQuietHoursEndMs(
  nowMs: number,
  timeZone: string,
  endHour: number,
): number {
  const hour = localHourInTimeZone(nowMs, timeZone)
  if (hour == null) {
    return nowMs + 60 * 60 * 1000
  }
  // Walk forward hour-by-hour until local hour === endHour (DST-safe).
  let cursor = nowMs
  for (let i = 0; i < 48; i++) {
    const h = localHourInTimeZone(cursor, timeZone)
    if (h === endHour) {
      // Align to the top of this local hour approximately.
      const minuteStr = new Intl.DateTimeFormat("en-US", {
        timeZone,
        minute: "numeric",
      }).format(new Date(cursor))
      const minute = Number(minuteStr)
      if (Number.isFinite(minute) && minute > 0) {
        cursor -= minute * 60_000
      }
      const secondStr = new Intl.DateTimeFormat("en-US", {
        timeZone,
        second: "numeric",
      }).format(new Date(cursor))
      const second = Number(secondStr)
      if (Number.isFinite(second) && second > 0) {
        cursor -= second * 1000
      }
      return Math.max(cursor, nowMs)
    }
    cursor += 60 * 60 * 1000
  }
  return nowMs + 8 * 60 * 60 * 1000
}

export function logResidentTimeZoneFallback(params: {
  residentId?: string | null
  propertyId?: string | null
  tier: ResidentTimeZoneTier
  timeZone: string
  reason?: string
}): void {
  console.info(
    JSON.stringify({
      event: "resident_send_timezone_resolved",
      resident_id: params.residentId ?? null,
      property_id: params.propertyId ?? null,
      tier: params.tier,
      time_zone: params.timeZone,
      reason: params.reason ?? null,
    }),
  )
}

export function resolveResidentSendTiming(params: {
  resident?: ResidentQuietHoursRow | null
  propertyTimeZone?: string | null
  residentId?: string | null
  propertyId?: string | null
  logFallbacks?: boolean
}): ResolvedResidentSendTiming {
  const quietHours = resolveQuietHoursWindow(params.resident)
  const residentTz = params.resident?.timezone?.trim() || null
  if (residentTz && isValidIanaTimeZone(residentTz)) {
    if (params.logFallbacks !== false) {
      logResidentTimeZoneFallback({
        residentId: params.residentId,
        propertyId: params.propertyId,
        tier: "resident_timezone",
        timeZone: residentTz,
      })
    }
    return {
      timeZone: residentTz,
      timeZoneTier: "resident_timezone",
      quietHours,
    }
  }

  const propertyTz = params.propertyTimeZone?.trim() || null
  if (propertyTz && isValidIanaTimeZone(propertyTz)) {
    if (params.logFallbacks !== false) {
      logResidentTimeZoneFallback({
        residentId: params.residentId,
        propertyId: params.propertyId,
        tier: "property_timezone",
        timeZone: propertyTz,
      })
    }
    return {
      timeZone: propertyTz,
      timeZoneTier: "property_timezone",
      quietHours,
    }
  }

  if (params.logFallbacks !== false) {
    logResidentTimeZoneFallback({
      residentId: params.residentId,
      propertyId: params.propertyId,
      tier: "default_america_new_york",
      timeZone: DEFAULT_RESIDENT_TIME_ZONE,
      reason: "no_resident_or_property_timezone",
    })
  }
  return {
    timeZone: DEFAULT_RESIDENT_TIME_ZONE,
    timeZoneTier: "default_america_new_york",
    quietHours,
  }
}

export async function loadResidentSendTiming(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    building?: string | null
    propertyId?: string | null
    nowMs?: number
  },
): Promise<ResolvedResidentSendTiming & { propertyId: string | null }> {
  const { data: resident } = await supabase
    .from("users")
    .select("quiet_hours_start, quiet_hours_end, timezone, building")
    .eq("id", params.residentId)
    .maybeSingle()

  let propertyId = params.propertyId?.trim() || null
  let propertyTimeZone: string | null = null
  let propertyState: string | null = null
  let propertyZip: string | null = null

  if (propertyId) {
    const { data: prop } = await supabase
      .from("properties")
      .select("id, timezone, state, zip_code")
      .eq("id", propertyId)
      .eq("landlord_id", params.landlordId)
      .maybeSingle()
    if (prop) {
      propertyTimeZone = typeof prop.timezone === "string" ? prop.timezone : null
      propertyState = typeof prop.state === "string" ? prop.state : null
      propertyZip = typeof prop.zip_code === "string" ? prop.zip_code : null
    }
  }

  if (!propertyTimeZone) {
    const building =
      params.building?.trim() ||
      (typeof resident?.building === "string" ? resident.building.trim() : "") ||
      null
    if (building) {
      const { data: prop } = await supabase
        .from("properties")
        .select("id, timezone, state, zip_code")
        .eq("landlord_id", params.landlordId)
        .ilike("name", building)
        .limit(1)
        .maybeSingle()
      if (prop) {
        propertyId = String(prop.id)
        propertyTimeZone = typeof prop.timezone === "string" ? prop.timezone : null
        propertyState = typeof prop.state === "string" ? prop.state : null
        propertyZip = typeof prop.zip_code === "string" ? prop.zip_code : null
      }
    }
  }

  if (!isValidIanaTimeZone(propertyTimeZone)) {
    const inferred = inferTimeZoneFromUsAddress({
      state: propertyState,
      zip: propertyZip,
    })
    if (inferred) {
      propertyTimeZone = inferred
      if (propertyId) {
        await supabase
          .from("properties")
          .update({ timezone: inferred })
          .eq("id", propertyId)
          .is("timezone", null)
          .then(() => {})
          .catch(() => {})
      }
    }
  }

  const timing = resolveResidentSendTiming({
    resident: resident as ResidentQuietHoursRow | null,
    propertyTimeZone,
    residentId: params.residentId,
    propertyId,
  })

  return { ...timing, propertyId }
}

/** Parse "QUIET 10PM-7AM", "QUIET 22-7", "QUIET OFF". */
export function parseQuietHoursSmsCommand(
  body: string,
):
  | { kind: "set"; startHour: number; endHour: number }
  | { kind: "clear" }
  | { kind: "invalid"; reason: string }
  | null {
  const raw = body.trim().replace(/\s+/g, " ")
  if (!raw) return null
  const m = raw.match(/^quiet(?:\s+hours?)?\s+(.+)$/i)
  if (!m) return null
  const rest = m[1]!.trim()
  if (/^(off|reset|default|clear)$/i.test(rest)) {
    return { kind: "clear" }
  }
  const range = rest.match(
    /^(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?$/i,
  )
  if (!range) {
    return {
      kind: "invalid",
      reason: "Use QUIET 10PM-7AM or QUIET OFF.",
    }
  }
  const startHour = clockTokenToHour(range[1]!, range[3] ?? null)
  const endHour = clockTokenToHour(range[4]!, range[6] ?? null)
  if (startHour == null || endHour == null) {
    return { kind: "invalid", reason: "Hours must be between 1–12 with AM/PM or 0–23." }
  }
  if (startHour === endHour) {
    return { kind: "invalid", reason: "Start and end must be different hours." }
  }
  return { kind: "set", startHour, endHour }
}

function clockTokenToHour(hourRaw: string, ampm: string | null): number | null {
  let hour = Number.parseInt(hourRaw, 10)
  if (!Number.isFinite(hour)) return null
  const mer = ampm?.toLowerCase() ?? null
  if (mer) {
    if (hour < 1 || hour > 12) return null
    if (mer === "am") {
      hour = hour === 12 ? 0 : hour
    } else {
      hour = hour === 12 ? 12 : hour + 12
    }
  } else if (hour < 0 || hour > 23) {
    return null
  }
  return hour
}

export function formatQuietHoursConfirmSms(params: {
  startHour: number
  endHour: number
}): string {
  return (
    `Got it — we won't send routine reminders between ${formatHour12(params.startHour)} and ${formatHour12(params.endHour)} your local time.\n\n` +
    `Reply QUIET OFF to restore the default (9 PM–8 AM).`
  )
}

export function formatQuietHoursClearedSms(): string {
  return (
    `Quiet hours reset to the default: no routine reminders between 9 PM and 8 AM your local time.\n\n` +
    `Reply QUIET 10PM-7AM anytime to set your own window.`
  )
}

export function formatQuietHoursInvalidSms(reason: string): string {
  return (
    `${reason}\n\n` +
    `Examples: QUIET 10PM-7AM or QUIET OFF.`
  )
}

function formatHour12(hour24: number): string {
  const h = ((hour24 % 24) + 24) % 24
  const suffix = h < 12 ? "AM" : "PM"
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12} ${suffix}`
}

/**
 * Message classes that bypass resident quiet hours (habitability / emergency).
 * Routine reminders must never use this.
 */
export type ResidentAutomatedBypass =
  | "emergency_habitability"
  | "resident_initiated_reply"
  | null

export function shouldHoldResidentQuietHours(params: {
  nowMs: number
  timeZone: string
  quietHours: QuietHoursWindow
  /** Reminders never bypass. */
  isReminder: boolean
  bypass?: ResidentAutomatedBypass
}): boolean {
  if (!params.isReminder && params.bypass) return false
  return isWithinQuietHoursWindow(
    params.nowMs,
    params.timeZone,
    params.quietHours.startHour,
    params.quietHours.endHour,
  )
}

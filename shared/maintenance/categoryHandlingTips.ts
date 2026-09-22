/**
 * Tenant-facing interim guidance by maintenance category / symptom.
 * Used in SMS intake confirmation, same-day urgency, and post-submit copy.
 * Keep copy plain-language (Ulo writing standard) — no jargon or IDs.
 */
import { matchesWaterOutage } from './deterministicRules.ts'

export type CategoryHandlingTipInput = {
  primaryCategory?: string | null
  issueType?: string | null
  vendorTrade?: string | null
  text?: string | null
  diagnosticFacts?: Record<string, string> | null
  safetyConcerns?: string | null
}

function haystack(input: CategoryHandlingTipInput): string {
  const facts = input.diagnosticFacts
    ? Object.values(input.diagnosticFacts).join(" ")
    : ""
  return [
    input.primaryCategory,
    input.issueType,
    input.vendorTrade,
    input.text,
    input.safetyConcerns,
    facts,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function categoryKey(input: CategoryHandlingTipInput): string {
  const raw = (
    input.primaryCategory ||
    input.issueType ||
    input.vendorTrade ||
    ""
  )
    .toLowerCase()
    .trim()
  if (!raw) {
    const t = haystack(input)
    if (/\b(plumb|leak|clog|toilet|sink|faucet|drain|water)\b/.test(t)) return "plumbing"
    if (/\b(hvac|heat|ac|air condition|furnace|thermostat)\b/.test(t)) return "hvac"
    if (/\b(electr|outlet|breaker|spark|wiring)\b/.test(t)) return "electrical"
    if (/\b(appliance|washer|dryer|fridge|stove|dishwasher|oven)\b/.test(t)) {
      return "appliance"
    }
    if (/\b(pest|roach|rodent|bed\s*bug|ant|mice|mouse)\b/.test(t)) return "pest"
    if (/\b(lock|door|key|secure)\b/.test(t)) return "lock"
    if (/\b(roof|ceiling|crack|sag|wall|structur)\b/.test(t)) return "structural"
    return "general"
  }
  if (raw === "leak" || raw.includes("plumb")) return "plumbing"
  if (raw === "hvac" || raw.includes("hvac") || raw.includes("heat")) return "hvac"
  if (raw.includes("electr")) return "electrical"
  if (raw.includes("appliance")) return "appliance"
  if (raw.includes("pest")) return "pest"
  if (raw.includes("lock")) return "lock"
  if (
    raw.includes("structur") ||
    raw.includes("roof") ||
    raw.includes("carpent") ||
    raw.includes("mason")
  ) {
    return "structural"
  }
  return raw === "general" || raw === "other" ? "general" : raw
}

/** Short category word for SMS (“plumbing”, “HVAC”, “electrical”). */
export function categoryLabelForSms(input: CategoryHandlingTipInput): string {
  switch (categoryKey(input)) {
    case "plumbing":
      return "plumbing"
    case "hvac":
      return "HVAC"
    case "electrical":
      return "electrical"
    case "appliance":
      return "appliance"
    case "pest":
      return "pest"
    case "lock":
      return "lock"
    case "structural":
      return "structural"
    default:
      return "maintenance"
  }
}

/**
 * One SMS-safe tip on what the resident can do safely while waiting.
 * Returns null when we have nothing useful to add.
 */
export function resolveCategoryHandlingTip(
  input: CategoryHandlingTipInput,
): string | null {
  const key = categoryKey(input)
  const text = haystack(input)
  const overflowYes = (value?: string) => /^y(es)?\b/i.test(value?.trim() ?? "")
  const deniedActiveWater =
    /\b(not|no|isn't|isnt|aren't|arent)\s+(?:still\s+)?(?:actively\s+)?(?:overflowing|leaking|flowing)\b/
      .test(text) ||
    /\bwater is not actively overflowing\b/.test(text) ||
    /\bno active leak\b/.test(text)
  const activeWater =
    !deniedActiveWater &&
    (/\b(overflow|overflowing|gushing|pouring|actively (?:leaking|flowing)|standing water|flood)\b/
      .test(text) ||
      overflowYes(input.diagnosticFacts?.plumbing_overflow) ||
      overflowYes(input.diagnosticFacts?.toilet_overflow) ||
      overflowYes(input.diagnosticFacts?.plumbing_active_flow))

  if (key === "plumbing") {
    if (activeWater) {
      return "Until help arrives: if you can safely reach the shutoff valve, turn it off. Keep people and pets away from standing water."
    }
    if (/\b(clog|clogged|backup|won't flush|wont flush)\b/.test(text)) {
      return "Until help arrives: please don't keep flushing or pour drain cleaner — that can make it worse. Stop using that fixture if water is rising."
    }
    // Check the total outage first — "use cold water" is useless with no water.
    if (matchesWaterOutage(text)) {
      return "Until help arrives: keep your faucets turned off so water doesn't run once service comes back. Let us know if your neighbors have water."
    }
    if (/\bno hot water|no heat(?:ed)? water\b/.test(text)) {
      return "Until help arrives: avoid adjusting the water heater yourself. Use cold water only if you need water."
    }
    if (/\bleak\b/.test(text)) {
      return "Until help arrives: if you can safely reach the shutoff near the fixture, turn it off and keep towels down to limit damage."
    }
    return "Until help arrives: avoid using the affected fixture if water keeps coming, and keep the area clear for the vendor."
  }

  if (key === "hvac") {
    if (/\bno heat|not heating|freezing\b/.test(text)) {
      return "Until help arrives: check that the thermostat is set to heat and the filter isn't badly clogged. Use safe space heaters only if you have them — keep them clear of fabric."
    }
    if (/\bno ac|not cooling|no cooling|air condition\b/.test(text)) {
      return "Until help arrives: check that the thermostat is set to cool and the filter isn't badly clogged. Close windows and blinds if it's hot outside."
    }
    return "Until help arrives: check the thermostat setting and air filter. Close windows if outdoor temperatures are extreme."
  }

  if (key === "electrical") {
    if (/\b(spark|burning|smoke|shock)\b/.test(text)) {
      return "Until help arrives: leave that area and don't touch the outlet, panel, or anything wet nearby. We'll get an electrician out as quickly as we can."
    }
    return "Until help arrives: don't touch the outlet, panel, or any wet area near the problem. Flip the breaker off only if you can do so safely."
  }

  if (key === "appliance") {
    return "Until help arrives: unplug the appliance if you can safely reach the cord, and don't keep running it until it's checked."
  }

  if (key === "pest") {
    return "Until help arrives: please don't spray strong chemicals yourself — a technician will treat the area safely. Seal food and wipe crumbs when you can."
  }

  if (key === "lock") {
    return "Until help arrives: if you can't secure the home, stay somewhere safe and reply here so we know. Don't force the lock or latch."
  }

  if (key === "structural") {
    return "Until help arrives: stay clear of the damaged area and don't put weight on anything that looks unstable."
  }

  return "Until help arrives: avoid using the affected area until a vendor can take a look."
}

/** Format tip as its own SMS block (blank line before). */
export function formatCategoryHandlingTipBlock(tip: string | null | undefined): string {
  const cleaned = tip?.trim()
  if (!cleaned) return ""
  return `\n\n${cleaned}`
}

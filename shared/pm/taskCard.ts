export type PmDueTone = 'danger' | 'warning' | 'neutral'
export type PmRecommendationLevel = 'routine' | 'plan' | 'soon' | 'immediate'

export type PmTaskCardInput = {
  title: string
  kind?: string | null
  location?: string | null
  dueAt: string | null
  status?: string | null
  estimatedAgeYears?: number | null
  ageBasis?: string | null
  usefulLifeYears?: number | null
  failureRiskPct?: number | null
  failurePredictionWindow?: string | null
  replacementRecommended?: boolean
  conditionRating?: string | null
  applianceType?: string | null
  registryAssetType?: string | null
}

export type PmTaskCardCopy = {
  eyebrow: string
  title: string
  location: string
  statusLabel: string
  statusDot: 'green' | 'amber' | 'red'
  dueHeadline: string
  dueTone: PmDueTone
  instruction: string
  summary: string
  ageLabel: string
  lifespanLabel: string | null
  conditionLabel: string
  failureRiskLabel: string
  askInstallYear: boolean
  recommendationLevel: PmRecommendationLevel
  recommendationTitle: string
  recommendationBody: string
  why: string
}

/** Treat missing or leftover 0 as unknown — never “installed this year.” */
export function knownAssetAgeYears(age: number | null | undefined): number | null {
  if (age == null || !Number.isFinite(age) || age <= 0) return null
  return age
}

export function persistableAssetAgeYears(ageYears: number | null | undefined): number | null {
  if (ageYears == null || !Number.isFinite(ageYears) || ageYears < 0) return null
  if (ageYears >= 1800 && ageYears <= 2100) {
    const years = new Date().getFullYear() - ageYears
    return knownAssetAgeYears(years)
  }
  return knownAssetAgeYears(ageYears)
}

export function humanPmAssetName(input: {
  title?: string | null
  applianceType?: string | null
  registryAssetType?: string | null
}): string {
  const registry = (input.registryAssetType ?? '').trim().toLowerCase()
  const raw = `${input.applianceType ?? ''} ${input.title ?? ''}`.trim()
  const text = raw.toLowerCase()

  if (registry === 'electrical_panel' || /panel|electrical/.test(text)) {
    return 'Electrical Panel'
  }
  if (registry === 'hvac' || /\bhvac\b|air condition|furnace|heat pump|central ac/.test(text)) {
    return 'HVAC'
  }
  if (registry === 'water_heater' || /water heater|tankless/.test(text)) {
    return 'Water Heater'
  }
  if (registry === 'boiler' || /\bboiler\b/.test(text)) return 'Boiler'
  if (registry === 'roof' || /\broof\b/.test(text)) {
    if (/shingle/.test(text)) return 'Shingle Roof'
    if (/concrete/.test(text)) return 'Concrete Roof'
    return 'Roof'
  }
  if (registry === 'plumbing' || /\bplumb/.test(text)) return 'Plumbing System'
  if (registry === 'appliance' || /fridge|refrigerat|stove|range|washer|dryer|microwave/.test(text)) {
    const cleaned = (input.applianceType ?? input.title ?? 'Appliance')
      .replace(/^inspect\s*\/\s*service\s+/i, '')
      .replace(/\s+inspection$/i, '')
      .trim()
    return cleaned || 'Appliance'
  }

  const stripped = (input.title ?? '')
    .replace(/^inspect\s*\/\s*service\s+/i, '')
    .replace(/^(inspect|service|maintain)\s+/i, '')
    .replace(/\s+(inspection|service)$/i, '')
    .trim()
  return stripped || 'Equipment'
}

export function naturalPmTaskTitle(input: {
  title: string
  kind?: string | null
  applianceType?: string | null
  registryAssetType?: string | null
}): string {
  const asset = humanPmAssetName(input)
  const registry = (input.registryAssetType ?? '').trim().toLowerCase()
  const kind = (input.kind ?? '').trim().toLowerCase()
  const inspect =
    registry === 'electrical_panel' ||
    registry === 'roof' ||
    registry === 'plumbing' ||
    kind === 'inspection' ||
    kind === 'appliance'
  return inspect ? `${asset} Inspection` : `${asset} Service`
}

export function pmTaskInstruction(input: {
  title: string
  applianceType?: string | null
  registryAssetType?: string | null
}): string {
  const asset = humanPmAssetName(input).toLowerCase()
  if (/electrical panel/.test(asset)) {
    return 'Have the main electrical panel inspected and serviced to help catch potential electrical issues early.'
  }
  if (asset === 'hvac') {
    return 'Have the heating and cooling system serviced so small problems are caught before they become emergencies.'
  }
  if (asset === 'water heater') {
    return 'Have the water heater inspected and serviced as part of regular preventive maintenance.'
  }
  if (asset.includes('roof')) {
    return `Have the ${asset.toLowerCase()} inspected to catch wear before it leads to leaks or larger repairs.`
  }
  if (asset === 'plumbing system') {
    return 'Have the plumbing system inspected so leaks and supply or drain issues are caught early.'
  }
  if (asset === 'boiler') {
    return 'Have the boiler professionally serviced on a regular schedule.'
  }
  return `Have the ${asset} inspected and serviced to help catch potential issues early.`
}

export function formatConditionLabel(rating: string | null | undefined): string | null {
  const r = (rating ?? '').trim().toLowerCase()
  if (!r) return null
  if (r === 'good' || r === 'satisfactory') return 'Good'
  if (r === 'fair') return 'Fair'
  if (r === 'poor') return 'Poor'
  if (r === 'unsafe') return 'Unsafe'
  return r.charAt(0).toUpperCase() + r.slice(1)
}

export function failureSignalsFromCondition(input: {
  rating?: string | null
  ageYears: number | null
  lifeYears: number
}): { risk: number | null; window: string; replace: boolean; urgency: string } {
  const rating = (input.rating ?? '').trim().toLowerCase()
  const ageYears = knownAssetAgeYears(input.ageYears)
  const lifeYears = input.lifeYears > 0 ? input.lifeYears : 10
  const ageRatio = ageYears != null ? ageYears / lifeYears : null

  if (rating === 'unsafe') {
    return { risk: 95, window: 'Immediate', replace: true, urgency: 'immediate' }
  }
  if (rating === 'poor') {
    return { risk: 75, window: '3–6 months', replace: true, urgency: 'soon' }
  }
  if (ageYears == null) {
    return { risk: null, window: 'Not enough information', replace: false, urgency: 'monitor' }
  }
  if (rating === 'fair' || (ageRatio != null && ageRatio >= 0.75)) {
    return {
      risk: 45,
      window: '6–18 months',
      replace: ageRatio != null && ageRatio >= 0.85,
      urgency: 'plan',
    }
  }
  return { risk: 15, window: '2–5 years', replace: false, urgency: 'monitor' }
}

export function formatPmDueHeadline(
  dueAt: string | null,
  status?: string | null,
  now: Date = new Date(),
): { headline: string; dateLabel: string | null; relativeLabel: string | null; tone: PmDueTone } {
  if (status === 'completed') {
    return { headline: 'Completed', dateLabel: null, relativeLabel: null, tone: 'neutral' }
  }
  if (!dueAt) {
    return {
      headline: 'Schedule pending',
      dateLabel: null,
      relativeLabel: null,
      tone: 'warning',
    }
  }
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) {
    return {
      headline: 'Schedule pending',
      dateLabel: null,
      relativeLabel: null,
      tone: 'warning',
    }
  }

  const dateLabel = due.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const days = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  let relativeLabel: string
  let tone: PmDueTone = 'neutral'

  if (days < 0) {
    const overdue = Math.abs(days)
    relativeLabel =
      overdue >= 45
        ? `${Math.max(1, Math.round(overdue / 30.4375))} month${
            Math.round(overdue / 30.4375) === 1 ? '' : 's'
          } overdue`
        : `${overdue} day${overdue === 1 ? '' : 's'} overdue`
    tone = 'danger'
  } else if (days === 0) {
    relativeLabel = 'today'
    tone = 'warning'
  } else if (days <= 7) {
    relativeLabel = days === 1 ? 'in 1 day' : `in ${days} days`
    tone = 'warning'
  } else if (days >= 45) {
    const months = Math.max(1, Math.round(days / 30.4375))
    relativeLabel = `in ${months} month${months === 1 ? '' : 's'}`
  } else {
    relativeLabel = `in ${days} days`
  }

  return {
    headline: `Due ${dateLabel} · ${relativeLabel}`,
    dateLabel,
    relativeLabel,
    tone,
  }
}

function recommendationFor(input: PmTaskCardInput, ageYears: number | null): {
  level: PmRecommendationLevel
  statusLabel: string
  title: string
  body: string
  why: string
  statusDot: 'green' | 'amber' | 'red'
} {
  const rating = (input.conditionRating ?? '').trim().toLowerCase()
  if (rating === 'unsafe' || input.failurePredictionWindow === 'Immediate') {
    return {
      level: 'immediate',
      statusLabel: 'Needs attention',
      title: 'Address promptly',
      body: 'This equipment should be checked right away based on the inspection.',
      why: 'The inspection reported an unsafe condition, so this is not routine monitoring.',
      statusDot: 'red',
    }
  }
  if (rating === 'poor' || input.replacementRecommended) {
    return {
      level: 'soon',
      statusLabel: 'Plan replacement',
      title: 'Replacement recommended',
      body: 'Budget to repair or replace this equipment on a near-term timeline.',
      why: 'Condition or remaining life points to replacement rather than routine monitoring.',
      statusDot: 'red',
    }
  }
  const asset = humanPmAssetName(input).toLowerCase()
  if (ageYears == null) {
    return {
      level: 'routine',
      statusLabel: 'Routine maintenance',
      title: 'Routine monitoring',
      body: 'No immediate replacement is recommended based on the available inspection information.',
      why: `The inspection identified the ${asset} for preventive maintenance. Its installation age couldn't be confirmed, so Ulo can't reliably estimate remaining life or failure risk yet.`,
      statusDot: 'green',
    }
  }
  return {
    level: 'routine',
    statusLabel: 'Routine maintenance',
    title: 'Routine monitoring',
    body: 'No immediate replacement is recommended based on the available inspection information.',
    why: `The inspection reported ${
      formatConditionLabel(input.conditionRating)?.toLowerCase() ?? 'no urgent'
    } condition, and the equipment is not near the end of its typical lifespan.`,
    statusDot: 'green',
  }
}

function failureRiskLabel(input: PmTaskCardInput, ageYears: number | null): string {
  if (ageYears == null) return 'Not enough information'
  const window = input.failurePredictionWindow?.trim()
  if (window && /immediate|3–6|6–18|2–5|1–3/i.test(window)) {
    const low = (input.failureRiskPct ?? 100) <= 25
    const mid = (input.failureRiskPct ?? 100) <= 50
    const band = low ? 'Low' : mid ? 'Moderate' : 'Higher'
    return `${band} failure risk · next ${window.replace(/^next\s+/i, '')}`
  }
  if (input.failureRiskPct != null) {
    const low = input.failureRiskPct <= 25
    return `${low ? 'Low' : 'Elevated'} failure risk`
  }
  return 'Not enough information'
}

export function buildPmTaskCardCopy(
  input: PmTaskCardInput,
  now: Date = new Date(),
): PmTaskCardCopy {
  const ageYears = knownAssetAgeYears(input.estimatedAgeYears)
  const title = naturalPmTaskTitle(input)
  const asset = humanPmAssetName(input)
  const due = formatPmDueHeadline(input.dueAt, input.status, now)
  const condition = formatConditionLabel(input.conditionRating)
  const rec = recommendationFor(input, ageYears)
  const instruction = pmTaskInstruction(input)
  const lifespan =
    input.usefulLifeYears != null && input.usefulLifeYears > 0
      ? `~${Math.round(input.usefulLifeYears)} years`
      : null

  const agePhrase =
    ageYears == null
      ? `${asset} age is unknown`
      : `The ${asset.toLowerCase()} is about ${ageYears} year${ageYears === 1 ? '' : 's'} old`
  const conditionPhrase = condition
    ? `Condition was reported as ${condition.toLowerCase()}`
    : 'Condition was not clearly reported'
  const summary = `${agePhrase}. ${conditionPhrase}. Have it inspected as part of normal preventive maintenance.`

  return {
    eyebrow: 'Preventive Maintenance',
    title,
    location: input.location?.trim() || 'Portfolio',
    statusLabel: rec.statusLabel,
    statusDot: rec.statusDot,
    dueHeadline: due.headline,
    dueTone: due.tone,
    instruction,
    summary,
    ageLabel: ageYears == null ? 'Unknown' : `${ageYears} year${ageYears === 1 ? '' : 's'}`,
    lifespanLabel: lifespan,
    conditionLabel: condition ? `${condition} (from inspection)` : 'Not reported',
    failureRiskLabel: failureRiskLabel(input, ageYears),
    askInstallYear: ageYears == null,
    recommendationLevel: rec.level,
    recommendationTitle: rec.title,
    recommendationBody: rec.body,
    why: rec.why,
  }
}

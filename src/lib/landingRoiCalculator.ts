export type LandingRoiMetrics = {
  hoursSavedPerWeek: number
  fasterTurnaroundPct: number
  annualSavings: number
  timeRecoveredPerMonth: number
  residentSatisfactionPct: number
  avgResolutionHours: number
}

/** Scales Figma defaults (50 units → 10h, 65%, $2,250, etc.) for the interactive slider. */
export function computeLandingRoi(units: number): LandingRoiMetrics {
  const u = Math.max(1, Math.min(500, Math.round(units)))
  const hoursSavedPerWeek = Math.round(u * 0.2 * 10) / 10
  const fasterTurnaroundPct = Math.min(85, Math.round(55 + u * 0.2))
  const annualSavings = Math.round(u * 45)
  const timeRecoveredPerMonth = Math.round(u * 2.3)
  const residentSatisfactionPct = Math.min(99, Math.round(80 + u * 0.12))
  const avgResolutionHours = Math.max(2, Math.round((12 - u / 10) * 10) / 10)

  return {
    hoursSavedPerWeek,
    fasterTurnaroundPct,
    annualSavings,
    timeRecoveredPerMonth,
    residentSatisfactionPct,
    avgResolutionHours,
  }
}

export function formatAnnualSavings(amount: number): string {
  if (amount >= 10_000) {
    const thousands = Math.round(amount / 1_000)
    return `$${Math.min(thousands, 99)}K`
  }
  return `$${amount.toLocaleString('en-US')}`
}

export function formatHoursSaved(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

export function formatResolutionHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

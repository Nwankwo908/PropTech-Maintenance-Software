/**
 * Deterministic SLA windows (minutes from ticket creation to due_at).
 * Urgency policy (emergency / 48h / 7-day) is the source of minutes.
 * AI must not set minutes.
 */
import {
  resolveUrgencyPolicy,
  urgencyBandFromSeverity,
  URGENCY_SLA_MINUTES,
  type UrgencyBand,
} from './urgencyPolicy.ts'
import type { EmergencyType } from './classificationTypes.ts'

export const SLA_RULES = {
  plumbing: {
    urgent: URGENCY_SLA_MINUTES.emergencyWater,
    normal: URGENCY_SLA_MINUTES.medium,
    low: URGENCY_SLA_MINUTES.low,
  },
  electrical: {
    urgent: URGENCY_SLA_MINUTES.emergencyLifeSafety,
    normal: URGENCY_SLA_MINUTES.medium,
    low: URGENCY_SLA_MINUTES.low,
  },
  appliance: {
    urgent: URGENCY_SLA_MINUTES.emergencySameDay,
    normal: URGENCY_SLA_MINUTES.medium,
    low: URGENCY_SLA_MINUTES.low,
  },
} as const

export { URGENCY_SLA_MINUTES }

export type SlaMinutesOptions = {
  emergencyType?: EmergencyType | string | null
  urgencyBand?: UrgencyBand | null
  description?: string | null
  outdoorTempF?: number | null
  durationHours?: number | null
}

export function getEstimatedMinutes(
  category?: string,
  severity?: string,
  overrideMinutes?: number | null,
  options?: SlaMinutesOptions,
): number {
  if (overrideMinutes != null && Number.isFinite(overrideMinutes) && overrideMinutes > 0) {
    return Math.round(overrideMinutes)
  }

  if (options?.description?.trim()) {
    return resolveUrgencyPolicy({
      text: options.description,
      emergencyType: (options.emergencyType as EmergencyType | undefined) ?? undefined,
      outdoorTempF: options.outdoorTempF,
      durationHours: options.durationHours,
    }).slaMinutes
  }

  const band = options?.urgencyBand ?? urgencyBandFromSeverity(severity)
  if (band === 'low') return URGENCY_SLA_MINUTES.low
  if (band === 'medium') return URGENCY_SLA_MINUTES.medium

  const emergencyType = String(options?.emergencyType ?? '').toLowerCase()
  const cat = (category || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (
    emergencyType === 'gas' ||
    emergencyType === 'fire' ||
    emergencyType === 'electrical' ||
    cat === 'electrical'
  ) {
    return URGENCY_SLA_MINUTES.emergencyLifeSafety
  }
  if (emergencyType === 'flood' || cat === 'plumbing') {
    return URGENCY_SLA_MINUTES.emergencyWater
  }
  return URGENCY_SLA_MINUTES.emergencySameDay
}

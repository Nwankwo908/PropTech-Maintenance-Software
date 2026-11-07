import { isHeatingSystemResult, type HomeCheckPhotoView } from '../../../../shared/homeCheck.ts'
import type { ApplianceVisionResult } from '../vision/types.ts'

export type SystemEvidence = 'match' | 'indoor_overview' | 'read_overview' | 'mismatch' | 'unverified'

/** Generic HVAC is absence of a specific type, not evidence of different equipment. */
export function homeCheckSystemEvidence(
  reading: Pick<ApplianceVisionResult, 'category' | 'identifiedItem'>,
  water: boolean,
  overview?: HomeCheckPhotoView | null,
): SystemEvidence {
  if (reading.category === 'unknown') return 'unverified'
  if (water) return reading.category === 'water_heater' ? 'match' : 'mismatch'
  if (isHeatingSystemResult(reading)) return 'match'
  if (reading.category !== 'hvac') return 'mismatch'
  if (overview === undefined) return 'read_overview'
  if (!overview || overview.confidence !== 'high' || overview.framing !== 'whole_appliance' || overview.equipment === 'unknown') return 'unverified'
  if (overview.equipment !== 'heating_system') return 'mismatch'
  const type = (reading.identifiedItem?.type ?? '').trim()
  // A specific contrary reading is still unresolved; never silently relabel an AC.
  return /^(?:hvac(?:\s+(?:system|unit))?|equipment|unit|unknown)?$/i.test(type)
    ? 'indoor_overview' : 'unverified'
}

export function applyHomeCheckSystemEvidence(reading: ApplianceVisionResult, evidence: SystemEvidence): ApplianceVisionResult {
  if (evidence === 'match') return reading
  if (evidence === 'indoor_overview') return {
    ...reading,
    identifiedItem: { ...reading.identifiedItem, type: 'indoor heating system' },
    rawConfidenceNotes: [reading.rawConfidenceNotes, 'Indoor heating-system overview verified; the label reader returned a generic HVAC type.'].filter(Boolean).join(' '),
  }
  const mismatch = evidence === 'mismatch'
  return {
    ...reading,
    identifiedItem: { ...reading.identifiedItem, modelNumber: undefined, serialNumber: undefined },
    estimatedAge: { value: null, confidence: 'low', basis: mismatch
      ? 'Photos do not match the selected equipment.' : 'Equipment type is not verified from the overview.' },
    labelReadability: {
      ...reading.labelReadability, status: 'uncertain', modelConfidence: 0, serialConfidence: 0,
      uncertainCharacters: reading.labelReadability?.uncertainCharacters ?? [],
      formatWarnings: reading.labelReadability?.formatWarnings ?? [], retakeRequested: true,
      retakeMessage: mismatch
        ? 'These photos do not match the selected system. Send its whole-equipment photo and data plate.'
        : 'I could not verify the appliance type. Please send a clearer photo of the whole appliance.',
    },
  }
}

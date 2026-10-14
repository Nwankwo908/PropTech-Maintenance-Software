import {
  type EquipmentExtractionTrace,
  guardEquipmentLabel,
  LABEL_RETAKE_MESSAGE,
  needsLabelBackup,
} from '../../../../../shared/vision/equipmentLabel.ts'
import type { ApplianceVisionResult, VisionProvider } from '../types.ts'

/** One primary call and at most one backup. Backup failure preserves the primary
 * evidence/retake; conflicting confident readings never become a guessed ID. */
export function withEquipmentBackup(
  primary: VisionProvider,
  backup: VisionProvider,
  models: { primaryModel?: string; backupModel?: string } = {},
): VisionProvider {
  return {
    name: primary.name,
    async analyzeImage(base64, hint, mime, context) {
      const attempts: EquipmentExtractionTrace['attempts'] = []
      let first: ApplianceVisionResult | null = null
      try {
        first = await primary.analyzeImage(base64, hint, mime, context)
        attempts.push(...(first.extractionTrace?.attempts || []))
        if (!needsLabelBackup(first, context?.purpose)) return first
      } catch {
        attempts.push({
          provider: 'gemini',
          model: models.primaryModel || 'gemini-3.8-flash',
          outcome: 'request_failed',
        })
      }
      const reason = first
        ? 'label_unreadable_ambiguous_or_format_failed'
        : 'primary_request_failed'
      try {
        let second = await backup.analyzeImage(base64, hint, mime, context)
        attempts.push(...(second.extractionTrace?.attempts || []))
        const conflictingFields = (['modelNumber', 'serialNumber'] as const).filter((field) =>
          first?.identifiedItem[field] && second.identifiedItem[field] &&
          first.identifiedItem[field] !== second.identifiedItem[field]
        )
        if (conflictingFields.length && second.labelReadability) {
          second = {
            ...second,
            identifiedItem: { ...second.identifiedItem },
            labelReadability: {
              ...second.labelReadability,
              status: 'uncertain',
              readings: { ...second.labelReadability.readings },
              uncertainCharacters: [...second.labelReadability.uncertainCharacters],
              retakeRequested: true,
              retakeMessage: LABEL_RETAKE_MESSAGE,
            },
          }
          for (const field of conflictingFields) {
            const original = first!.identifiedItem[field]!
            const alternate = second.identifiedItem[field]!
            second.labelReadability!.readings![field] = `${original} / ${alternate}`
            if (original.length === alternate.length) {
              for (let index = 0; index < original.length; index++) {
                if (original[index] !== alternate[index]) {
                  second.labelReadability!.uncertainCharacters.push({
                    field,
                    index,
                    alternatives: [original[index], alternate[index]],
                  })
                }
              }
            }
            delete second.identifiedItem[field]
            if (field === 'serialNumber') {
              second.estimatedAge = {
                value: null,
                confidence: 'low',
                basis: 'Readers disagree on the serial; manufacture date remains unknown.',
              }
            }
          }
        }
        const score = (value: ApplianceVisionResult) =>
          Number(!!value.identifiedItem.modelNumber) + Number(!!value.identifiedItem.serialNumber)
        if (
          !conflictingFields.length && first && needsLabelBackup(second, context?.purpose) &&
          score(first) > score(second)
        ) second = first
        return {
          ...guardEquipmentLabel(second),
          extractionTrace: {
            selectedProvider: second.extractionTrace?.selectedProvider || 'claude',
            selectedModel: second.extractionTrace?.selectedModel || 'claude-sonnet-5-5',
            attempts,
            fallbackReason: reason,
          },
        }
      } catch {
        if (!first) {
          throw new Error(
            'Equipment photo reading is unavailable. Check the Gemini and Claude provider configuration, then retry.',
          )
        }
        attempts.push({
          provider: 'claude',
          model: models.backupModel || 'claude-sonnet-5-5',
          outcome: 'request_failed',
        })
        return {
          ...first,
          extractionTrace: {
            selectedProvider: 'gemini',
            selectedModel: first.extractionTrace?.selectedModel || 'gemini-3.8-flash',
            attempts,
            fallbackReason: reason,
          },
        }
      }
    },
  }
}

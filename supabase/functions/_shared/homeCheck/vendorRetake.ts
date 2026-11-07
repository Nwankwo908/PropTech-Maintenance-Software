import { HOME_CHECK_PHOTOS, type HomeCheckSlot } from '../../../../shared/homeCheck.ts'
import type { BatchPhotoDiagnostic } from './photoDiagnostics.ts'
/** Keep only three unambiguous unique matches; never break ties or infer a
 * rejected view from upload order. Provider/download failures are not retakes. */
export function vendorPhotoRetake(paths: string[], events: BatchPhotoDiagnostic[]): { keepPaths: string[]; slot: HomeCheckSlot } | null {
  if (paths.length !== 4 || new Set(paths).size !== 4) return null
  if (events.some(e => (e.stage === 'reader' && e.outcome !== 'success') || e.stage === 'download' && e.outcome !== 'success')) return null
  const placements = events.filter(e => e.stage === 'placement')
  if (placements.length !== 4 || new Set(placements.map(e => e.photoIndex)).size !== 4 || placements.some(e => e.photoIndex == null || e.photoIndex < 0 || e.photoIndex > 3)) return null
  const good = placements.filter(e => e.outcome === 'success' && e.slot && e.view?.confidence === 'high')
  const bad = placements.filter(e => !e.slot && ['not_equipment', 'uncertain_view'].includes(e.outcome))
  if (good.length !== 3 || bad.length !== 1 || new Set(good.map(e => e.slot)).size !== 3) return null
  const missing = HOME_CHECK_PHOTOS.filter(p => !good.some(e => e.slot === p.slot))
  return missing.length === 1 ? { keepPaths: good.map(e => paths[e.photoIndex!]), slot: missing[0].slot } : null
}
export function vendorRetakeReply(slot: HomeCheckSlot) {
  const name = { water_heater_label: 'water-heater label', water_heater_whole: 'whole water heater, including the base', heating_label: 'heating-system label on the furnace or boiler', heating_whole: 'whole heating system' }[slot]
  return `I kept the other three photos, but couldn’t match the ${name}. Please send just one clear photo of the ${name}. No caption or code needed.`
}

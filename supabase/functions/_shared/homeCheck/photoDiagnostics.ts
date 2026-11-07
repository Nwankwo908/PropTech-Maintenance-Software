import type { HomeCheckSlot, HomeCheckPhotoView } from '../../../../shared/homeCheck.ts'
export type PhotoReadDiagnostic = {
  outcome: 'success' | 'timeout' | 'provider_error' | 'missing_photo_view' | 'invalid_response' | 'uncertain_view' | 'not_configured'
  durationMs: number
  phase?: 'attempt' | 'complete'
  status?: number | null
  provider: 'gemini' | 'openai' | null
}
export type BatchPhotoDiagnostic = {
  stage: 'download' | 'attempt' | 'reader' | 'placement' | 'batch'
  outcome: 'success' | 'timeout' | 'provider_error' | 'missing_photo_view' | 'invalid_response' | 'uncertain_view' | 'not_configured' | 'download_error' |
    'invalid_response' | 'not_configured' | 'processing_error' | 'reader_unavailable' | 'uncertain_view' | 'not_equipment' | 'duplicate_views' | 'invalid_batch'
  durationMs: number
  photoIndex?: number
  slot?: HomeCheckSlot | null
  view?: HomeCheckPhotoView | null
  provider?: 'gemini' | 'openai' | null
  status?: number | null
}
export type DiagnosticSink<T> = (event: T) => void
/** Diagnostics are optional and cannot affect photo classification or attachment. */
export function emitDiagnostic<T>(sink: DiagnosticSink<T> | undefined, event: T) {
  try { sink?.(event) } catch { /* Observability must not fail the workflow. */ }
}
export const diagnosticDuration = (started: number) => Math.max(0, Math.round(performance.now() - started))

/** Availability failures must not be described as unclear user photos. */
export function photoBatchFailureReply(events:BatchPhotoDiagnostic[]) {
  const readers=events.filter(e=>e.stage==='reader')
  const suffix='Your four photos are kept; no equipment records were saved. Please do not resend them yet.'
  if(readers.some(e=>e.outcome==='timeout'))return `The AI photo reader timed out. ${suffix}`
  if(readers.some(e=>['provider_error','invalid_response','not_configured'].includes(e.outcome)))return `The AI photo reader could not finish. ${suffix}`
  if(events.some(e=>e.stage==='download'&&e.outcome==='download_error'))return `I could not open all four photos. ${suffix}`
  const placements=events.filter(e=>e.stage==='placement')
  if(placements.length===4 && new Set(placements.map(e=>e.photoIndex)).size===4 && placements.every(e=>Number.isInteger(e.photoIndex)&&e.photoIndex!>=0&&e.photoIndex!<4)) {
    const found=placements.filter(e=>e.outcome==='success' && e.slot && e.view?.confidence==='high')
    const slots=new Set(found.map(e=>e.slot))
    const names:Record<HomeCheckSlot,string>={water_heater_label:'Water-heater model/serial label',water_heater_whole:'Whole water heater, including the base',heating_label:'Heating-system model/serial label',heating_whole:'Whole heating system'}
    const missing=(Object.keys(names) as HomeCheckSlot[]).filter(slot=>!slots.has(slot))
    if(missing.length) return [
      'I couldn’t identify these required views:',
      ...missing.map((slot,i)=>`${i+1}) ${names[slot]}`),
      found.length>slots.size?'Some views appear more than once. Use a label and full view of each appliance.':'',
      'Your four photos are kept; no equipment records were saved. Please don’t retry this same set unchanged.',
    ].filter(Boolean).join('\n')
  }
  return 'I received all four photos, but could not match every view confidently. No equipment records were saved. Please do not resend them yet.'
}

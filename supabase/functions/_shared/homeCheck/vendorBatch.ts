import { diagnosticDuration, emitDiagnostic, type BatchPhotoDiagnostic, type DiagnosticSink } from './photoDiagnostics.ts'
import { HOME_CHECK_PHOTOS, homeCheckSlotFromReading, readHomeCheckPhotoView, type HomeCheckSlot } from '../../../../shared/homeCheck.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'

/** Classify the entire batch before attaching anything; attachment order is not evidence. */
export async function identifyVendorHomeCheckBatch(
  paths: string[],
  read: (path: string) => Promise<{ bytes: Uint8Array; contentType: string }>,
  identify = readHomeCheckPhoto,
  observe?: DiagnosticSink<BatchPhotoDiagnostic>,
): Promise<Array<{ path: string; slot: HomeCheckSlot; bytes: Uint8Array; contentType: string }> | null> {
  const started = performance.now()
  const emit = (event: BatchPhotoDiagnostic) => emitDiagnostic(observe, event)
  if (paths.length !== 4 || new Set(paths).size !== 4) {
    emit({stage:'batch',outcome:'invalid_batch',durationMs:diagnosticDuration(started)})
    return null
  }
  const settled = await Promise.allSettled(paths.map(async (path, photoIndex) => {
    const downloadStarted = performance.now()
    let file: Awaited<ReturnType<typeof read>>
    try {
      file = await read(path)
      emit({stage:'download',photoIndex,outcome:'success',durationMs:diagnosticDuration(downloadStarted)})
    } catch (error) {
      emit({stage:'download',photoIndex,outcome:'download_error',durationMs:diagnosticDuration(downloadStarted)})
      throw error
    }
    const identifyStarted = performance.now()
    let result: Awaited<ReturnType<typeof identify>>
    try {
      result = await identify(file.bytes, file.contentType, event => {
        emit({stage:event.phase==='attempt'?'attempt':'reader',photoIndex,outcome:event.outcome,durationMs:event.durationMs,provider:event.provider,...(event.status!==undefined?{status:event.status}:{})})
      })
    } catch (error) {
      emit({stage:'reader',photoIndex,outcome:'provider_error',durationMs:diagnosticDuration(identifyStarted)})
      throw error
    }
    const placementStarted = performance.now()
    const parsedView = readHomeCheckPhotoView(result?.photoView)
    const view = parsedView ? { equipment: parsedView.equipment, framing: parsedView.framing, confidence: parsedView.confidence } : null
    const legacy = result as { labelReadability?: {status?:string}; identifiedItem?: {modelNumber?:string;serialNumber?:string} } | null
    const status = legacy?.labelReadability?.status
    const label = status === 'readable' || status === 'uncertain' || Boolean(
      legacy?.identifiedItem?.modelNumber || legacy?.identifiedItem?.serialNumber)
    if (!result?.photoView && !label && status !== 'not_visible') {
      emit({stage:'placement',photoIndex,outcome:'reader_unavailable',slot:null,view,durationMs:diagnosticDuration(placementStarted)})
      return null
    }
    const placed = homeCheckSlotFromReading(result, [])
    emit({stage:'placement',photoIndex,slot:placed.slot,view,
      outcome:placed.slot ? 'success' : placed.reason === 'not_equipment' ? 'not_equipment' : 'uncertain_view',
      durationMs:diagnosticDuration(placementStarted)})
    return placed.slot ? { path, slot: placed.slot, ...file } : null
  }))
  const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
  if (failed) {
    emit({stage:'batch',outcome:'processing_error',durationMs:diagnosticDuration(started)})
    throw failed.reason
  }
  const photos = settled.map(entry => entry.status === 'fulfilled' ? entry.value : null)
  if (photos.some(photo => !photo)) {
    emit({stage:'batch',outcome:'uncertain_view',durationMs:diagnosticDuration(started)})
    return null
  }
  const identified = photos as NonNullable<(typeof photos)[number]>[]
  if (new Set(identified.map(photo => photo.slot)).size !== 4) {
    emit({stage:'batch',outcome:'duplicate_views',durationMs:diagnosticDuration(started)})
    return null
  }
  emit({stage:'batch',outcome:'success',durationMs:diagnosticDuration(started)})
  return HOME_CHECK_PHOTOS.map(({ slot }) => identified.find(photo => photo.slot === slot)!)
}

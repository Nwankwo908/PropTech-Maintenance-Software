import type { HomeCheckPhotoView } from '../../../../shared/homeCheck.ts'
import { withDeadline } from '../ai/deadline.ts'
import { inspectionBytesToBase64 } from '../vision/ingestInspectionUpload.ts'
import { readPhotoView, PHOTO_VIEW_TOTAL_MS } from './photoViewReader.ts'
import { diagnosticDuration, emitDiagnostic, type DiagnosticSink, type PhotoReadDiagnostic } from './photoDiagnostics.ts'
export type PhotoSlotReading = {photoView:HomeCheckPhotoView;category:'water_heater'|'hvac'|'other'|'unknown'}

/** Bounded framing-only routing; complete equipment extraction happens after attachment. */
export async function readHomeCheckPhoto(bytes:Uint8Array,contentType:string,observe?:DiagnosticSink<PhotoReadDiagnostic>):Promise<PhotoSlotReading|null> {
  const started=performance.now()
  let outcome:PhotoReadDiagnostic['outcome']='provider_error'
  let provider:PhotoReadDiagnostic['provider']=null
  try {
    const result=await withDeadline(PHOTO_VIEW_TOTAL_MS,signal=>readPhotoView(inspectionBytesToBase64(bytes),contentType,event=>emitDiagnostic(observe,event),signal))
    outcome=result.outcome;provider=result.provider
    if(!result.view)return null
    return {photoView:result.view,category:result.view.equipment==='heating_system'?'hvac':result.view.equipment}
  }catch(error){
    outcome=error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'timeout':'provider_error'
    return null
  }finally{
    emitDiagnostic(observe,{phase:'complete',outcome,durationMs:diagnosticDuration(started),provider})
  }
}

import { homeCheckSystemEvidence, applyHomeCheckSystemEvidence } from './systemEvidence.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { type HomeCheckSlot } from '../../../../shared/homeCheck.ts'
import type { ApplianceVisionResult } from '../vision/types.ts'
import { analyzeInspectionPhotoRow } from '../vision/analyzeInspectionPhoto.ts'
import { withDeadline } from '../ai/deadline.ts'
import { inspectionBytesToBase64 } from '../vision/ingestInspectionUpload.ts'

/** Never promote disagreement between the main reading and serial OCR to a fact. */
export function reconcileHomeCheckSerialReading(result: ApplianceVisionResult): ApplianceVisionResult {
  const first = result.labelReadability?.readings?.serialNumber?.replace(/\s/g, '').toUpperCase()
  const second = result.identifiedItem?.serialNumber?.replace(/\s/g, '').toUpperCase()
  if (!first || !second || first === second) return result
  const identifiedItem = { ...result.identifiedItem }
  delete identifiedItem.serialNumber
  return {
    ...result, identifiedItem,
    estimatedAge: /serial/i.test(result.estimatedAge?.basis || '')
      ? { value: null, confidence: 'low', basis: 'Serial readings disagree; age cannot be verified from the serial.' }
      : result.estimatedAge,
    labelReadability: {
      ...result.labelReadability!, status: 'uncertain', serialConfidence: 0,
      readings: { ...result.labelReadability?.readings, serialNumber: `${first} / ${second}` },
      retakeRequested: true, retakeMessage: 'The serial number readings disagree. Please review the label before confirming this number.',
      formatWarnings: [...(result.labelReadability?.formatWarnings ?? []), 'Serial readings disagree; serial remains unknown.'],
    },
  }
}

/** A pair is identified by check + named system slots, never by upload recency. */
export async function analyzeHomeCheckEquipmentPair(
  db: SupabaseClient,
  checkId: string,
  slot: HomeCheckSlot,
  analyze = analyzeInspectionPhotoRow,
  recovery?: { token: string; labelId: string; wholeId: string },
): Promise<ApplianceVisionResult | null> {
  const water = slot.startsWith('water_heater')
  const labelSlot = water ? 'water_heater_label' : 'heating_label'
  const wholeSlot = water ? 'water_heater_whole' : 'heating_whole'
  const { data: pair, error } = await db.from('home_check_photos').select(
    'slot, inspection_photo_id, storage_path',
  ).eq('check_id', checkId).in('slot', [labelSlot, wholeSlot])
  if (error) throw new Error(error.message)
  const label = pair?.find((photo) => photo.slot === labelSlot)
  const whole = pair?.find((photo) => photo.slot === wholeSlot)
  if (!label || !whole) return null
  const ids = [label.inspection_photo_id, whole.inspection_photo_id]
  if (recovery && (recovery.labelId!==ids[0] || recovery.wholeId!==ids[1])) return null
  const started = recovery ? {data:{ok:true,token:recovery.token},error:null} : await db.rpc('home_check_pair_work',{p_action:'begin',p_check:checkId,p_label:ids[0],p_whole:ids[1]})
  if (started.error) throw new Error('Could not reserve photo processing')
  if (!started.data?.ok) return null
  const token=started.data.token
  try {
    const [labelDownload, wholeDownload] = await Promise.all([
      db.storage.from('inspection-uploads').download(label.storage_path),
      db.storage.from('inspection-uploads').download(whole.storage_path),
    ])
    if (labelDownload.error || wholeDownload.error || !labelDownload.data || !wholeDownload.data) {
      throw new Error('Could not read the equipment photo pair.')
    }
    const result = await withDeadline(120000, async () => analyze(
      db,
      label.inspection_photo_id,
      inspectionBytesToBase64(new Uint8Array(await labelDownload.data.arrayBuffer())),
      labelDownload.data.type,
      water ? 'water_heater' : 'hvac',
      'photo',
      label.storage_path,
      null,
      {
        purpose: 'label',
        referenceImages: [{
          purpose: 'overview',
          imageBase64: inspectionBytesToBase64(
            new Uint8Array(await wholeDownload.data.arrayBuffer()),
          ),
          mediaType: wholeDownload.data.type,
        }],
      },
      { persist: false },
    ))
    if (result.status==='error' || !result.ai_result) throw new Error('Temporary analysis failure')
    const rawReading = result.ai_result as ApplianceVisionResult | null
    let reading = rawReading ? reconcileHomeCheckSerialReading(rawReading) : null
    if (reading) {
      let evidence=homeCheckSystemEvidence(reading,water)
      if(evidence==='read_overview'){
        const view=await readHomeCheckPhoto(new Uint8Array(await wholeDownload.data.arrayBuffer()),wholeDownload.data.type)
        if(!view)throw new Error('Overview reader temporarily unavailable')
        evidence=homeCheckSystemEvidence(reading,water,view.photoView)
      }
      reading=applyHomeCheckSystemEvidence(reading,evidence)
    }
    result.ai_result=reading
    const { data: current, error: scopeError } = await db.from('home_check_photos').select(
      'inspection_photo_id',
    ).eq('check_id', checkId).in('slot', [labelSlot, wholeSlot])
    if (scopeError) throw new Error(scopeError.message)
    if (
      !current || current.length !== 2 ||
      current.some((row) => !ids.includes(row.inspection_photo_id))
    ) return null
    if (rawReading?.identifiedItem?.serialNumber && !reading?.identifiedItem?.serialNumber) result.serial_review={...((result.serial_review??{}) as Record<string,unknown>),serial:null,readable:false,formatOk:false,retake:true,retakePrompt:'Review the serial label; independent readings disagree.'}
    const committed=await db.rpc('home_check_pair_work',{p_action:'finish',p_check:checkId,p_label:ids[0],p_whole:ids[1],p_token:token,p_result:result})
    if(committed.error)throw new Error('Could not commit photo processing')
    if(!committed.data?.ok)return null
    return result.ai_result as ApplianceVisionResult || null
  } catch {
    const failed=await db.rpc('home_check_pair_work',{p_action:'finish',p_check:checkId,p_label:ids[0],p_whole:ids[1],p_token:token,p_result:{status:'error'}})
    if(failed.error)throw new Error('Could not schedule automatic photo retry')
    return null
  }
}

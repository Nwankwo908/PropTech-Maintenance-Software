import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { HomeCheckSlot } from '../../../../shared/homeCheck.ts'
import type { ApplianceVisionResult } from '../vision/types.ts'
import { analyzeInspectionPhotoRow } from '../vision/analyzeInspectionPhoto.ts'
import { inspectionBytesToBase64 } from '../vision/ingestInspectionUpload.ts'

/** A pair is identified by check + named system slots, never by upload recency. */
export async function analyzeHomeCheckEquipmentPair(
  db: SupabaseClient,
  checkId: string,
  slot: HomeCheckSlot,
  analyze = analyzeInspectionPhotoRow,
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
  try {
    const [labelDownload, wholeDownload] = await Promise.all([
      db.storage.from('inspection-uploads').download(label.storage_path),
      db.storage.from('inspection-uploads').download(whole.storage_path),
    ])
    if (labelDownload.error || wholeDownload.error || !labelDownload.data || !wholeDownload.data) {
      throw new Error('Could not read the equipment photo pair.')
    }
    const result = await analyze(
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
    )
    const reading = result.ai_result as ApplianceVisionResult | null
    if (
      reading && reading.category !== 'unknown' &&
      !(water ? reading.category === 'water_heater' : reading.category === 'boiler' ||
        (reading.category === 'hvac' &&
          /furnace|boiler|heating|heat pump/i.test(reading.identifiedItem?.type || '')))
    ) {
      result.ai_result = {
        ...reading,
        identifiedItem: {
          ...reading.identifiedItem,
          modelNumber: undefined,
          serialNumber: undefined,
        },
        estimatedAge: {
          value: null,
          confidence: 'low',
          basis: 'Photos do not match the selected equipment.',
        },
        labelReadability: {
          ...reading.labelReadability,
          status: 'uncertain',
          modelConfidence: 0,
          serialConfidence: 0,
          uncertainCharacters: [],
          formatWarnings: [],
          retakeRequested: true,
          retakeMessage:
            'These photos do not match the selected system. Send its whole-equipment photo and data plate.',
        },
      }
      await db.from('property_inspection_photos').update({ ai_result: result.ai_result }).eq(
        'id',
        label.inspection_photo_id,
      )
    }
    const { data: current, error: scopeError } = await db.from('home_check_photos').select(
      'inspection_photo_id',
    ).eq('check_id', checkId).in('slot', [labelSlot, wholeSlot])
    if (scopeError) throw new Error(scopeError.message)
    if (
      !current || current.length !== 2 ||
      current.some((row) => !ids.includes(row.inspection_photo_id))
    ) return null
    const { error: updateError } = await db.from('property_inspection_photos').update({
      status: result.status,
      ai_result: result.ai_result || null,
      provider: result.provider || null,
      error_message: result.error_message || null,
      updated_at: new Date().toISOString(),
    }).eq('id', whole.inspection_photo_id)
    if (updateError) throw new Error(updateError.message)
    return result.ai_result as ApplianceVisionResult || null
  } catch {
    await db.from('property_inspection_photos').update({
      status: 'error',
      error_message: 'Equipment photo reading is unavailable. Please retry later.',
    }).in('id', ids)
    return null
  }
}

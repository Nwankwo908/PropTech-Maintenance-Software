import { readHomeCheckPhoto } from './photoSlot.ts'
vi.mock('./photoSlot.ts',()=>({readHomeCheckPhoto:vi.fn(async()=>({category:'other',photoView:{equipment:'other',framing:'whole_appliance',confidence:'high'}}))}))
import { describe, expect, it, vi } from 'vitest'
import { analyzeHomeCheckEquipmentPair, reconcileHomeCheckSerialReading } from './equipmentPair.ts'

vi.mock('../vision/analyzeInspectionPhoto.ts', () => ({ analyzeInspectionPhotoRow: vi.fn() }))
vi.mock(
  '../vision/ingestInspectionUpload.ts',
  () => ({ inspectionBytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64') }),
)
const pair = [{
  slot: 'water_heater_label',
  inspection_photo_id: 'label',
  storage_path: 'scope/label.jpg',
}, { slot: 'water_heater_whole', inspection_photo_id: 'whole', storage_path: 'scope/whole.jpg' }]
function client(first = pair, current = first) {
  let reads = 0
  const filters: unknown[][] = []
  const updates: unknown[] = []
  return {
    filters,
    updates,
    rpc: vi.fn(async (_name:string,args:any)=>{ if(args.p_action==='begin')return {data:{ok:true,token:'lease'},error:null}; if(args.p_result?.status==='error')updates.push({status:'error'}); else updates.push({...args.p_result,ai_result:args.p_result.ai_result}); return {data:{ok:true},error:null} }),
    from(table: string) {
      const data = table === 'home_check_photos' ? reads++ ? current : first : null
      const builder: Record<string, unknown> = {
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve(resolve({ data, error: null })),
      }
      for (const method of ['select', 'eq', 'in']) {
        builder[method] = (...args: unknown[]) => {
          filters.push([table, method, ...args])
          return builder
        }
      }
      builder.update = (value: unknown) => {
        updates.push(value)
        return builder
      }
      return builder
    },
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([path.endsWith('label.jpg') ? new Uint8Array([1]) : new Uint8Array([2])], {
            type: 'image/jpeg',
          }),
          error: null,
        })),
      })),
    },
  }
}
describe('Scoped paired equipment photos', () => {
  it('waits for the label and whole-system view before reading', async () => {
    const analyze = vi.fn()
    expect(
      await analyzeHomeCheckEquipmentPair(
        client(pair.slice(0, 1)) as never,
        'check',
        'water_heater_label',
        analyze,
      ),
    ).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })
  it('sends exactly the scoped label and overview in one reading and preserves the actual provider', async () => {
    const db = client()
    const analyze = vi.fn(async () => ({
      status: 'needs_review',
      provider: 'claude',
      ai_result: { category: 'water_heater' },
    }))
    await analyzeHomeCheckEquipmentPair(db as never, 'check', 'water_heater_whole', analyze)
    expect(db.filters).toContainEqual(['home_check_photos', 'eq', 'check_id', 'check'])
    expect(db.filters).toContainEqual(['home_check_photos', 'in', 'slot', [
      'water_heater_label',
      'water_heater_whole',
    ]])
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0]).toEqual([
      db,
      'label',
      'AQ==',
      'image/jpeg',
      'water_heater',
      'photo',
      'scope/label.jpg',
      null,
      {
        purpose: 'label',
        referenceImages: [{ purpose: 'overview', imageBase64: 'Ag==', mediaType: 'image/jpeg' }],
      },
      { persist: false },
    ])
    expect(db.updates).toContainEqual(
      expect.objectContaining({ provider: 'claude', status: 'needs_review' }),
    )
  })
  it('does not copy an old reading when a label is replaced during analysis', async () => {
    const db = client(pair, [{ ...pair[0], inspection_photo_id: 'new-label' }, pair[1]])
    const analyze = vi.fn(async () => ({
      status: 'needs_review',
      ai_result: { category: 'water_heater' },
    }))
    expect(await analyzeHomeCheckEquipmentPair(db as never, 'check', 'water_heater_label', analyze))
      .toBeNull()
    expect(db.updates).toEqual([])
  })
  it('reports a provider outage as a read error without pretending the label was readable', async () => {
    const db = client()
    expect(
      await analyzeHomeCheckEquipmentPair(
        db as never,
        'check',
        'water_heater_label',
        vi.fn(async () => {
          throw new Error('provider unavailable')
        }),
      ),
    ).toBeNull()
    expect(db.updates).toContainEqual(expect.objectContaining({ status: 'error' }))
  })
  it('keeps an indoor HVAC label on the heating slots', async () => {
    const heating = [
      { slot: 'heating_label', inspection_photo_id: 'label', storage_path: 'scope/label.jpg' },
      { slot: 'heating_whole', inspection_photo_id: 'whole', storage_path: 'scope/whole.jpg' },
    ]
    const db = client(heating)
    const reading = {
      category: 'hvac',
      identifiedItem: { type: 'indoor unit', modelNumber: 'END4X42L17A1', serialNumber: 'X132753655' },
      estimatedAge: { value: 13, confidence: 'high', basis: 'Manufacture date July 2013.' },
    }
    await analyzeHomeCheckEquipmentPair(
      db as never,
      'check',
      'heating_label',
      vi.fn(async () => ({ status: 'needs_review', ai_result: reading })),
    )
    expect(db.updates).toContainEqual(expect.objectContaining({
      ai_result: expect.objectContaining({
        identifiedItem: expect.objectContaining({ modelNumber: 'END4X42L17A1' }),
      }),
    }))
  })
  it('requests the right system when a furnace photo is sent to the water heater slots', async () => {
    const db = client()
    await analyzeHomeCheckEquipmentPair(
      db as never,
      'check',
      'water_heater_label',
      vi.fn(async () => ({
        status: 'needs_review',
        ai_result: {
          category: 'hvac',
          identifiedItem: { type: 'furnace', modelNumber: 'WRONG', serialNumber: '123456' },
          estimatedAge: { value: 8 },
        },
      })),
    )
    expect(db.updates).toContainEqual(expect.objectContaining({
      ai_result: expect.objectContaining({
        identifiedItem: expect.objectContaining({
          modelNumber: undefined,
          serialNumber: undefined,
        }),
        estimatedAge: expect.objectContaining({ value: null }),
        labelReadability: expect.objectContaining({ retakeRequested: true }),
      }),
    }))
  })
})

const conflictingReading={category:'hvac',identifiedItem:{type:'heat pump',serialNumber:'X1327635655'},estimatedAge:{value:13,confidence:'high',basis:'Manufacture date July 2013.'},labelReadability:{status:'readable',serialConfidence:100,modelConfidence:100,readings:{serialNumber:'X132765565'},formatWarnings:[],uncertainCharacters:[],retakeRequested:false}}
describe('independent serial OCR disagreement',()=>{
 it('keeps conflicting serials unknown instead of overwriting a confident reading',()=>{
  const guarded=reconcileHomeCheckSerialReading(conflictingReading as never)
  expect(guarded.identifiedItem.serialNumber).toBeUndefined()
  expect(guarded.labelReadability).toMatchObject({status:'uncertain',serialConfidence:0,retakeRequested:true})
  expect(guarded.labelReadability?.readings?.serialNumber).toBe('X132765565 / X1327635655')
  expect(guarded.estimatedAge.value).toBe(13)
  expect(conflictingReading.identifiedItem.serialNumber).toBe('X1327635655')
 })
 it('also clears an age inferred only from the conflicting serial',()=>{
  expect(reconcileHomeCheckSerialReading({...conflictingReading,estimatedAge:{...conflictingReading.estimatedAge,basis:'Serial number decode'}} as never).estimatedAge.value).toBeNull()
 })
 it('preserves agreement after case and whitespace normalization',()=>{
  const matching={...conflictingReading,identifiedItem:{...conflictingReading.identifiedItem,serialNumber:' x132765565 '}}
  expect(reconcileHomeCheckSerialReading(matching as never)).toBe(matching)
 })
})


describe('HVAC component pair regression', () => {
  it.each(['Cased Evaporator Coil', 'evaporator coil'])('retains a readable %s without inventing a furnace mismatch', async (type) => {
    const heating = pair.map((row) => ({ ...row, slot: row.slot.replace('water_heater', 'heating') }))
    const db = client(heating)
    const reading = {
      category: 'hvac',
      identifiedItem: { type, brand: 'International Comfort Products', modelNumber: 'END4X42L17A1', serialNumber: 'X132753655' },
      estimatedAge: { value: 13, confidence: 'high', basis: 'Component manufacture date July 2013.' },
      labelReadability: { status: 'readable', retakeRequested: false, readings: { serialNumber: 'X132753655' } },
    }
    const result = await analyzeHomeCheckEquipmentPair(db as never, 'check', 'heating_whole',
      vi.fn(async () => ({ status: 'needs_review', ai_result: reading })))
    expect(result).toEqual(reading)
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0]).toMatchObject({ ai_result: { labelReadability: { retakeRequested: false }, identifiedItem: { modelNumber: 'END4X42L17A1' } } })
  })
  it.each(['Outdoor cooling-only condenser', 'Refrigerator'])('still rejects %s on heating slots', async (type) => {
    const heating = pair.map((row) => ({ ...row, slot: row.slot.replace('water_heater', 'heating') }))
    const db = client(heating)
    const result = await analyzeHomeCheckEquipmentPair(db as never, 'check', 'heating_whole',
      vi.fn(async () => ({ status: 'needs_review', ai_result: { category: 'hvac', identifiedItem: { type }, estimatedAge: { value: 7 } } })))
    expect(result?.estimatedAge.value).toBeNull()
    expect(result?.labelReadability?.retakeRequested).toBe(true)
  })
})

describe('generic heating type uses overview evidence',()=>{
 it('accepts a generic HVAC reading only after a confident indoor overview',async()=>{
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({category:'hvac',photoView:{equipment:'heating_system',framing:'whole_appliance',confidence:'high'}})
  const pair=[{slot:'heating_label',inspection_photo_id:'label',storage_path:'scope/label.jpg'},{slot:'heating_whole',inspection_photo_id:'whole',storage_path:'scope/whole.jpg'}];const db=client(pair)
  const result=await analyzeHomeCheckEquipmentPair(db as never,'check','heating_whole',vi.fn(async()=>({status:'needs_review',provider:'gemini',ai_result:{category:'hvac',identifiedItem:{type:'hvac',brand:'Lennox',modelNumber:'MODEL'},estimatedAge:{value:null},labelReadability:{status:'readable',retakeRequested:false}}})))
  expect(result?.identifiedItem.type).toBe('indoor heating system');expect(result?.identifiedItem.modelNumber).toBe('MODEL');expect(result?.labelReadability?.retakeRequested).toBe(false)
 })
 it('queues a retry when the extra overview reader is unavailable instead of requesting a retake',async()=>{
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce(null);const pair=[{slot:'heating_label',inspection_photo_id:'label',storage_path:'scope/label.jpg'},{slot:'heating_whole',inspection_photo_id:'whole',storage_path:'scope/whole.jpg'}];const db=client(pair)
  const result=await analyzeHomeCheckEquipmentPair(db as never,'check','heating_whole',vi.fn(async()=>({status:'needs_review',ai_result:{category:'hvac',identifiedItem:{type:'hvac'}}})))
  expect(result).toBeNull();expect(db.rpc).toHaveBeenLastCalledWith('home_check_pair_work',expect.objectContaining({p_action:'finish',p_result:{status:'error'}}))
 })
})

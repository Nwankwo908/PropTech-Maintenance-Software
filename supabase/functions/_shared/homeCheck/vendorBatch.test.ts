import { expect, it, vi } from 'vitest'
import { identifyVendorHomeCheckBatch } from './vendorBatch.ts'
vi.mock('./photoSlot.ts', () => ({ readHomeCheckPhoto: vi.fn() }))
const paths = ['heatingWhole','waterLabel','heatingLabel','waterWhole']
const read = vi.fn(async (path: string) => ({ bytes: new TextEncoder().encode(path), contentType: 'image/jpeg' }))
const identify = vi.fn(async (bytes: Uint8Array) => {
  const name = new TextDecoder().decode(bytes)
  return { category: name.startsWith('water') ? 'water_heater' : 'hvac', identifiedItem: { type: name.startsWith('water') ? 'water heater' : 'furnace' }, labelReadability: { status: name.endsWith('Label') ? 'readable' : 'not_visible' } } as never
})
it('maps four distinct views by content rather than attachment order', async () => {
  const result = await identifyVendorHomeCheckBatch(paths, read, identify)
  expect(result?.map(photo => photo.slot)).toEqual(['water_heater_label','water_heater_whole','heating_label','heating_whole'])
  expect(result?.map(photo => photo.path)).toEqual(['waterLabel','waterWhole','heatingLabel','heatingWhole'])
})
it('rejects duplicate attachments before reading', async () => {
  const read = vi.fn()
  expect(await identifyVendorHomeCheckBatch(['a','a','b','c'],read,identify)).toBeNull()
  expect(read).not.toHaveBeenCalled()
})
it('does not guess a missing view from three labels and one overview', async () => {
  expect(await identifyVendorHomeCheckBatch(['waterLabel','heatingLabel','otherLabel','waterWhole'],read,identify)).toBeNull()
})
it('keeps an unreadable batch unassigned', async () => {
  expect(await identifyVendorHomeCheckBatch(paths,read,vi.fn(async()=>null))).toBeNull()
})
it('does not use missing-slot fallback when a result has no view evidence', async () => {
  expect(await identifyVendorHomeCheckBatch(paths,read,vi.fn(async()=>({category:'hvac',identifiedItem:{type:'furnace'}} as never)))).toBeNull()
})
it('propagates a download failure without producing a partial mapping', async () => {
  await expect(identifyVendorHomeCheckBatch(paths,vi.fn(async()=>{throw Error('storage unavailable')}),identify)).rejects.toThrow('storage unavailable')
})

it('uses explicit framing even when both whole-appliance photos have readable labels', async () => {
 const identify = vi.fn(async(bytes:Uint8Array)=>{
  const name=new TextDecoder().decode(bytes), water=name.startsWith('water')
  return {category:water?'water_heater':'hvac',identifiedItem:{type:water?'water_heater':'hvac'},labelReadability:{status:'readable'},
   photoView:{equipment:water?'water_heater':'heating_system',framing:name.endsWith('Label')?'label_closeup':'whole_appliance',confidence:'high'}} as never
 })
 const result=await identifyVendorHomeCheckBatch(paths,read,identify)
 expect(result?.map(photo=>photo.slot)).toEqual(['water_heater_label','water_heater_whole','heating_label','heating_whole'])
})
it.each(['low','unknown','other','conflict'])('does not fill a missing slot using %s framing evidence',async problem=>{
 const identify=vi.fn(async(bytes:Uint8Array)=>{
  const name=new TextDecoder().decode(bytes),water=name.startsWith('water'),last=name==='heatingWhole'
  return {category:last&&problem==='conflict'?'water_heater':water?'water_heater':'hvac',identifiedItem:{type:'hvac'},
   photoView:{equipment:last&&problem==='other'?'other':water?'water_heater':'heating_system',framing:last&&problem==='unknown'?'unknown':name.endsWith('Label')?'label_closeup':'whole_appliance',confidence:last&&problem==='low'?'low':'high'}} as never
 })
 expect(await identifyVendorHomeCheckBatch(paths,read,identify)).toBeNull()
})
it('does not invent an overview when two photos explicitly show labels',async()=>{
 const identify=vi.fn(async(bytes:Uint8Array)=>{
  const name=new TextDecoder().decode(bytes),water=name.startsWith('water')
  return {category:water?'water_heater':'hvac',photoView:{equipment:water?'water_heater':'heating_system',framing:water?'label_closeup':name.endsWith('Label')?'label_closeup':'whole_appliance',confidence:'high'}} as never
 })
 expect(await identifyVendorHomeCheckBatch(paths,read,identify)).toBeNull()
})
it('records each placement and identifies duplicate views without retaining photo content',async()=>{
 const events:any[]=[]
 const classify=vi.fn(async()=>({category:'water_heater',identifiedItem:{type:'PRIVATE_LABEL',serialNumber:'PRIVATE_SERIAL'},photoView:{equipment:'water_heater',framing:'label_closeup',confidence:'high',privateText:'PRIVATE_VIEW_TEXT'}} as never))
 expect(await identifyVendorHomeCheckBatch(paths,read,classify,event=>events.push(event))).toBeNull()
 expect(events.filter(e=>e.stage==='download')).toHaveLength(4)
 expect(events.filter(e=>e.stage==='placement')).toHaveLength(4)
 expect(events.at(-1)).toMatchObject({stage:'batch',outcome:'duplicate_views'})
 const serialized=JSON.stringify(events)
 expect(serialized).not.toMatch(/PRIVATE_|heatingWhole|waterLabel|image\/jpeg|bytes|contentType/)
})
it('records uncertain placement without guessing a missing slot',async()=>{
 const events:any[]=[]
 const classify=vi.fn(async()=>({category:'hvac',photoView:{equipment:'heating_system',framing:'unknown',confidence:'low'}} as never))
 expect(await identifyVendorHomeCheckBatch(paths,read,classify,e=>events.push(e))).toBeNull()
 expect(events.filter(e=>e.stage==='placement').every(e=>e.outcome==='uncertain_view'&&e.slot===null)).toBe(true)
})
it('waits for all photo diagnostics on a download failure and still rejects the batch',async()=>{
 const events:any[]=[]
 const download=async(path:string)=>{if(path===paths[0])throw Error('PRIVATE_STORAGE_URL');await new Promise(r=>setTimeout(r,5));return read(path)}
 await expect(identifyVendorHomeCheckBatch(paths,download,identify,e=>events.push(e))).rejects.toThrow('PRIVATE_STORAGE_URL')
 expect(events.filter(e=>e.stage==='download')).toHaveLength(4)
 expect(events.find(e=>e.photoIndex===0)).toMatchObject({outcome:'download_error'})
 expect(events.at(-1)).toMatchObject({stage:'batch',outcome:'processing_error'})
 expect(JSON.stringify(events)).not.toContain('PRIVATE_STORAGE_URL')
})
it('logging failure does not change correct batch mapping',async()=>{
 expect((await identifyVendorHomeCheckBatch(paths,read,identify,()=>{throw Error('logging failed')}))?.length).toBe(4)
})

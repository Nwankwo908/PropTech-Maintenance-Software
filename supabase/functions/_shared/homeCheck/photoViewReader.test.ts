import {afterEach,expect,it,vi} from 'vitest'
import {createPhotoViewReader,photoViewFromContent} from './photoViewReader.ts'
const view={equipment:'heating_system',framing:'label_closeup',confidence:'high'}
const response=(provider:'gemini'|'openai',data:unknown=view)=>{
 const raw=data&&typeof data==='object'&&'framing' in data?{equipment:(data as any).equipment,confidence:(data as any).confidence,dominantContent:(data as any).framing==='label_closeup'?'data_plate':(data as any).framing==='whole_appliance'?'appliance_body':'unknown'}:data
 return new Response(JSON.stringify(provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]}:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}))
}
const configured={geminiKey:'TEST_PRIMARY_KEY',openaiKey:'TEST_BACKUP_KEY'}
afterEach(()=>vi.useRealTimers())
it('asks only for framing and skips the backup on a confident primary answer',async()=>{
 const fetchImpl=vi.fn(async()=>response('gemini'))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).toMatchObject({view,outcome:'success',provider:'gemini'})
 expect(fetchImpl).toHaveBeenCalledTimes(1)
 const body=JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)
 expect(body.generationConfig.responseJsonSchema.required).toEqual(['equipment','dominantContent','confidence'])
 expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(512)
})
it('aborts a timed-out primary and gives the backup its complete budget',async()=>{
 vi.useFakeTimers()
 const fetchImpl=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockImplementationOnce(()=>new Promise(r=>setTimeout(()=>r(response('openai')),9000)))
 const events:any[]=[];const task=createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg',e=>events.push(e))
 await vi.advanceTimersByTimeAsync(6000)
 expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true)
 expect(fetchImpl).toHaveBeenCalledTimes(2)
 await vi.advanceTimersByTimeAsync(9000)
 expect(await task).toMatchObject({view,outcome:'success',provider:'openai'})
 expect(events.map(e=>e.outcome)).toEqual(['timeout','success'])
 expect(events.every(e=>e.phase==='attempt')).toBe(true)
})
it('bounds response parsing as well as fetch, then falls back',async()=>{
 vi.useFakeTimers()
 const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,status:200,json:()=>new Promise(()=>{})}).mockResolvedValueOnce(response('openai'))
 const task=createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')
 await vi.advanceTimersByTimeAsync(6000)
 expect(await task).toMatchObject({provider:'openai',outcome:'success'})
 expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true)
})
it('bounds two stalled providers and emits both timeout attempts',async()=>{
 vi.useFakeTimers();const fetchImpl=vi.fn(()=>new Promise(()=>{}));const events:any[]=[]
 const task=createPhotoViewReader({...configured,fetchImpl:fetchImpl as never})('AQ==','image/jpeg',e=>events.push(e))
 await vi.advanceTimersByTimeAsync(16000)
 expect(await task).toMatchObject({view:null,outcome:'timeout'})
 expect(fetchImpl).toHaveBeenCalledTimes(2);expect(events.map(e=>e.outcome)).toEqual(['timeout','timeout'])
 expect(fetchImpl.mock.calls.every(call=>call[1].signal.aborted)).toBe(true)
})
it('falls back on provider HTTP errors without logging keys, photos or error bodies',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(new Response('PRIVATE_RESPONSE_BODY',{status:503})).mockResolvedValueOnce(response('openai'))
 const events:any[]=[]
 expect(await createPhotoViewReader({...configured,fetchImpl})('PRIVATE_IMAGE_BYTES','image/jpeg',e=>events.push(e))).toMatchObject({provider:'openai',outcome:'success'})
 expect(events[0]).toMatchObject({provider:'gemini',outcome:'provider_error',status:503})
 expect(JSON.stringify(events)).not.toMatch(/TEST_PRIMARY_KEY|TEST_BACKUP_KEY|PRIVATE_/)
 const body=JSON.parse(fetchImpl.mock.calls[1][1].body)
 expect(body.max_tokens).toBe(128);expect(body.response_format.json_schema.strict).toBe(true)
})
it('uses the backup for uncertain framing instead of inventing a view',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',{equipment:'unknown',framing:'unknown',confidence:'low'})).mockResolvedValueOnce(response('openai'))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).toMatchObject({provider:'openai',view})
})
it('skips OpenAI backup for phone-camera video MIME',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',{equipment:'unknown',framing:'unknown',confidence:'low'}))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','video/mp4')).toMatchObject({provider:'gemini',outcome:'uncertain_view'})
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
it('preserves low-confidence primary evidence if backup fails, never promoting it',async()=>{
 const low={equipment:'water_heater',framing:'unknown',confidence:'low'}
 const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',low)).mockRejectedValueOnce(Error('private'))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).toMatchObject({provider:'gemini',view:low,outcome:'uncertain_view'})
})
it('skips missing credentials and reports configuration failure truthfully',async()=>{
 const fetchImpl=vi.fn();const events:any[]=[]
 expect(await createPhotoViewReader({geminiKey:'',openaiKey:'',fetchImpl})('AQ==','image/jpeg',e=>events.push(e))).toMatchObject({view:null,outcome:'not_configured'})
 expect(fetchImpl).not.toHaveBeenCalled();expect(events.map(e=>e.outcome)).toEqual(['not_configured','not_configured'])
})
it('invalid primary output gets one backup attempt, not an invented slot',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',{serialNumber:'PRIVATE_SERIAL'})).mockResolvedValueOnce(response('openai',{equipment:'unknown',framing:'unknown',confidence:'low'}))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).toMatchObject({view:{equipment:'unknown',framing:'unknown',confidence:'low'},outcome:'uncertain_view'})
 expect(fetchImpl).toHaveBeenCalledTimes(2)
})
it('caller cancellation aborts the request and does not start a backup',async()=>{
 const controller=new AbortController()
 const fetchImpl=vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true})
 }))
 const task=createPhotoViewReader({...configured,fetchImpl:fetchImpl as typeof fetch})('AQ==','image/jpeg',undefined,controller.signal)
 controller.abort(new DOMException('cancelled','AbortError'))
 expect(await task).toMatchObject({view:null,outcome:'timeout'})
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it('a cabinet with a brand badge or readable sticker is an overview, never a data-plate closeup',async()=>{
 const raw={equipment:'heating_system',dominantContent:'appliance_body',confidence:'high',framing:'label_closeup'}
 expect(photoViewFromContent(raw)).toEqual({equipment:'heating_system',framing:'whole_appliance',confidence:'high'})
 const fetchImpl=vi.fn(async()=>response('gemini',{equipment:'heating_system',dominantContent:'appliance_body',confidence:'high'}))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).toMatchObject({view:{equipment:'heating_system',framing:'whole_appliance',confidence:'high'}})
})
it('missing or ambiguous dominant-content evidence cannot become a confident label',()=>{
 expect(photoViewFromContent({equipment:'heating_system',framing:'label_closeup',confidence:'high'})).toBeNull()
 expect(photoViewFromContent({equipment:'heating_system',dominantContent:'unknown',confidence:'low'})).toMatchObject({framing:'unknown',confidence:'low'})
})

it('checks a confident non-appliance rejection with the backup and preserves disagreement',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',{equipment:'other',dominantContent:'data_plate',confidence:'high'})).mockResolvedValueOnce(response('openai'))
 const result=await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')
 expect(fetchImpl).toHaveBeenCalledTimes(2)
 expect(result).toMatchObject({view:{equipment:'unknown',framing:'unknown',confidence:'low'},outcome:'uncertain_view'})
})
it('accepts a supported backup after a low-confidence rejection without promoting the first reading',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',{equipment:'other',dominantContent:'data_plate',confidence:'low'})).mockResolvedValueOnce(response('openai'))
 expect(await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).toMatchObject({view,outcome:'success',provider:'openai'})
})
it('two confident non-appliance readings remain excluded and a failed backup cannot turn exclusion into acceptance',async()=>{
 for(const backup of [response('openai',{equipment:'other',dominantContent:'appliance_body',confidence:'high'}),new Response('unavailable',{status:503})]){
  const fetchImpl=vi.fn().mockResolvedValueOnce(response('gemini',{equipment:'other',dominantContent:'appliance_body',confidence:'high'})).mockResolvedValueOnce(backup)
  expect((await createPhotoViewReader({...configured,fetchImpl})('AQ==','image/jpeg')).view?.equipment).toBe('other')
 }
})

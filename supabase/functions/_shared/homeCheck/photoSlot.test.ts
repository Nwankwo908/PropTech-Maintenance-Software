import {afterEach,expect,it,vi} from 'vitest'
import {readHomeCheckPhoto} from './photoSlot.ts'
const analyze=vi.hoisted(()=>vi.fn())
vi.mock('./photoViewReader.ts',()=>({PHOTO_VIEW_TOTAL_MS:17000,readPhotoView:analyze}))
vi.mock('../vision/ingestInspectionUpload.ts',()=>({inspectionBytesToBase64:()=> 'AQ=='}))
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks()})
const view={equipment:'water_heater',framing:'whole_appliance',confidence:'high'}
const reading={view,provider:'openai',outcome:'success'}
it('allows framing fallback beyond the old ten-second cutoff',async()=>{
 vi.useFakeTimers();analyze.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(reading),15000)))
 const pending=readHomeCheckPhoto(new Uint8Array([1]),'image/jpeg')
 await vi.advanceTimersByTimeAsync(15000)
 expect(await pending).toEqual({category:'water_heater',photoView:view})
})
it('bounds the entire routing reader and aborts its parent signal',async()=>{
 vi.useFakeTimers();analyze.mockImplementation(()=>new Promise(()=>{}))
 const pending=readHomeCheckPhoto(new Uint8Array([1]),'image/jpeg')
 await vi.advanceTimersByTimeAsync(17000)
 expect(await pending).toBeNull();expect(analyze.mock.calls[0][3].aborted).toBe(true)
})
it('does not treat readable text without view evidence as a valid photo view',async()=>{
 analyze.mockResolvedValue({view:null,provider:'openai',outcome:'invalid_response'})
 expect(await readHomeCheckPhoto(new Uint8Array([1]),'image/jpeg')).toBeNull()
})
it('records complete timeout without photo bytes or exception text',async()=>{
 vi.useFakeTimers();analyze.mockImplementation(()=>new Promise(()=>{}));const observe=vi.fn()
 const pending=readHomeCheckPhoto(new TextEncoder().encode('PRIVATE_IMAGE_BYTES'),'image/jpeg',observe)
 await vi.advanceTimersByTimeAsync(17000);expect(await pending).toBeNull()
 expect(observe).toHaveBeenCalledWith({phase:'complete',outcome:'timeout',durationMs:expect.any(Number),provider:null})
 expect(JSON.stringify(observe.mock.calls)).not.toContain('PRIVATE_IMAGE_BYTES')
})
it('records unavailable reader reasons without extracted text',async()=>{
 const observe=vi.fn();analyze.mockResolvedValueOnce({view:null,provider:'openai',outcome:'invalid_response'})
 await readHomeCheckPhoto(new Uint8Array([1]),'image/jpeg',observe)
 expect(observe.mock.calls[0][0].outcome).toBe('invalid_response')
 analyze.mockRejectedValueOnce(Error('PRIVATE_PROVIDER_RESPONSE'))
 await readHomeCheckPhoto(new Uint8Array([1]),'image/jpeg',observe)
 expect(observe.mock.calls[1][0].outcome).toBe('provider_error')
 expect(JSON.stringify(observe.mock.calls)).not.toContain('PRIVATE_PROVIDER_RESPONSE')
})
it('diagnostic sink failures do not invalidate a valid view',async()=>{
 analyze.mockResolvedValue(reading)
 expect(await readHomeCheckPhoto(new Uint8Array([1]),'image/jpeg',()=>{throw Error('logging unavailable')})).toEqual({category:'water_heater',photoView:view})
})

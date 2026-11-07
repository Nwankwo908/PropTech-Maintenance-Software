import {expect,it} from 'vitest'
import {homeCheckVisitPhotoSms} from './homeCheckVisit.ts'
import {HOME_CHECK_PHOTOS,homeCheckSlotName} from './homeCheck.ts'
const location='200 Disposable Tenant Test Lane, Newark, NJ, Unit 1'
it.each(HOME_CHECK_PHOTOS.map((photo,index)=>({photo,index})))('acknowledges an existing $photo.slot without claiming the images are identical',({photo,index})=>{
 const filled=HOME_CHECK_PHOTOS.slice(0,index+1).map(p=>p.slot)
 const reply=homeCheckVisitPhotoSms({location,company:'Test',savedSlot:photo.slot,filled})
 expect(reply).toContain(`You already sent a photo of ${homeCheckSlotName(photo.slot)}`)
 expect(reply).toContain('I replaced the saved photo')
 expect(reply).toContain(location)
 expect(reply).not.toMatch(/identical|same photo|duplicate image/i)
 expect(reply).toContain(index<3?`Next, send a photo of ${homeCheckSlotName(HOME_CHECK_PHOTOS[index+1].slot)}`:'All four photos are in')
 expect(filled).toHaveLength(index+1)
})
it('keeps the heating label as the next missing step after a repeated water-heater label',()=>{
 const reply=homeCheckVisitPhotoSms({location,company:'Test',savedSlot:'water_heater_label',filled:['water_heater_label','water_heater_whole']})
 expect(reply).toContain('already sent')
 expect(reply).toContain('Next, send a photo of the furnace or boiler label')
 expect(reply).not.toContain('All four photos are in')
})
it.each(HOME_CHECK_PHOTOS.map((photo,index)=>({photo,index})))('keeps the first-save acknowledgement for $photo.slot',({photo,index})=>{
 const reply=homeCheckVisitPhotoSms({location,company:'Test',savedSlot:photo.slot,filled:HOME_CHECK_PHOTOS.slice(0,index).map(p=>p.slot)})
 expect(reply).toMatch(/^Saved as /)
 expect(reply).not.toContain('already sent')
})

import { expect, it } from 'vitest'
import { vendorPhotoRetake, vendorRetakeReply } from './vendorRetake.ts'
import type { BatchPhotoDiagnostic } from './photoDiagnostics.ts'
const paths=['water-label','water-whole','unmatched-label','heating-whole']
const placements:BatchPhotoDiagnostic[]=[
 {stage:'placement',photoIndex:0,outcome:'success',slot:'water_heater_label',view:{equipment:'water_heater',framing:'label_closeup',confidence:'high'},durationMs:0},
 {stage:'placement',photoIndex:1,outcome:'success',slot:'water_heater_whole',view:{equipment:'water_heater',framing:'whole_appliance',confidence:'high'},durationMs:0},
 {stage:'placement',photoIndex:2,outcome:'not_equipment',slot:null,view:{equipment:'other',framing:'label_closeup',confidence:'high'},durationMs:0},
 {stage:'placement',photoIndex:3,outcome:'success',slot:'heating_whole',view:{equipment:'heating_system',framing:'whole_appliance',confidence:'high'},durationMs:0},
]
it('keeps exactly the three content-matched paths and asks only for the missing view',()=>{
 expect(vendorPhotoRetake(paths,placements)).toEqual({keepPaths:['water-label','water-whole','heating-whole'],slot:'heating_label'})
 expect(vendorRetakeReply('heating_label')).toContain('heating-system label on the furnace or boiler')
 expect(vendorRetakeReply('heating_label')).toContain('kept the other three')
})
it('maps paths from diagnostic indexes rather than attachment order',()=>{
 expect(vendorPhotoRetake([...paths].reverse(),placements)?.keepPaths).toEqual(['heating-whole','unmatched-label','water-label'])
})
it('does not discard a photo because its provider timed out or a download failed',()=>{
 for(const event of [{stage:'reader',outcome:'timeout'},{stage:'download',outcome:'download_error'}] as const)expect(vendorPhotoRetake(paths,[...placements,{...event,durationMs:10}])).toBeNull()
})
it('refuses duplicate slots, low-confidence matches, missing/duplicate diagnostic indexes and incomplete batches',()=>{
 const patch=(i:number,p:Partial<BatchPhotoDiagnostic>)=>placements.map((e,j)=>j===i?{...e,...p}:e)
 expect(vendorPhotoRetake(paths,patch(1,{slot:'water_heater_label'}))).toBeNull()
 expect(vendorPhotoRetake(paths,patch(0,{view:{equipment:'water_heater',framing:'label_closeup',confidence:'low'}}))).toBeNull()
 expect(vendorPhotoRetake(paths,patch(3,{photoIndex:0}))).toBeNull()
 expect(vendorPhotoRetake(paths,placements.slice(0,3))).toBeNull()
 expect(vendorPhotoRetake(paths.slice(0,3),placements)).toBeNull()
})

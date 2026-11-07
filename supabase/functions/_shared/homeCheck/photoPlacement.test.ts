import {expect,it} from 'vitest'
import {homeCheckSlotFromReading} from '../../../../shared/homeCheck.ts'
it('keeps readable text on an appliance overview in the whole-appliance slot',()=>{
 expect(homeCheckSlotFromReading({category:'water_heater',photoView:{equipment:'water_heater',framing:'whole_appliance',confidence:'high'},labelReadability:{status:'readable'},identifiedItem:{serialNumber:'test'}},[])).toEqual({slot:'water_heater_whole'})
})
it.each(['water_heater','heating_system'] as const)('does not infer %s framing from the missing slots',equipment=>{
 expect(homeCheckSlotFromReading({photoView:{equipment,framing:'unknown',confidence:'low'}},['water_heater_label','water_heater_whole','heating_label'])).toEqual({slot:null,reason:'unclear'})
})
it('rejects contradictory category and photo evidence',()=>{
 expect(homeCheckSlotFromReading({category:'water_heater',photoView:{equipment:'heating_system',framing:'whole_appliance',confidence:'high'}},[])).toEqual({slot:null,reason:'not_equipment'})
})
it('never places unrelated photos using a vacant slot',()=>{
 expect(homeCheckSlotFromReading({photoView:{equipment:'other',framing:'whole_appliance',confidence:'high'}},[])).toEqual({slot:null,reason:'not_equipment'})
})
it('recognizes a repeated view as the same slot instead of advancing to a missing slot',()=>{
 expect(homeCheckSlotFromReading({photoView:{equipment:'water_heater',framing:'label_closeup',confidence:'high'}},['water_heater_label','water_heater_whole'])).toEqual({slot:'water_heater_label'})
})

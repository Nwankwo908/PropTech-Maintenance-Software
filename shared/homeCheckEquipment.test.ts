import {it,expect} from 'vitest'
import {homeCheckEquipment} from './homeCheckEquipment'
const asset=(make='International Comfort Products',model='END4X42L17A1')=>({system:'heating' as const,manufactureDate:{year:2013,month:7},fields:{make:{value:make},model:{value:model},approximateAge:{value:13}}})
it('keeps the requested Heating system label with its manufacture date and consistent age',()=>{expect(homeCheckEquipment(asset(),new Date('2026-11-02'))).toEqual({label:'Heating system',made:'July 2013',age:13})})
it('does not add component terminology for another manufacturer',()=>{expect(homeCheckEquipment(asset('Other'),new Date('2026-11-02')).label).toBe('Heating system')})
it('keeps the requested display label even when a specific heating component is identified',()=>{expect(homeCheckEquipment({...asset('Other','ABC'),identifiedType:'gas furnace'}).label).toBe('Heating system')})
it('year-only manufacture dates support approximate age without inventing a month',()=>{expect(homeCheckEquipment({...asset('Craftmaster','BF1GH'),system:'water_heater',manufactureDate:{year:2009,month:null},fields:{...asset().fields,make:{value:'Craftmaster'},model:{value:'BF1GH'},approximateAge:{value:null}}},new Date('2026-11-02'))).toEqual({label:'Water heater',made:'2009',age:17})})
it('recalculates stale ages using manufacture date and handles an upcoming anniversary',()=>{expect(homeCheckEquipment(asset(),new Date('2026-06-01')).age).toBe(12)})
it('does not calculate an age from a future manufacture year',()=>{expect(homeCheckEquipment({...asset(),manufactureDate:{year:2030,month:7},fields:{...asset().fields,approximateAge:{value:null}}},new Date('2026-11-02')).age).toBeNull()})

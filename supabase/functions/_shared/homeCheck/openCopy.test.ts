import {it,expect} from 'vitest'
import {homeCheckCaptureSms,homeCheckPhotoKindQuestion} from '../../../../shared/homeCheck.ts'
it('tenant instructions lead with the purpose and address, without internal names or equipment wording',()=>{
 const text=homeCheckCaptureSms({role:'tenant',location:'Internal test name · 200 Disposable Tenant Test Lane · Newark, NJ · Unit 1',company:'Internal Company',reference:'HC-PRIVATE'})
 expect(text).toMatch(/^Ulo is requesting appliance photos for your Home Check at 200 Disposable Tenant Test Lane, Newark, NJ, Unit 1\./)
 expect(text).not.toMatch(/Internal|Ulo for|equipment photos|where you live|HC-PRIVATE/)
 expect(text).toContain('Please send one clear photo of the water heater label.')
 expect(text.indexOf('Please send')).toBeLessThan(text.indexOf("We'll guide you"))
})
it('resuming a tenant step requests exactly the remembered view',()=>{
 const text=homeCheckCaptureSms({role:'tenant',location:'200 Test Lane',company:'Internal',reference:'HC-X',nextPhoto:'heating_whole'})
 expect(text).toContain('Please send one clear photo of the whole furnace or boiler.')
 expect(text).not.toContain('water heater label')
})
it('a non-appliance result asks neutrally without asserting the user sent the wrong photo',()=>{
 const text=homeCheckPhotoKindQuestion('200 Test Lane',true)
 expect(text).toContain('I couldn’t identify the appliance')
 expect(text).not.toContain("doesn't look like")
 expect(text).toContain('Ulo will keep the photo or video')
})

import {expect,it} from 'vitest'
import {smsUnknownLabelCorrections} from './labelReview.ts'
const asset={id:'heating',metadata:{homeCheck:{labelReadability:{retakeRequested:true,modelConfidence:100,serialConfidence:0},fields:{model:{value:'END4X42L17A1'},serial:{value:null}}}}}
it('SMS OK acknowledges an unknown serial without choosing a reading',()=>{
 expect(smsUnknownLabelCorrections([asset])).toEqual([{assetId:'heating',serialNumber:null}])
 expect(asset.metadata.homeCheck.fields.serial.value).toBeNull()
})
it('does not acknowledge a disputed non-null serial as factual',()=>{
 expect(()=>smsUnknownLabelCorrections([{...asset,metadata:{homeCheck:{...asset.metadata.homeCheck,fields:{...asset.metadata.homeCheck.fields,serial:{value:'CONFLICTING-CANDIDATE'}}}}}])).toThrow('Review the flagged label')
})
it('does not bypass a flag when both populated fields would be kept',()=>{
 expect(()=>smsUnknownLabelCorrections([{...asset,metadata:{homeCheck:{...asset.metadata.homeCheck,labelReadability:{...asset.metadata.homeCheck.labelReadability,serialConfidence:100},fields:{...asset.metadata.homeCheck.fields,serial:{value:'VISIBLE'}}}}}])).toThrow('Review the flagged label')
})
it('leaves unknown model and serial as explicit nulls',()=>{
 expect(smsUnknownLabelCorrections([{...asset,metadata:{homeCheck:{...asset.metadata.homeCheck,fields:{model:{value:null},serial:{value:null}}}}}])).toEqual([{assetId:'heating',modelNumber:null,serialNumber:null}])
})
it('does not change labels that were already reviewed',()=>{
 expect(smsUnknownLabelCorrections([{...asset,metadata:{...asset.metadata,labelReviewAcknowledged:true}}])).toEqual([])
})

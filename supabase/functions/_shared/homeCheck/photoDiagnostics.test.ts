import {expect,it} from 'vitest'
import {photoBatchFailureReply} from './photoDiagnostics.ts'
it('timeouts are described as reader availability, not unclear photos',()=>{
 const text=photoBatchFailureReply([{stage:'reader',photoIndex:0,outcome:'timeout',durationMs:16000}])
 expect(text).toContain('AI photo reader timed out');expect(text).toContain('photos are kept');expect(text).not.toMatch(/confident|unclear|blurry/)
})
it('provider failures and malformed responses do not blame the photos',()=>{
 for(const outcome of ['provider_error','invalid_response','not_configured'] as const)expect(photoBatchFailureReply([{stage:'reader',outcome,durationMs:1}])).toContain('AI photo reader could not finish')
})
it('an individual primary timeout does not override an actual successful backup reading',()=>{
 expect(photoBatchFailureReply([{stage:'attempt',outcome:'timeout',durationMs:6000},{stage:'reader',outcome:'success',durationMs:8000},{stage:'batch',outcome:'duplicate_views',durationMs:8000}])).toContain('could not match every view')
})
it('download errors and genuinely uncertain mappings remain separate',()=>{
 expect(photoBatchFailureReply([{stage:'download',outcome:'download_error',durationMs:20}])).toContain('could not open all four photos')
 expect(photoBatchFailureReply([{stage:'placement',outcome:'uncertain_view',durationMs:0}])).toContain('could not match every view')
})
it('names missing water-heater views when a complete batch contains only heating views',()=>{
 const slots=['heating_label','heating_whole','heating_label','heating_whole'] as const
 const events=slots.map((slot,photoIndex)=>({stage:'placement' as const,photoIndex,slot,outcome:'success' as const,durationMs:0,view:{equipment:'heating_system' as const,framing:slot.endsWith('label')?'label_closeup' as const:'whole_appliance' as const,confidence:'high' as const}}))
 const text=photoBatchFailureReply(events)
 expect(text).toContain('1) Water-heater model/serial label')
 expect(text).toContain('2) Whole water heater, including the base')
 expect(text).not.toContain('3) Heating')
 expect(text).toContain('Some views appear more than once')
 expect(text).toContain('no equipment records were saved')
 expect(text).not.toMatch(/HC-|unreadable|blurry/)
})
it('does not claim missing views from incomplete placement diagnostics or failed readers',()=>{
 const partial=[{stage:'placement' as const,photoIndex:0,slot:'heating_label' as const,outcome:'success' as const,durationMs:0}]
 expect(photoBatchFailureReply(partial)).not.toContain('required views:')
 expect(photoBatchFailureReply([...partial,{stage:'reader',outcome:'provider_error',durationMs:1}])).toContain('AI photo reader could not finish')
})

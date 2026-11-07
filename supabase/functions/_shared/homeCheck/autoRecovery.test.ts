import {afterAll,afterEach,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import {analyzeHomeCheckEquipmentPair} from './equipmentPair.ts'
import {runHomeCheckPhotoRecovery} from './recovery.ts'
import {sendHomeCheckSms,finishHomeCheckPhotoAnalysis} from './service.ts'
vi.mock('./service.ts',()=>({loadHomeCheck:vi.fn(async()=>({id:'disposable-check',landlord_id:'disposable-account',role:'landlord',recipient_phone:'+15555550101',expires_at:'2099-01-01',confirmed_at:null,answers:{warningSigns:null}})),finishHomeCheckPhotoAnalysis:vi.fn(async()=>({slots:['water_heater_label','water_heater_whole'],feedback:[]})),checkLocation:()=> 'Disposable property',notifyHomeCheckResult:vi.fn(async()=>true),rebuildHomeCheckAssets:vi.fn(async()=>[]),sendHomeCheckSms:vi.fn(async()=>({messageId:'accepted'}))}))
import {withEquipmentBackup} from '../vision/providers/equipmentFallback.ts'
vi.mock('../vision/analyzeInspectionPhoto.ts',()=>({analyzeInspectionPhotoRow:vi.fn()}))
vi.mock('../vision/ingestInspectionUpload.ts',()=>({inspectionBytesToBase64:(b:Uint8Array)=>Buffer.from(b).toString('base64')}))
const evidence:any[]=[]
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks()})
afterAll(()=>fs.writeFileSync('/Users/originalcharacter/Documents/PropTech Maintenance Software/.readiness/2026-11-06-pair-system-evidence/scenarios.json',JSON.stringify(evidence,null,2)))
const reading={category:'water_heater',identifiedItem:{type:'Water heater',brand:'Rheem',modelNumber:'TEST',serialNumber:'TEST123'},estimatedAge:{value:null,confidence:'low',basis:'Unknown'},condition:{rating:'fair',summary:''},deficiencies:[],maintenanceRecommendations:[],overallConfidence:90,labelReadability:{status:'readable',modelConfidence:95,serialConfidence:95,uncertainCharacters:[],retakeRequested:false,formatWarnings:[]}}
function fixture(failDownload=false){
 const rows=[{slot:'water_heater_label',inspection_photo_id:'label',storage_path:'disposable/label.jpg'},{slot:'water_heater_whole',inspection_photo_id:'whole',storage_path:'disposable/whole.jpg'}]
 let job:any=null,notice=false;const states:any={label:{status:'queued'},whole:{status:'queued'}};let failed=false;const writes:any[]=[],filters:any[]=[]
 const download=vi.fn(async(path:string)=>{if(failDownload&&!failed){failed=true;return {data:null,error:{message:'SIMULATED_TEMPORARY_503'}}}return {data:new Blob([path],{type:'image/jpeg'}),error:null}})
 const db={rpc:vi.fn(async(name:string,args:any)=>{
 if(name==='home_check_sms_capture_context')return {data:{ok:true,checkId:'disposable-check',slot:args.p_slot,version:'v'},error:null}
 if(name==='home_check_pair_work'){
  if(args.p_action==='begin'){job={check_id:'disposable-check',landlord_id:'disposable-account',system:'water_heater',label_id:'label',whole_id:'whole',attempts:1,state:'processing',token:'token1'};return {data:{ok:true,token:job.token},error:null}}
  const good=args.p_result.status==='needs_review';job.state=good?'done':job.attempts>=3?'failed':'pending';const patch=good?args.p_result:{status:'error'};for(const id of ['label','whole'])states[id]={...states[id],...patch};writes.push({table:'property_inspection_photos',patch});return {data:{ok:true,success:good},error:null}
 }
 if(name==='claim_home_check_photo_retry'){if(!job||job.state!=='pending')return {data:null,error:null};job.state='processing';job.attempts++;job.token='token'+job.attempts;return {data:{...job},error:null}}
 if(name==='reserve_home_check_recovery_notice'){if(notice||!job||!['done','failed'].includes(job.state)||job.attempts<2)return {data:null,error:null};notice=true;return {data:{id:'notice',landlord_id:'disposable-account',failed:job.state==='failed'},error:null}}
 throw Error('Unexpected RPC')
 }),from(table:string){let patch:any;let ids:string[]=[];const q:any={then(resolve:any){if(patch){writes.push({table,ids,patch});for(const id of ids)states[id]={...states[id],...patch}}return Promise.resolve(resolve({data:table==='home_check_photos'?rows:table==='home_check_photo_jobs'?(job&&['done','failed'].includes(job.state)?[{check_id:'disposable-check',landlord_id:'disposable-account'}]:[]):table==='home_check_sms_capture_sessions'?{check_id:'disposable-check'}:null,error:null}))}};for(const m of ['select','eq','in','gt','is','order','limit'])q[m]=(...args:any[])=>{filters.push([table,m,...args]);if(m==='in'&&args[0]==='id')ids=args[1];return q};q.maybeSingle=()=>Promise.resolve({data:{check_id:'disposable-check',conversation_id:'conv'},error:null});q.update=(p:any)=>{patch=p;return q};return q},storage:{from:vi.fn(()=>({download}))}}
 return {db,rows,states,writes,filters,download,job:()=>job}
}
it('control: one successful pair reads only its two retained photos and writes no duplicate photo entries',async()=>{
 const f=fixture();const analyze=vi.fn(async()=>({status:'needs_review',provider:'gemini',ai_result:reading}));const result=await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze as never)
 evidence.push({scenario:'successful_control',result:!!result,downloads:f.download.mock.calls.length,analysisCalls:analyze.mock.calls.length,photoEntries:f.rows.length,writes:f.writes})
 expect(result).not.toBeNull();expect(f.rows).toHaveLength(2);expect(f.download).toHaveBeenCalledTimes(2);expect(analyze).toHaveBeenCalledTimes(1);expect(f.writes).toHaveLength(1)
})
it('REQUIREMENT: a temporary download failure recovers automatically from the retained files without another upload',async()=>{
 vi.useFakeTimers();const f=fixture(true);const analyze=vi.fn(async()=>({status:'needs_review',provider:'gemini',ai_result:reading}));const result=await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze as never);await vi.advanceTimersByTimeAsync(60000);await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',{analyze:(db,id,slot,_default,lease)=>analyzeHomeCheckEquipmentPair(db,id,slot,analyze,lease)})
 evidence.push({scenario:'transient_storage_failure',automaticallyRecovered:f.states.label.status==='needs_review',downloads:f.download.mock.calls.length,analysisCalls:analyze.mock.calls.length,retainedPhotoEntries:f.rows.length,states:f.states,timersRemaining:vi.getTimerCount(),observationWindowMs:60000})
 expect(f.states.label.status,'Retained photo pair should be analyzed after the one-shot storage failure').toBe('needs_review');expect(f.states.label.status).toBe('needs_review');expect(f.rows).toHaveLength(2);expect(sendHomeCheckSms).toHaveBeenCalledTimes(1)
})
it('REQUIREMENT: a temporary pair-analysis failure recovers automatically without another upload',async()=>{
 vi.useFakeTimers();const f=fixture();const analyze=vi.fn().mockRejectedValueOnce(Error('SIMULATED_TEMPORARY_PROVIDER_503')).mockResolvedValue({status:'needs_review',provider:'gemini',ai_result:reading});const result=await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze);await vi.advanceTimersByTimeAsync(60000);await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',{analyze:(db,id,slot,_default,lease)=>analyzeHomeCheckEquipmentPair(db,id,slot,analyze,lease)})
 evidence.push({scenario:'transient_analysis_failure',automaticallyRecovered:f.states.label.status==='needs_review',downloads:f.download.mock.calls.length,analysisCalls:analyze.mock.calls.length,retainedPhotoEntries:f.rows.length,states:f.states,timersRemaining:vi.getTimerCount(),observationWindowMs:60000})
 expect(f.states.label.status,'Pair analysis should retry the one-shot error without user action').toBe('needs_review');expect(analyze).toHaveBeenCalledTimes(2);expect(f.rows).toHaveLength(2);expect(sendHomeCheckSms).toHaveBeenCalledTimes(1);await runHomeCheckPhotoRecovery(f.db as never,'disposable-account');expect(sendHomeCheckSms).toHaveBeenCalledTimes(1)
})
it('persistent outage never fabricates a successful equipment result',async()=>{
 const f=fixture();const analyze=vi.fn(async()=>{throw Error('SIMULATED_OUTAGE')});const result=await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze)
 evidence.push({scenario:'persistent_outage_truthfulness',returnedNull:result===null,states:f.states,analysisCalls:analyze.mock.calls.length})
 expect(result).toBeNull();expect(f.states.label.status).toBe('error');expect(f.states.whole.status).toBe('error')
})
it('AI provider fallback alone recovers from a primary outage with exactly one backup call',async()=>{
 const primary={name:'gemini',analyzeImage:vi.fn(async()=>{throw Error('SIMULATED_PRIMARY_503')})};const backup={name:'gpt4o',analyzeImage:vi.fn(async()=>reading)}
 const result=await withEquipmentBackup(primary as never,backup as never).analyzeImage('TEST_IMAGE',undefined,'image/jpeg',{purpose:'label'})
 evidence.push({scenario:'provider_fallback',selectedProvider:result.extractionTrace?.selectedProvider,primaryCalls:primary.analyzeImage.mock.calls.length,backupCalls:backup.analyzeImage.mock.calls.length})
 expect(result.extractionTrace?.selectedProvider).toBe('openai');expect(primary.analyzeImage).toHaveBeenCalledTimes(1);expect(backup.analyzeImage).toHaveBeenCalledTimes(1)
})

it('persistent outage stops after three attempts and sends one truthful review notice',async()=>{
 const f=fixture();const analyze=vi.fn(async()=>{throw Error('SIMULATED_OUTAGE')});await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze)
 const options={analyze:(db:any,id:string,slot:any,_default:any,lease:any)=>analyzeHomeCheckEquipmentPair(db,id,slot,analyze,lease)}
 await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',options);await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',options);await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',options)
 expect(analyze).toHaveBeenCalledTimes(3);expect(f.job().state).toBe('failed');expect(sendHomeCheckSms).toHaveBeenCalledTimes(1);expect(vi.mocked(sendHomeCheckSms).mock.calls[0][3]).toContain('could not finish')
 evidence.push({scenario:'bounded_permanent_failure',attempts:analyze.mock.calls.length,state:f.job().state,notices:vi.mocked(sendHomeCheckSms).mock.calls.length})
})
it('ambiguous SMS outcome is reserved once and never blindly sent again',async()=>{
 const f=fixture();const analyze=vi.fn().mockRejectedValueOnce(Error('temporary')).mockResolvedValue({status:'needs_review',provider:'gemini',ai_result:reading});await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze)
 vi.mocked(sendHomeCheckSms).mockRejectedValueOnce(Error('ambiguous send timeout'));const options={analyze:(db:any,id:string,slot:any,_default:any,lease:any)=>analyzeHomeCheckEquipmentPair(db,id,slot,analyze,lease)}
 const first=await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',options);await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',options)
 expect(first.uncertain).toBe(1);expect(sendHomeCheckSms).toHaveBeenCalledTimes(1)
 evidence.push({scenario:'ambiguous_send',uncertain:first.uncertain,sendCalls:vi.mocked(sendHomeCheckSms).mock.calls.length})
})

it('recovered complete photos renew capture to observations rather than the old retake slot',async()=>{
 const f=fixture();const analyze=vi.fn().mockRejectedValueOnce(Error('temporary')).mockResolvedValue({status:'needs_review',provider:'gemini',ai_result:reading});await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze)
 vi.mocked(finishHomeCheckPhotoAnalysis).mockResolvedValue({slots:['water_heater_label','water_heater_whole','heating_label','heating_whole'],feedback:[]} as never)
 await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',{analyze:(db,id,slot,_default,lease)=>analyzeHomeCheckEquipmentPair(db,id,slot,analyze,lease)})
 expect(f.db.rpc).toHaveBeenCalledWith('home_check_sms_capture_context',expect.objectContaining({p_action:'bind',p_slot:null}));expect(vi.mocked(sendHomeCheckSms).mock.calls[0][3]).toContain('Any leaks')
})
it('unverified system recovery asks for the overview and binds the whole view, not the label',async()=>{
 const f=fixture();const analyze=vi.fn().mockRejectedValueOnce(Error('temporary')).mockResolvedValue({status:'needs_review',provider:'gemini',ai_result:reading});await analyzeHomeCheckEquipmentPair(f.db as never,'disposable-check','water_heater_whole',analyze)
 vi.mocked(finishHomeCheckPhotoAnalysis).mockResolvedValue({slots:['water_heater_label','water_heater_whole','heating_label','heating_whole'],feedback:[{slot:'heating_label',retakeReason:'system_unverified',retakeMessage:'Unverified'}]} as never)
 await runHomeCheckPhotoRecovery(f.db as never,'disposable-account',{analyze:(db,id,slot,_default,lease)=>analyzeHomeCheckEquipmentPair(db,id,slot,analyze,lease)})
 expect(f.db.rpc).toHaveBeenCalledWith('home_check_sms_capture_context',expect.objectContaining({p_action:'bind',p_slot:'heating_whole'}));expect(vi.mocked(sendHomeCheckSms).mock.calls[0][3]).toContain('whole furnace or boiler')
})

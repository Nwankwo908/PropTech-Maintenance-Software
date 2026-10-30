import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { HomeCheckSlot } from '../../../../shared/homeCheck.ts'
export type CaptureContext={checkId:string;slot:HomeCheckSlot|null;version:string;claim?:string;expiresAt:string}
export async function readCaptureContext(db:SupabaseClient,landlordId:string,conversationId:string,options:{allowExpiredForReply?:boolean}={}):Promise<CaptureContext|null>{
 const {data,error}=await db.from('home_check_sms_capture_sessions').select('check_id,expected_slot,version,expires_at').eq('landlord_id',landlordId).eq('conversation_id',conversationId).maybeSingle()
 if(error||!data||!Number.isFinite(Date.parse(data.expires_at))||(!options.allowExpiredForReply&&Date.parse(data.expires_at)<=Date.now()))return null
 return {checkId:data.check_id,slot:data.expected_slot,version:data.version,expiresAt:data.expires_at}
}
export async function captureContextAction(db:SupabaseClient,input:{action:'bind'|'claim'|'release';landlordId:string;conversationId:string;checkId:string;slot?:HomeCheckSlot|null;version?:string;claim?:string;path?:string}):Promise<CaptureContext|null>{
 const {data,error}=await db.rpc('home_check_sms_capture_context',{p_action:input.action,p_landlord_id:input.landlordId,p_conversation_id:input.conversationId,p_check_id:input.checkId,p_slot:input.slot??null,p_version:input.version??null,p_claim:input.claim??null,p_media_path:input.path??null})
 if(error)throw new Error('Home Check photo context could not be verified')
 return data?.ok?data as CaptureContext:null
}

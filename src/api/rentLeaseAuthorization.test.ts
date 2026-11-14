import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {postSendLateRentAccountMessage} from './sendLateRentAccountMessage'
import {postSendLeaseRenewalIncentiveMessage} from './sendLeaseRenewalIncentiveMessage'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const params={workflowRunId:'55555555-5555-4555-8555-555555555555',residentId:'11111111-1111-4111-8111-111111111111',residentPhone:'+15550102000',message:'Synthetic only',action:'offer_payment_plan' as const}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://qa.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({ok:true}))})
afterEach(()=>vi.unstubAllEnvs())
for(const invoke of [()=>postSendLateRentAccountMessage(params),()=>postSendLeaseRenewalIncentiveMessage(params)]){
 it('requires session plus temporary bridge',async()=>{await invoke();expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({Authorization:'Bearer synthetic-session','x-admin-reassign-secret':'unit-legacy'})})
 it('missing session asks sign in without network',async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});expect(await invoke()).toEqual({ok:false,error:ADMIN_SESSION_REQUIRED});expect(mocks.fetch).not.toHaveBeenCalled()})
 it('server 401 asks sign in',async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Expired session'},{status:401}));expect(await invoke()).toEqual({ok:false,error:ADMIN_SESSION_REQUIRED})})
}

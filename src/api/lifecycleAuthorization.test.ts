import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {startLifecycleWorkflow} from './lifecycleWorkflow'
import {postTriggerMoveOutFromLeaseRenewal} from './triggerMoveOutFromLeaseRenewal'
import {postStartInsightInspectionScheduling} from './startInsightInspectionScheduling'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const calls=[()=>startLifecycleWorkflow({workflow:'inspection',unitId:'11111111-1111-4111-8111-111111111111'}),()=>postTriggerMoveOutFromLeaseRenewal('55555555-5555-4555-8555-555555555555'),()=>postStartInsightInspectionScheduling({url:'https://qa.invalid/functions/v1/start-insight-inspection-scheduling',landlordId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',insightCardId:'qa-card',actionType:'schedule_inspection'})]
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://qa.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({ok:true,workflow:'inspection',workflow_run_id:'synthetic',lease_renewal_run_id:'synthetic',move_out_run_id:'synthetic',status:'probing',requestId:'synthetic',ticketId:'synthetic',targetDay:'2099-01-01'}))})
afterEach(()=>vi.unstubAllEnvs())
for(const [index,invoke] of calls.entries()){
 it(`lifecycle transport ${index} requires session plus temporary bridge`,async()=>{await invoke();expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({Authorization:'Bearer synthetic-session','x-admin-reassign-secret':'unit-legacy'})})
 it(`lifecycle transport ${index} missing session makes no request`,async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});if(index===2)await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);else expect(await invoke()).toMatchObject({ok:false,error:ADMIN_SESSION_REQUIRED});expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`lifecycle transport ${index} server 401 asks sign in`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Expired session'},{status:401}));if(index===2)await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);else expect(await invoke()).toMatchObject({ok:false,error:ADMIN_SESSION_REQUIRED})})
}

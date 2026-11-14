import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {markUnitVacant,activateUnit,ensureUnitsInDb} from './unitVacancy'
import {postMoveOutWorkflowAction} from './moveOutWorkflowAction'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const calls=[()=>markUnitVacant({unitId:'11111111-1111-4111-8111-111111111111'}),()=>postMoveOutWorkflowAction({workflowRunId:'55555555-5555-4555-8555-555555555555',action:'complete_cleaning'}),()=>activateUnit({unitId:'11111111-1111-4111-8111-111111111111',skipTenantRegistration:true})]
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://qa.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');vi.stubEnv('VITE_F08_LEGACY_ADMIN_COMPAT','true');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({ok:true,unitId:'synthetic-unit',residentId:null}))})
afterEach(()=>vi.unstubAllEnvs())
for(const [index,invoke] of calls.entries()){
 it(`move-out transport ${index} uses session-only headers even with compatibility enabled`,async()=>{await invoke();expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-session');expect(mocks.fetch.mock.calls[0][1].headers['x-admin-reassign-secret']).toBeUndefined()})
 it(`move-out transport ${index} missing session makes no request`,async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});expect(await invoke()).toMatchObject({ok:false,error:ADMIN_SESSION_REQUIRED});expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`move-out transport ${index} server 401 asks sign in again`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Expired session'},{status:401}));expect(await invoke()).toMatchObject({ok:false,error:ADMIN_SESSION_REQUIRED})})
}

it("unit synchronization delegates to the already session-only registration API without the old secret",async()=>{vi.stubEnv("VITE_ADMIN_REASSIGN_SECRET", "");expect(await ensureUnitsInDb([{unitLabel:"QA",building:null}])).toBe(true);expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-session");expect(mocks.fetch.mock.calls[0][1].headers["x-admin-reassign-secret"]).toBeUndefined()})

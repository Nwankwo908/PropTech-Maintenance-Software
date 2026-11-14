import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {takeOverConversation,releaseConversationTakeover,sendConversationSms} from './adminConversationSms'
import {sendTenantActivationSms} from './tenantActivation'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const calls=[()=>takeOverConversation('55555555-5555-4555-8555-555555555555'),()=>releaseConversationTakeover('55555555-5555-4555-8555-555555555555'),()=>sendConversationSms('55555555-5555-4555-8555-555555555555','Synthetic only'),()=>sendTenantActivationSms({residentIds:['11111111-1111-4111-8111-111111111111']})]
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://qa.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');vi.stubEnv('VITE_F08_LEGACY_ADMIN_COMPAT','true');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({ok:true,conversation_id:'synthetic'}))})
afterEach(()=>vi.unstubAllEnvs())
for(const [index,invoke] of calls.entries()){
 it(`core-SMS transport ${index} requires session-only transport even with compatibility enabled`,async()=>{await invoke();expect(mocks.fetch.mock.calls[0][1].headers).toEqual({'Content-Type':'application/json',apikey:'unit-anon',Authorization:'Bearer synthetic-session'})})
 it(`core-SMS transport ${index} missing session makes no request`,async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});if(index===3)expect(await invoke()).toMatchObject({ok:false,error:ADMIN_SESSION_REQUIRED});else await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`core-SMS transport ${index} server 401 asks sign in again`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Expired session'},{status:401}));if(index===3)expect(await invoke()).toMatchObject({ok:false,error:ADMIN_SESSION_REQUIRED});else await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED)})
}

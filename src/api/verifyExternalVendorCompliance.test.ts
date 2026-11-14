import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {lookupExternalVendorComplianceChecks,attestExternalVendorLicense,attestExternalVendorCoi} from './verifyExternalVendorCompliance'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const calls=[()=>lookupExternalVendorComplianceChecks({name:'Synthetic QA'}),()=>attestExternalVendorLicense({subject:{name:'Synthetic QA'},licenseNumber:'QA-ONLY'}),()=>attestExternalVendorCoi({subject:{name:'Synthetic QA'}})]
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://qa.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockResolvedValue(Response.json({license:{simulated:true},coi:{simulated:true}}))})
afterEach(()=>vi.unstubAllEnvs())
for(const [index,invoke] of calls.entries()){
 it(`compliance transport ${index} includes session, temporary bridge and active account`,async()=>{await invoke();const options=mocks.fetch.mock.calls[0][1];expect(options.headers).toMatchObject({Authorization:'Bearer synthetic-session','x-admin-reassign-secret':'unit-legacy'});expect(JSON.parse(options.body).landlordId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')})
 it(`compliance transport ${index} missing session sends nothing`,async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`compliance transport ${index} 401 requests signin`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Expired session'},{status:401}));await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED)})
}

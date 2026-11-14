import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {sendLandlordOnboardingWelcome} from './landlordOnboardingWelcome'
import {sendSettingsTestNotification} from './settingsTestNotification'
import {sendVendorInvite,notifyVendorOnboardingOverrideActivated,dispatchUnassignedJobsAfterVendorOverride} from './vendorVerification'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const calls=[()=>sendLandlordOnboardingWelcome({}),()=>sendSettingsTestNotification({channel:'email'}),()=>sendVendorInvite({landlordId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',businessName:'QA',email:'qa@example.invalid',channel:'email'}),()=>notifyVendorOnboardingOverrideActivated({landlordId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',vendorId:'77777777-7777-4777-8777-777777777777'}),()=>dispatchUnassignedJobsAfterVendorOverride({landlordId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',vendorId:'77777777-7777-4777-8777-777777777777'})]
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://qa.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({ok:true,delivery:{email:'sent'},sms:'skipped',assignedCount:0}))})
afterEach(()=>vi.unstubAllEnvs())
for(const [index,invoke] of calls.entries()){
 it(`notification transport ${index} requires session and bridge`,async()=>{await invoke();expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({Authorization:'Bearer synthetic-session','x-admin-reassign-secret':'unit-legacy'})})
 it(`notification transport ${index} no session makes no request`,async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});if(index<2)expect((await invoke() as {error:string}).error).toBe(ADMIN_SESSION_REQUIRED);else await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED);expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`notification transport ${index} 401 asks sign-in`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Expired session'},{status:401}));if(index<2)expect((await invoke() as {error:string}).error).toBe(ADMIN_SESSION_REQUIRED);else await expect(invoke()).rejects.toThrow(ADMIN_SESSION_REQUIRED)})
}

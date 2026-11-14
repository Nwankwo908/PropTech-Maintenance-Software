import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/lib/activeLandlord',()=>({getActiveLandlordId:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {fetchLandlordStripeConnectStatus} from './landlordStripeConnect'
import {createInvoicePaymentCheckout} from './invoicePaymentCheckout'
const actions=[()=>fetchLandlordStripeConnectStatus(),()=>createInvoicePaymentCheckout({invoiceId:'11111111-1111-4111-8111-111111111111',paymentMethod:'card'})]
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_URL','https://fixture.invalid');vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');mocks.getSession.mockResolvedValue({data:{session:{access_token:'unit-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({ok:true,url:'https://checkout.invalid',sessionId:'cs_unit'}))})
afterEach(()=>vi.unstubAllEnvs())
for(const [index,action] of actions.entries()){
 it(`financial caller ${index} requires a session and preserves the rollout bridge`,async()=>{await action();const h=mocks.fetch.mock.calls[0][1].headers;expect(h.Authorization).toBe('Bearer unit-session');expect(h['x-admin-reassign-secret']).toBe('unit-legacy')})
 for(const session of [null,{access_token:'expired',expires_at:1}])it(`financial caller ${index} blocks unusable session ${JSON.stringify(session)}`,async()=>{mocks.getSession.mockResolvedValue({data:{session},error:null});await expect(action()).rejects.toThrow('Please sign in again');expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`financial caller ${index} gives a sign-in-again message on server 401`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Unauthorized'},{status:401}));await expect(action()).rejects.toThrow('Please sign in again')})
}

import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),fetch:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:mocks.getSession}}}))
vi.mock('@/api/adminReassignVendor',()=>({fetchAdminEdgeFunction:mocks.fetch}))
import {getThumbtackOauthStatus,startThumbtackOauth,exchangeThumbtackOauth} from './thumbtackOauth'
import {ADMIN_SESSION_REQUIRED} from '@/lib/adminSessionHeaders'
const common={url:'https://qa.invalid/oauth',landlordId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',returnOrigin:'https://www.ulohome.io',code:'synthetic-code',state:'synthetic-state'}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VITE_SUPABASE_ANON_KEY','unit-anon-key');vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET','unit-legacy');vi.stubEnv('VITE_F08_LEGACY_ADMIN_COMPAT','true');mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-session',expires_at:Date.now()/1000+3600}},error:null});mocks.fetch.mockImplementation(async()=>Response.json({connected:false,ok:true}))})
afterEach(()=>vi.unstubAllEnvs())
for(const invoke of [getThumbtackOauthStatus,startThumbtackOauth,exchangeThumbtackOauth]){
 it(`${invoke.name} uses only the required session even with compatibility enabled`,async()=>{await invoke(common);expect(mocks.fetch.mock.calls[0][1].headers).toEqual({'Content-Type':'application/json',apikey:'unit-anon-key',Authorization:'Bearer synthetic-session'})})
 it(`${invoke.name} refuses no session without network`,async()=>{mocks.getSession.mockResolvedValue({data:{session:null},error:null});await expect(invoke(common)).rejects.toThrow(ADMIN_SESSION_REQUIRED);expect(mocks.fetch).not.toHaveBeenCalled()})
 it(`${invoke.name} maps 401 to sign in again`,async()=>{mocks.fetch.mockResolvedValue(Response.json({error:'Invalid session'},{status:401}));await expect(invoke(common)).rejects.toThrow(ADMIN_SESSION_REQUIRED)})
}

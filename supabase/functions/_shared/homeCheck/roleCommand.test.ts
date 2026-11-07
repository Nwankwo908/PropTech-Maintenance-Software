import { expect, it, vi } from 'vitest'
import { homeCheckRecipientCommand } from './roleCommand.ts'
it.each(['vendor','resident'])('denies %s initiation without querying or changing check state',async role=>{
 const from=vi.fn(()=>{throw new Error('No records should be queried')})
 const rpc=vi.fn(()=>{throw new Error('No records should be changed')})
 const ctx:any={identity:{identity_type:role},landlordId:'account',inbound:{from:'+14708880274',to:'+18775803356'},supabase:{from,rpc}}
 expect(await homeCheckRecipientCommand(ctx)).toBe('Only your property team can request a Home Check. You can accept or decline a Home Check invitation they send you.')
 expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled()
})
it('does not grant initiation to an unknown identity',async()=>{
 expect(await homeCheckRecipientCommand({identity:{identity_type:'unknown'}} as never)).toContain('Only a registered landlord or authorized property-team member')
})

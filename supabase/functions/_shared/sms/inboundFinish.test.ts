import { beforeEach, expect, it, vi } from 'vitest'
import { trySendAutoReply } from './inboundFinish.ts'
import { shouldTripOutboundCircuit } from './sms_inbound_guard.ts'
import { notifyLandlordNeedsAttention } from '../landlordAttentionNotify.ts'
import { sendInboundAutoReply } from './inboundReply.ts'
vi.mock('../graph/logGraphEvent.ts', () => ({ logGraphEvent: vi.fn() }))
vi.mock('../graph/recordActivityLog.ts', () => ({ recordActivityLog: vi.fn() }))
vi.mock('../landlordAttentionNotify.ts', () => ({ notifyLandlordNeedsAttention: vi.fn() }))
vi.mock('./workflow_router.ts', () => ({ actorIdForIdentity: vi.fn(), actorTypeForIdentity: vi.fn() }))
vi.mock('./inboundReply.ts', () => ({ resolveInboundAutoReplyBody: (_a: unknown, b: string) => b, sendInboundAutoReply: vi.fn(async () => ({ ok: true, messageId: 'sent' })) }))
vi.mock('../vendor_schedule_fsm.ts', () => ({ readVendorScheduleFsm: vi.fn() }))
vi.mock('./sms_inbound_guard.ts', () => ({ shouldTripOutboundCircuit: vi.fn(async () => ({ trip: false })), normalizeOutboundForLoopCompare: (s: string) => s }))
vi.mock('./tenantDistress.ts', () => ({ clearOutboundLoopFlag: vi.fn(), OUTBOUND_LOOP_FLAG_KEY: 'loop' }))
vi.mock('./replyLoopAttention.ts', () => ({ buildReplyLoopAttention: vi.fn(), loadReplyLoopContext: vi.fn(), replyLoopNeedsIntervention: vi.fn(() => true) }))
const params = { conversationId: 'conv', landlordId: 'owner', uloNumber: '+15550001111', externalPhone: '+15551112222', provider: 'twilio' as const, workflowHint: 'What does this photo show?', source: 'home_check', workflowRoute: 'home_check', inboundMessageId: 'exact-inbound' }
const db = { from: () => { const q: any = { select: () => q, update: () => q, eq: () => q, maybeSingle: async () => ({ data: {} }) }; return q } }
beforeEach(() => vi.clearAllMocks())
it('passes the exact Home Check inbound to the duplicate guard and sends its clarification', async () => {
 expect(await trySendAutoReply(db as never, params)).toBe('sent')
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db, expect.objectContaining({ replyToInboundId: 'exact-inbound' }))
 expect(sendInboundAutoReply).toHaveBeenCalledOnce()
 expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled()
})
it('a duplicate Home Check reply stays suppressed without a misleading repair alert', async () => {
 vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({ trip: true, reason: 'identical_reply_loop' })
 expect(await trySendAutoReply(db as never, params)).toBeUndefined()
 expect(sendInboundAutoReply).not.toHaveBeenCalled()
 expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled()
})
it('other workflows retain their normal duplicate window', async () => {
 await trySendAutoReply(db as never, { ...params, workflowRoute: 'resident_intake', source: 'resident' })
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db, expect.objectContaining({ replyToInboundId: undefined }))
})

it('a fresh handoff acknowledgement is scoped to its inbound and does not escalate again', async () => {
 await trySendAutoReply(db as never, { ...params, workflowRoute: 'sms_routed_to_landlord', source: 'sms_routed_to_landlord' })
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db, expect.objectContaining({ replyToInboundId: 'exact-inbound' }))
 expect(sendInboundAutoReply).toHaveBeenCalledOnce()
 expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled()
})
it('a retried handoff acknowledgement stays suppressed without a second landlord alert', async () => {
 vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({ trip: true, reason: 'identical_reply_loop' })
 await trySendAutoReply(db as never, { ...params, workflowRoute: 'sms_routed_to_landlord', source: 'sms_routed_to_landlord' })
 expect(sendInboundAutoReply).not.toHaveBeenCalled()
 expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled()
})

it('sends conversational text without a repeated letter-style greeting', async () => {
 await trySendAutoReply(db as never, { ...params, workflowHint: "Hi QA,\n\nI may have misunderstood. What did I get wrong about your request?" })
 expect(sendInboundAutoReply).toHaveBeenCalledWith(db, expect.objectContaining({body: "I may have misunderstood. What did I get wrong about your request?"}))
})

it('recovery stays scoped to the inbound and a retry does not alert staff', async () => {
 await trySendAutoReply(db as never,{...params,workflowRoute:'sms_recovery',source:'sms_recovery'});
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db,expect.objectContaining({replyToInboundId:'exact-inbound'}));
 vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({trip:true,reason:'identical_reply_loop'});
 await trySendAutoReply(db as never,{...params,workflowRoute:'sms_recovery',source:'sms_recovery'});
 expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled();
});

for (const route of ['sms_handoff_clarify','sms_handoff_unavailable','sms_handoff_cancelled']) {
 it(`${route}: fresh inbound gets a response; retry never creates a staff alert`,async()=>{
  await trySendAutoReply(db as never,{...params,workflowRoute:route,source:route});
  expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db,expect.objectContaining({replyToInboundId:'exact-inbound'}));
  expect(sendInboundAutoReply).toHaveBeenCalledOnce();
  vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({trip:true,reason:'identical_reply_loop'});
  await trySendAutoReply(db as never,{...params,workflowRoute:route,source:route});
  expect(sendInboundAutoReply).toHaveBeenCalledOnce();
  expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled();
 });
}

it('explicit SUMMARY is scoped to its new inbound and a retry does not alert the landlord',async()=>{
 const summary={...params,workflowRoute:'resident_maintenance_intake',source:'workflow_resident_maintenance_intake',inboundBody:'Summary',workflowHint:"Here's your request. Reply YES to submit."};
 await trySendAutoReply(db as never,summary);
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db,expect.objectContaining({replyToInboundId:'exact-inbound'}));
 expect(sendInboundAutoReply).toHaveBeenCalledOnce();
 vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({trip:true,reason:'identical_reply_loop'});
 await trySendAutoReply(db as never,summary);
 expect(sendInboundAutoReply).toHaveBeenCalledOnce();expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled();
});
it('normal repair prompts retain the thread loop window',async()=>{
 await trySendAutoReply(db as never,{...params,workflowRoute:'resident_maintenance_intake',source:'workflow_resident_maintenance_intake',inboundBody:'No'});
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db,expect.objectContaining({replyToInboundId:undefined}));
});

it('suppressed ordinary replies keep internal diagnostics without contacting the landlord',async()=>{
 vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({trip:true,reason:'identical_reply_loop'});
 await trySendAutoReply(db as never,{...params,workflowRoute:'resident_maintenance_intake',source:'workflow_resident_maintenance_intake',inboundBody:'No'});
 expect(sendInboundAutoReply).not.toHaveBeenCalled();expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled();
});

it('each deliberate repeated submission YES gets an acknowledgment, while retry suppression never alerts the landlord',async()=>{
 const ack={...params,workflowRoute:'resident_maintenance_intake',source:'resident_submitted_confirmation',inboundBody:'YES',workflowHint:"This repair is already submitted. Ref: 0FC8740E"};
 await trySendAutoReply(db as never,ack);
 await trySendAutoReply(db as never,{...ack,inboundMessageId:'next-inbound'});
 expect(shouldTripOutboundCircuit).toHaveBeenNthCalledWith(1,db,expect.objectContaining({replyToInboundId:'exact-inbound'}));
 expect(shouldTripOutboundCircuit).toHaveBeenNthCalledWith(2,db,expect.objectContaining({replyToInboundId:'next-inbound'}));
 expect(sendInboundAutoReply).toHaveBeenCalledTimes(2);
 vi.mocked(shouldTripOutboundCircuit).mockResolvedValueOnce({trip:true,reason:'identical_reply_loop'});
 await trySendAutoReply(db as never,{...ack,inboundMessageId:'next-inbound'});
 expect(sendInboundAutoReply).toHaveBeenCalledTimes(2);
 expect(notifyLandlordNeedsAttention).not.toHaveBeenCalled();
});
it('an ordinary first submission YES keeps normal thread-level loop protection',async()=>{
 await trySendAutoReply(db as never,{...params,workflowRoute:'resident_maintenance_intake',source:'workflow_resident_maintenance_intake',inboundBody:'YES'});
 expect(shouldTripOutboundCircuit).toHaveBeenCalledWith(db,expect.objectContaining({replyToInboundId:undefined}));
});

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
const db = { from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: {} }) }; return q } }
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

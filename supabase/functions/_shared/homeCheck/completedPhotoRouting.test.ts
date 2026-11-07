vi.mock('../vendor_availability_parse.ts',()=>({parseAvailabilityResolved:vi.fn()}))
import { reduceHomeCheckGuide } from './guide.ts'
import { identifyVendorHomeCheckBatch } from './vendorBatch.ts'
vi.mock('./vendorBatch.ts', () => ({ identifyVendorHomeCheckBatch: vi.fn(async () => null) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actHomeCheckSms,
  prepareHomeCheckSms,
  resolveHomeCheckLandlord,
  runHomeCheckReminder,
} from './sms.ts'
import { homeCheckEvent, createHomeCheck, sendHomeCheckSms, uploadHomeCheckPhoto, analyzeHomeCheckBatch, saveHomeCheckAnswers, pendingHomeCheckSystems, notifyHomeCheckResult, confirmHomeCheck, loadHomeCheck } from './service.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'
import { isLandlordAccountOrOpsPhone } from '../sms/landlordAccountPhone.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

vi.mock('../sms/inbound_db.ts', () => ({ normalizeSmsPhone: (phone: string) => phone }))
vi.mock('./visitAct.ts', () => ({
  prepareHomeCheckVisitReply: vi.fn(async () => null),
  applyHomeCheckVisitReply: vi.fn(async () => ''),
  startDueHomeCheckPhotoPrompts: vi.fn(async () => 0),
  sendHomeCheckVendorAcceptance: vi.fn(async () => ({ deliveryError: null, alreadySent: false })),
}))
vi.mock('./photoSlot.ts', () => ({ readHomeCheckPhoto: vi.fn(async () => null) }))
vi.mock(
  '../sms/landlordAccountPhone.ts',
  () => ({ isLandlordAccountOrOpsPhone: vi.fn(async () => true) }),
)
vi.mock('./service.ts', () => ({
  homeCheckEvent: vi.fn(async () => {}),
  requireData: ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) throw error
    return data
  },
  checkLocation: (check: { property_label: string; unit_label: string }) =>
    `${check.property_label} / ${check.unit_label}`,
  checked: (value: PromiseLike<unknown>) => Promise.resolve(value),
  sendHomeCheckSms: vi.fn(async () => {}),
  confirmHomeCheck: vi.fn(async () => {}),
  loadHomeCheck: vi.fn(async () => ({...pending,confirmed_at:null})),
  pendingHomeCheckSystems: vi.fn(async () => []),
  saveHomeCheckAnswers: vi.fn(async () => true),
  notifyHomeCheckResult: vi.fn(async () => true),
  rebuildHomeCheckAssets: vi.fn(async () => []),
  uploadHomeCheckPhoto: vi.fn(async () => ({ feedback: [] })),
  analyzeHomeCheckBatch: vi.fn(async () => ({ feedback: [] })),
  createHomeCheck: vi.fn(async () => ({
    check: { ...pending, role: 'landlord', workflow_run_id: 'run' },
    link: 'https://app.ulohome.io/c/check#fixture',
    deliveryError: null,
  })),
}))

import {prepareCompletedPhoto,actCompletedPhoto} from './completedPhoto.ts'
vi.mock('./completedPhoto.ts',()=>({prepareCompletedPhoto:vi.fn(async()=>null),actCompletedPhoto:vi.fn(async()=>({reply:'Context-aware clarification'}))}))
const pending={id:'check',landlord_id:'account',ticket_id:'ticket',role:'contractor'}
it('dispatches completed-photo clarification before the generic job fallback',async()=>{
 const action={kind:'completed_photo',check:pending,conversationId:'thread',vendorId:'vendor',phone:'+15550000001',line:'+15550000002',originalMessageId:'photo',body:'',phase:'initial',newPhoto:true}
 vi.mocked(prepareCompletedPhoto).mockResolvedValueOnce(action as never)
 const ctx={supabase:{},landlordId:'account',identity:{identity_type:'vendor',vendor_id:'vendor'},inbound:{body:'',mediaUrls:['sms/photo.jpg'],from:'+15550000001',to:'+15550000002'},messageId:'photo',conversationId:'thread'}
 expect(await prepareHomeCheckSms(ctx as never)).toEqual(action)
 expect(await actHomeCheckSms({} as never,'account',action as never)).toEqual({reply:'Context-aware clarification'})
 expect(actCompletedPhoto).toHaveBeenCalledWith({},action)
})

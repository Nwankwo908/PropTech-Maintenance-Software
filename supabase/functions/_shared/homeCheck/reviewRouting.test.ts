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

import {prepareHomeCheckReview} from './reviewSelection.ts'
vi.mock('./reviewSelection.ts',()=>({prepareHomeCheckReview:vi.fn(async()=>null)}))
const pending={id:'tenant-check',property_label:'200 Test Lane',unit_label:'1',landlord_id:'account',role:'tenant',answers:{warningSigns:false},workflow_run_id:'run'}
it.each(['RESULTS','OK'])('routes landlord %s to the reviewed tenant check before generic photo capture',async body=>{
 const action={kind:body==='RESULTS'?'results':'confirm',check:pending}
 vi.mocked(prepareHomeCheckReview).mockResolvedValueOnce(action as never)
 const builder:any={select:()=>builder,eq:()=>builder,maybeSingle:async()=>({data:{intake_state:{}},error:null})}
 const ctx={supabase:{from:()=>builder},landlordId:'account',identity:{identity_type:'landlord'},inbound:{body,mediaUrls:[],from:'+14705246084',to:'+18775803356'},conversationId:'thread'}
 expect(await prepareHomeCheckSms(ctx as never)).toEqual(action)
 expect(vi.mocked(prepareHomeCheckReview).mock.calls.at(-1)?.[0]).toBe(ctx)
})

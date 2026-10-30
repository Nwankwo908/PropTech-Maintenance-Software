import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHomeCheck, publicHomeCheck, pendingHomeCheckSystems, notifyHomeCheckResult, saveHomeCheckAnswers } from './service.ts'
import { resolveOutboundLandlordSmsLine } from '../sms/landlordSmsOnboarding.ts'
import { isLandlordAccountOrOpsPhone } from '../sms/landlordAccountPhone.ts'
import { sendInboundAutoReply } from '../sms/inboundReply.ts'

vi.mock('./equipmentPair.ts', () => ({ analyzeHomeCheckEquipmentPair: vi.fn() }))
vi.mock(
  '../vision/ingestInspectionUpload.ts',
  () => ({ inspectionBytesToBase64: vi.fn(), processInspectionUpload: vi.fn() }),
)
vi.mock(
  '../engine/workflowRuns.ts',
  () => ({ logPipelineStageEvent: vi.fn(), updateWorkflowRun: vi.fn() }),
)
vi.mock(
  '../engine/startMaintenanceRequestWorkflow.ts',
  () => ({ startMaintenanceRequestWorkflow: vi.fn() }),
)
vi.mock('../uloAppUrl.ts', () => ({ uloAppOrigin: () => 'https://app.ulohome.io' }))
vi.mock(
  '../sms/inbound_db.ts',
  () => ({
    normalizeSmsPhone: (phone: string) => phone,
    findOrCreateConversation: vi.fn(async () => ({ conversationId: 'thread' })),
  }),
)
vi.mock(
  '../sms/inboundReply.ts',
  () => ({
    sendInboundAutoReply: vi.fn(async () => ({
      ok: true,
      messageId: 'sent',
      providerMessageSid: 'fixture',
    })),
  }),
)
vi.mock(
  '../sms/landlordSmsOnboarding.ts',
  () => ({
    resolveOutboundLandlordSmsLine: vi.fn(async () => ({ id: 'line', phone: '+15550001111' })),
  }),
)
vi.mock(
  '../sms/landlordAccountPhone.ts',
  () => ({ isLandlordAccountOrOpsPhone: vi.fn(async () => true) }),
)

function client(
  ownerPhone: string | null = '+15553334444',
  vendorPhone: string | null = '+15558889999',
  openChecks: Array<Record<string, unknown>> = [],
) {
  let check: Record<string, unknown> | null = openChecks[0] ?? null
  const updates: Array<Record<string, unknown>> = []
  const rpc = vi.fn(async (_name: string, args: { p_input: Record<string, unknown> }) => {
    if (_name === 'home_check_sms_capture_context') return { data: { ok: true, checkId: check?.id, slot: 'water_heater_label', version: 'v' }, error: null }
    check = { ...args.p_input, workflow_run_id: 'workflow', status: 'collecting' }
    return { data: null, error: null }
  })
  return {
    rpc,
    updates,
    from(table: string) {
      let single = false
      let mutation = false
      const result = () => ({
        error: null,
        data: mutation
          ? null
          : table === 'properties'
          ? { id: 'birch', name: 'Birch', street_address: '1 Main St' }
          : table === 'units'
          ? { id: 'birch-12a', unit_label: '12A' }
          : table === 'landlords'
          ? { name: 'Owner', phone: ownerPhone }
          : table === 'vendors'
          ? { id: 'vendor', phone: vendorPhone, active: true, roster_status: 'active' }
          : table === 'home_checks'
          ? single ? check : openChecks
          : [],
      })
      const builder: Record<string, unknown> = {
        then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(result())),
      }
      for (const method of ['select', 'eq', 'gte', 'gt', 'is']) builder[method] = () => builder
      for (const method of ['insert', 'update']) {
        builder[method] = (value: Record<string, unknown>) => {
          mutation = true
          if (method === 'update' && table === 'home_checks') updates.push(value)
          return builder
        }
      }
      builder.single = () => {
        single = true
        return builder
      }
      return builder
    },
  }
}
const request = {
  landlordId: 'landlord',
  propertyId: 'birch',
  unitId: 'birch-12a',
  role: 'landlord' as const,
  authorizedBy: 'sms:message',
  sendSms: true,
}
describe('SMS self-capture recipient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(true)
  })
  it('stores and texts the authorized team member who initiated the inspection', async () => {
    const db = client()
    const result = await createHomeCheck(db as never, {
      ...request,
      selfCapturePhone: '+15551112222',
    })
    expect(result.deliveryError).toBeNull()
    expect(db.rpc).toHaveBeenCalledWith(
      'create_home_check',
      expect.objectContaining({
        p_input: expect.objectContaining({
          landlord_id: 'landlord',
          property_id: 'birch',
          unit_id: 'birch-12a',
          recipient_phone: '+15551112222',
          authorized_by: 'sms:message',
        }),
      }),
    )
    expect(sendInboundAutoReply).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        toNumber: '+15551112222',
        fromNumber: '+15550001111',
        body: expect.stringContaining('Your Home Check for Birch'),
      }),
    )
    expect(isLandlordAccountOrOpsPhone).toHaveBeenCalledWith(db, {
      fromNumber: '+15551112222',
      landlordId: 'landlord',
    })
  })
  it('supports authorized team self-capture when the owner has no saved phone', async () => {
    expect(
      (await createHomeCheck(client(null) as never, {
        ...request,
        selfCapturePhone: '+15551112222',
      })).deliveryError,
    ).toBeNull()
    expect(sendInboundAutoReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toNumber: '+15551112222' }),
    )
  })
  it('rechecks authorization before creating a check or sending a link', async () => {
    const db = client()
    vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(false)
    await expect(createHomeCheck(db as never, { ...request, selfCapturePhone: '+15559999999' }))
      .rejects.toThrow('registered phone number')
    expect(db.rpc).not.toHaveBeenCalled()
    expect(sendInboundAutoReply).not.toHaveBeenCalled()
  })
  it('retains the owner recipient for dashboard requests without an SMS initiator', async () => {
    const db = client()
    await createHomeCheck(db as never, request)
    expect(sendInboundAutoReply).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ toNumber: '+15553334444' }),
    )
    expect(isLandlordAccountOrOpsPhone).not.toHaveBeenCalled()
  })
  it('stores a property-level dashboard check without a capture link or a text', async () => {
    const db = client()
    const result = await createHomeCheck(db as never, {
      landlordId: 'landlord',
      propertyId: 'birch',
      unitId: null,
      role: 'landlord',
      authorizedBy: 'user',
      sendSms: false,
      publishLink: false,
    })
    expect(result.link).toBeNull()
    expect(result.deliveryError).toBeNull()
    expect(db.rpc).toHaveBeenCalledWith(
      'create_home_check',
      expect.objectContaining({
        p_input: expect.objectContaining({
          property_id: 'birch',
          unit_id: null,
          role: 'landlord',
          token_hash: expect.any(String),
        }),
      }),
    )
    expect(sendInboundAutoReply).not.toHaveBeenCalled()
    expect(resolveOutboundLandlordSmsLine).not.toHaveBeenCalled()
  })
  it('sends MMS instructions only to the selected vendor without a retired link', async () => {
    const db = client()
    await createHomeCheck(db as never, {
      ...request, role: 'contractor', vendorId: 'vendor',
      jobWindowEnd: new Date(Date.now() + 86400000).toISOString(),
    })
    expect(sendInboundAutoReply).toHaveBeenCalledTimes(1)
    expect(sendInboundAutoReply).toHaveBeenCalledWith(db, expect.objectContaining({
      toNumber: '+15558889999',
      body: expect.stringContaining('No caption or code needed'),
    }))
    const body = vi.mocked(sendInboundAutoReply).mock.calls[0][1].body
    expect(body).not.toContain('/c/')
    expect(body).not.toMatch(/HC-[A-F0-9]{12}/)
    expect(body).toContain('Reply with the photo here')
    expect(body).toContain('No repairs are authorized')
    expect(body).not.toContain('For text photos:')
    expect(body).not.toContain('Forward this')
    expect(body).not.toContain('filter dates')
    expect(body).not.toContain('Last service')
    expect(body).not.toMatch(/https?:\/\//)
  })
  it('does not forward a contractor link to the owner when no vendor is selected', async () => {
    const db = client()
    await expect(createHomeCheck(db as never, {
      ...request, role: 'contractor',
      jobWindowEnd: new Date(Date.now() + 86400000).toISOString(),
    })).rejects.toThrow('Choose a contractor')
    expect(db.rpc).not.toHaveBeenCalled()
    expect(sendInboundAutoReply).not.toHaveBeenCalled()
  })
  it('does not fall back to the owner when the selected vendor has no phone', async () => {
    const db = client('+15553334444', null)
    await expect(createHomeCheck(db as never, {
      ...request, role: 'contractor', vendorId: 'vendor',
      jobWindowEnd: new Date(Date.now() + 86400000).toISOString(),
    })).rejects.toThrow('active contractor with a phone number')
    expect(db.rpc).not.toHaveBeenCalled()
    expect(sendInboundAutoReply).not.toHaveBeenCalled()
  })
  it('reuses the open check for the same place and person instead of creating a second one', async () => {
    const open = {
      id: 'open-check',
      reference: 'HC-OPENCHECK001',
      landlord_id: 'landlord',
      ulo_number: '+15550001111',
      role: 'landlord',
      unit_id: 'birch-12a',
      recipient_phone: '+15551112222',
      vendor_id: null,
      status: 'collecting',
      workflow_run_id: 'workflow',
      property_label: 'Birch',
      unit_label: '12A',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }
    const db = client('+15553334444', '+15558889999', [open])
    const result = await createHomeCheck(db as never, { ...request, selfCapturePhone: '+15551112222' })
    expect(db.rpc).not.toHaveBeenCalledWith('create_home_check', expect.anything())
    expect(result.check.id).toBe('open-check')
    expect(result.link).toBeNull()
    expect(db.updates).toContainEqual(expect.objectContaining({ token_hash: expect.any(String) }))
    expect(sendInboundAutoReply).toHaveBeenCalledWith(db, expect.objectContaining({ toNumber: '+15551112222' }))
  })
  it('still creates a check when the open one is for someone else', async () => {
    const open = {
      id: 'tenant-check',
      role: 'landlord',
      unit_id: 'birch-12a',
      recipient_phone: '+15550000000',
      created_at: new Date().toISOString(),
    }
    const db = client('+15553334444', '+15558889999', [open])
    await createHomeCheck(db as never, { ...request, selfCapturePhone: '+15551112222' })
    expect(db.rpc).toHaveBeenCalledWith('create_home_check', expect.anything())
  })
})


it.each([
  ['Photos do not match the selected equipment.', 'system_mismatch'],
  ['Label unreadable', 'label_unreadable'],
])('exposes structured retake feedback for %s even without model copy', async (basis, reason) => {
 const db = { from: (table: string) => {
   const q: any = { select: () => q, eq: () => q, in: () => q,
     then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ error: null, data:
       table === 'home_check_photos' ? [{ slot: 'water_heater_label', inspection_photo_id: 'photo' }] :
       [{ id: 'photo', status: 'needs_review', ai_result: { estimatedAge: { basis }, labelReadability: { retakeRequested: true } } }]
     })) }
   return q
 } }
 const progress = await publicHomeCheck(db as never, { id: 'check', property_label: 'Birch' } as never)
 expect(progress.feedback[0]).toMatchObject({ retakeReason: reason, retakeMessage: 'A clearer equipment label photo is needed.' })
})

it.each([false,true])('checks readiness from all four current photo records, pending=%s',async(pending)=>{
 const slots=['water_heater_label','water_heater_whole','heating_label','heating_whole']
 const db={from:(table:string)=>{
  const q:any={select:()=>q,eq:()=>q,in:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({error:null,data:table==='home_check_photos'?slots.map(slot=>({slot,inspection_photo_id:slot})):slots.map(id=>({id,status:pending&&id==='heating_whole'?'queued':'needs_review',ai_result:pending&&id==='heating_whole'?null:{category:'hvac'}}))}))};return q
 }}
 expect(await pendingHomeCheckSystems(db as never,'check')).toEqual(pending?['heating']:[])
})

it('failed Results delivery remains retryable and never claims the summary was sent',async()=>{
 const db=client()
 vi.mocked(sendInboundAutoReply).mockResolvedValueOnce({ok:false,error:'provider unavailable'})
 const sent=await notifyHomeCheckResult(db as never,{id:'check',landlord_id:'landlord',role:'landlord',ulo_number:'+15550001111',recipient_phone:'+15553334444',property_label:'Birch',completed_at:new Date().toISOString(),summary_sent_at:null,answers:{warningSigns:false,warningDetails:'',lastService:'',lastFilterChange:''}} as never,[])
 expect(sent).toBe(false)
 expect(db.updates.some(row=>'summary_sent_at' in row)).toBe(false)
})

it('persisting observations after a preview does not send the equipment summary again',async()=>{
 const check={id:'check',landlord_id:'landlord',property_label:'Birch',role:'landlord',ulo_number:'+15550001111',recipient_phone:'+15553334444',expires_at:new Date(Date.now()+86400000).toISOString(),completed_at:new Date().toISOString(),summary_sent_at:new Date().toISOString(),answers:{warningSigns:false,warningDetails:'',lastService:'',lastFilterChange:''}}
 const db={rpc:vi.fn(async(name:string)=>({error:null,data:name==='persist_home_check_assets'?true:null})),from:(table:string)=>{
  const q:any={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,update:()=>q,insert:()=>q,single:()=>Promise.resolve({error:null,data:check}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({error:null,data:table==='landlords'?{phone:'+15553334444'}:[]}))};return q
 }}
 vi.mocked(sendInboundAutoReply).mockClear()
 expect(await saveHomeCheckAnswers(db as never,check as never,check.answers,{notifyResults:false})).toBe(true)
 expect(sendInboundAutoReply).not.toHaveBeenCalled()
})

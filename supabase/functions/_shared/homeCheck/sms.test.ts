import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actHomeCheckSms,
  prepareHomeCheckSms,
  resolveHomeCheckLandlord,
  runHomeCheckReminder,
} from './sms.ts'
import { createHomeCheck, sendHomeCheckSms, uploadHomeCheckPhoto, saveHomeCheckAnswers, pendingHomeCheckSystems, notifyHomeCheckResult, confirmHomeCheck, loadHomeCheck } from './service.ts'
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
  createHomeCheck: vi.fn(async () => ({
    check: { ...pending, role: 'landlord', workflow_run_id: 'run' },
    link: 'https://app.ulohome.io/c/check#fixture',
    deliveryError: null,
  })),
}))
function query(data: unknown) {
  const filters: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve(resolve({ data, error: null })),
  }
  for (const method of ['select', 'eq', 'in', 'gt', 'not', 'is', 'update', 'contains', 'limit', 'order']) {
    builder[method] = (...args: unknown[]) => {
      filters.push([method, args])
      return builder
    }
  }
  builder.maybeSingle = () =>
    Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })
  builder.single = builder.maybeSingle
  return { from: vi.fn(() => builder), filters, rpc: vi.fn(async () => ({ data: true as unknown, error: null })) }
}
function actDb(photoSlots: string[]) {
  const updates: unknown[] = []
  const base = query([])
  base.from.mockImplementation((table: string) => {
    const q = query(table === 'home_check_photos' ? photoSlots.map((slot) => ({ slot })) : table === 'sms_messages' ? [{ id: 'incoming' }] : [{ intake_state: {} }]).from(table) as Record<string, unknown>
    const update = q.update as (...args: unknown[]) => unknown
    q.update = (value: unknown) => {
      updates.push(value)
      return update(value)
    }
    return q
  })
  base.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'hold_home_check_sms_photo') { updates.push({ intake_state: { home_check_photo_pending: args.p_pending } }); return { data: true, error: null } }
    return { data: { ok: true, checkId: 'check', slot: 'water_heater_label', version: 'version', claim: 'claim' }, error: null }
  })
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  return Object.assign(base, {
    updates,
    storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) },
  })
}
const pending = {
  id: 'check',
  reference: 'HC-AABBCCDDEEFF',
  property_label: 'Birch',
  unit_label: '12A',
  landlord_id: 'landlord',
  recipient_phone: '+15551112222',
  ulo_number: '+15550001111',
  role: 'contractor',
  status: 'collecting',
}
function context(
  db: ReturnType<typeof query>,
  body: string,
  mediaUrls: string[] = [],
  landlord = false,
): InboundSmsHandlerContext {
  return {
    supabase: db,
    landlordId: 'landlord',
    messageId: 'message',
    conversationId: 'conv',
    identity: { identity_type: landlord ? 'landlord' : 'vendor' },
    inbound: { body, mediaUrls, from: '+15551112222', to: '+15550001111' },
  } as unknown as InboundSmsHandlerContext
}
describe('Home Check SMS dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(true)
  })
  it('reserves CHECK initiation for registered landlord and property-team identities', async () => {
    const db = query([])
    expect(await prepareHomeCheckSms(context(db, 'CHECK 12A'))).toBeNull()
    expect(await prepareHomeCheckSms(context(db, 'CHECK 12A', [], true))).toMatchObject({
      kind: 'guide',
      sender: 'landlord',
    })
    expect(db.from).not.toHaveBeenCalled()
    expect(isLandlordAccountOrOpsPhone).toHaveBeenCalledWith(db, {
      fromNumber: '+15551112222',
      landlordId: 'landlord',
    })
  })
  it('rejects stale landlord identities whose phone is no longer authorized', async () => {
    vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(false)
    expect(await prepareHomeCheckSms(context(query([]), 'INSPECT Birch / 12A', [], true)))
      .toMatchObject({ kind: 'clarify', reply: expect.stringContaining('registered phone number') })
    expect(createHomeCheck).not.toHaveBeenCalled()
  })
  it('starts an inspection for an authorized team member with that member as self-capture recipient', async () => {
    const db = query([])
    db.from.mockImplementation((table: string) =>
      query(
        table === 'properties'
          ? [{ id: 'birch', name: 'Birch', street_address: '1 Main St' }]
          : [{ id: 'birch-12a', property_id: 'birch', unit_label: '12A' }],
      ).from(table)
    )
    const action = await prepareHomeCheckSms(context(db, 'INSPECT Birch / 12A', [], true))
    expect(action).toMatchObject({ kind: 'guide', initiatorPhone: '+15551112222', sender: 'landlord' })
    expect(createHomeCheck).not.toHaveBeenCalled()
  })
  it('asks for an exact property/unit before starting when scope is absent or duplicated', async () => {
    const db = query([])
    db.from.mockImplementation((table: string) =>
      query(
        table === 'properties'
          ? [{ id: 'birch', name: 'Birch' }, { id: 'oak', name: 'Oak' }]
          : [{ id: 'birch-12a', property_id: 'birch', unit_label: '12A' }, {
            id: 'oak-12a',
            property_id: 'oak',
            unit_label: '12A',
          }],
      ).from(table)
    )
    for (const body of ['INSPECT', 'INSPECT 12A']) {
      expect(await prepareHomeCheckSms(context(db, body, [], true))).toMatchObject({ kind: 'guide' })
    }
    expect(createHomeCheck).not.toHaveBeenCalled()
  })
  it('uses property-level wording for a single-family home and stores the property without a unit', async () => {
    const db = query([])
    db.from.mockImplementation((table: string) =>
      query(
        table === 'properties'
          ? [{ id: 'maple', name: '14 Maple Ave', street_address: '14 Maple Ave' }]
          : [{ id: 'maple-home', property_id: 'maple', unit_label: 'Home' }],
      ).from(table)
    )
    expect(await prepareHomeCheckSms(context(db, 'INSPECT', [], true))).toMatchObject({ kind: 'guide' })
    expect(await prepareHomeCheckSms(context(db, 'INSPECT 14 Maple Ave', [], true))).toMatchObject({
      kind: 'guide',
    })
    expect(createHomeCheck).not.toHaveBeenCalled()
  })
  it('leaves compliance and unrelated messages outside the Home Check workflow', async () => {
    const db = query([pending])
    for (const body of ['STOP', 'START', 'HELP', 'The sink is leaking']) {
      expect(await prepareHomeCheckSms(context(db, body))).toBeNull()
    }
    expect(db.from).not.toHaveBeenCalled()
    expect(await prepareHomeCheckSms(context(db, 'YES'))).toBeNull()
    expect(db.from).toHaveBeenCalledWith('home_check_sms_capture_sessions')
  })
  it('binds MMS to the reference, assigned phone, Ulo line and explicit slot', async () => {
    const db = query([pending])
    expect(
      await prepareHomeCheckSms(context(db, `${pending.reference} 2`, ['sms/private/photo.jpg'])),
    ).toMatchObject({ kind: 'photo', check: { id: 'check' }, slot: 'water_heater_whole' })
    expect(db.filters).toContainEqual(['eq', ['landlord_id', 'landlord']])
    expect(db.filters).toContainEqual(['eq', ['recipient_phone', '+15551112222']])
    expect(db.filters).toContainEqual(['eq', ['ulo_number', '+15550001111']])
  })
  it('does not attach ambiguous, wrong-reference, multi-photo or unrehosted MMS', async () => {
    for (
      const [body, media] of [['HC-000000000000 1', ['sms/a.jpg']], [
        `${pending.reference} 1`,
        ['sms/a.jpg', 'sms/b.jpg'],
      ], [`${pending.reference} 1`, ['https://example.com/a.jpg']]] as Array<[string, string[]]>
    ) {
      expect(await prepareHomeCheckSms(context(query([pending]), body, media))).toMatchObject({
        kind: 'clarify',
      })
    }
  })
  it('holds a photo for confirmation when there is no selected context, even with one open check', async () => {
    expect(await prepareHomeCheckSms(context(query([pending]), '', ['sms/a.jpg']))).toMatchObject({
      kind: 'hold_photo',
      pending: { step: 'check', checkIds: ['check'], path: 'sms/a.jpg' },
    })
  })
  it('asks even when two open checks share a property; newest is not authority', async () => {
    const older = { ...pending, id: 'older', property_id: 'p', unit_id: null, created_at: '2026-10-27T12:00:00Z' }
    const newer = { ...pending, id: 'newer', property_id: 'p', unit_id: null, created_at: '2026-10-28T12:00:00Z' }
    expect(await prepareHomeCheckSms(context(query([older, newer]), '', ['sms/a.jpg']))).toMatchObject({
      kind: 'hold_photo',
      pending: { step: 'check', checkIds: ['newer', 'older'] },
    })
  })
  it('holds the photo and asks with numbers when open checks are for different places', async () => {
    const birch = { ...pending, id: 'birch', property_id: 'birch', unit_id: null, created_at: '2026-10-27T12:00:00Z' }
    const oak = { ...pending, id: 'oak', property_id: 'oak', unit_id: null, property_label: 'Oak', created_at: '2026-10-28T12:00:00Z' }
    const action = await prepareHomeCheckSms(context(query([birch, oak]), '', ['sms/a.jpg']))
    expect(action).toMatchObject({
      kind: 'hold_photo',
      pending: { step: 'check', path: 'sms/a.jpg', checkIds: ['oak', 'birch'] },
    })
    const reply = (action as { reply: string }).reply
    expect(reply).toMatch(/Which home check is this photo for\?/)
    expect(reply).toMatch(/1\) Oak/)
    expect(reply).toMatch(/Reply 1 or 2/)
    expect(reply).not.toMatch(/HC-|caption/i)
  })
  it('a numbered reply files the held photo against the chosen check', async () => {
    const birch = { ...pending, id: 'birch', property_id: 'birch' }
    const oak = { ...pending, id: 'oak', property_id: 'oak' }
    const intake = { home_check_photo_pending: { step: 'check', path: 'sms/held.jpg', at: new Date().toISOString(), checkIds: ['oak', 'birch'] } }
    const db = query([])
    db.from.mockImplementation((table: string) =>
      query(table === 'sms_conversations' ? [{ intake_state: intake }] : [birch, oak]).from(table)
    )
    expect(await prepareHomeCheckSms(context(db, '2'))).toMatchObject({
      kind: 'photo',
      check: { id: 'birch' },
      slot: null,
      path: 'sms/held.jpg',
    })
  })
  it('a numbered reply says what a held photo shows', async () => {
    const intake = { home_check_photo_pending: { step: 'kind', path: 'sms/held.jpg', at: new Date().toISOString(), checkId: 'check' } }
    const db = query([])
    db.from.mockImplementation((table: string) =>
      query(table === 'sms_conversations' ? [{ intake_state: intake }] : [pending]).from(table)
    )
    expect(await prepareHomeCheckSms(context(db, '3'))).toMatchObject({
      kind: 'photo',
      check: { id: 'check' },
      slot: 'heating_label',
      path: 'sms/held.jpg',
    })
  })
  it('ignores an expired held photo', async () => {
    const intake = { home_check_photo_pending: { step: 'kind', path: 'sms/held.jpg', at: '2020-01-01T00:00:00Z', checkId: 'check' } }
    const db = query([])
    db.from.mockImplementation((table: string) =>
      query(table === 'sms_conversations' ? [{ intake_state: intake }] : [pending]).from(table)
    )
    expect(await prepareHomeCheckSms(context(db, '3'))).toBeNull()
  })
  it('saves a recognised label photo and names it in plain words', async () => {
    vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({
      category: 'water_heater',
      identifiedItem: { type: 'Water heater', modelNumber: 'XE50' },
      labelReadability: { status: 'readable' },
    } as never)
    const db = actDb([])
    const result = await actHomeCheckSms(db as never, 'landlord', {
      kind: 'photo',
      check: { ...pending, workflow_run_id: 'run' } as never,
      slot: null,
      path: 'sms/a.jpg',
      conversationId: 'conv',
    })
    expect(uploadHomeCheckPhoto).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ slot: 'water_heater_label' }))
    expect(result.reply).toMatch(/^Saved as the water heater label for Birch/)
    expect(result.reply).toMatch(/Next, send a photo of the whole water heater/)
  })
  it.each([
    ['water_heater_whole', 'system_mismatch', 'water_heater_label', 'could not verify'],
    ['water_heater_label', 'system_mismatch', 'water_heater_whole', 'could not verify'],
    ['heating_whole', 'system_mismatch', 'heating_label', 'could not verify'],
    ['water_heater_whole', 'label_unreadable', 'water_heater_label', 'could not read'],
  ])('gives one truthful retake step for %s / %s', async (slot, reason, nextSlot, wording) => {
    vi.mocked(uploadHomeCheckPhoto).mockResolvedValueOnce({ feedback: [{
      slot: slot.startsWith('water') ? 'water_heater_label' : 'heating_label',
      retakeReason: reason,
      retakeMessage: 'These photos do not match the selected system. Send its whole-equipment photo and data plate.',
    }] } as never)
    const db = actDb([])
    const result = await actHomeCheckSms(db as never, 'landlord', {
      kind: 'photo', check: pending as never, slot: slot as never,
      path: 'sms/retake.jpg', conversationId: 'conv',
    })
    expect(result.reply).toContain(wording)
    expect(result.reply).not.toContain('Saved as')
    expect(result.reply).not.toContain('data plate')
    expect(result.reply).not.toContain('These photos do not match')
    expect(result.reply.match(/Next,/g)).toHaveLength(1)
    expect(db.rpc).toHaveBeenLastCalledWith('home_check_sms_capture_context', expect.objectContaining({
      p_action: 'bind', p_slot: nextSlot, p_check_id: 'check',
    }))
  })
  it('asks what the photo shows when it cannot be read, and keeps it', async () => {
    const db = actDb([])
    const result = await actHomeCheckSms(db as never, 'landlord', {
      kind: 'photo',
      check: { ...pending, workflow_run_id: 'run' } as never,
      slot: null,
      path: 'sms/a.jpg',
      conversationId: 'conv',
    })
    expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
    expect(result.reply).toMatch(/What does this photo show\?/)
    expect(result.reply).toMatch(/1\) Water heater label/)
    expect(db.updates).toContainEqual({
      intake_state: { home_check_photo_pending: expect.objectContaining({ step: 'kind', checkId: 'check', path: 'sms/a.jpg' }) },
    })
  })
  it('bare OK confirms only one stored, completed landlord result; multiple results ask for a reference', async () => {
    expect(
      await prepareHomeCheckSms(
        context(
          query([pending, { ...pending, id: 'other', reference: 'HC-112233445566' }]),
          'OK',
          [],
          true,
        ),
      ),
    ).toMatchObject({ kind: 'clarify' })
    const db = query([pending])
    expect(await prepareHomeCheckSms(context(db, 'OK', [], true))).toMatchObject({
      kind: 'confirm',
    })
    expect(db.filters).toContainEqual(['eq', ['status', 'completed']])
    expect(db.filters).toContainEqual(['not', ['summary_sent_at', 'is', null]])
    expect(await prepareHomeCheckSms(context(query([]), 'OK', [], true))).toBeNull()
  })
  it('accepts explicit observations without converting unknown service dates to facts', async () => {
    expect(
      await prepareHomeCheckSms(
        context(query([pending]), `${pending.reference} ANSWERS YES | | | Leak at base`),
      ),
    ).toMatchObject({
      kind: 'answers',
      answers: {
        warningSigns: true,
        lastService: '',
        lastFilterChange: '',
        warningDetails: 'Leak at base',
      },
    })
  })
  it('resolves the shared DID only for the check’s assigned sender and receiving line', async () => {
    const db = query(pending)
    expect(
      await resolveHomeCheckLandlord(db as never, {
        body: `${pending.reference} 1`,
        from: pending.recipient_phone,
        to: pending.ulo_number,
      }),
    ).toBe('landlord')
    expect(db.filters).toContainEqual(['eq', ['ulo_number', pending.ulo_number]])
    expect(
      await resolveHomeCheckLandlord(query(pending) as never, {
        body: `${pending.reference} 1`,
        from: '+15559999999',
        to: pending.ulo_number,
      }),
    ).toBeNull()
  })
  it('claims the reminder and does not text a retired capture link', async () => {
    vi.mocked(sendHomeCheckSms).mockClear()
    const db = query([{ id: 'check' }])
    await runHomeCheckReminder(db as never, pending as never)
    expect(db.filters).toContainEqual(['is', ['reminder_claimed_at', null]])
    expect(db.filters).toContainEqual(['eq', ['status', 'collecting']])
    await runHomeCheckReminder(query([]) as never, pending as never)
    expect(sendHomeCheckSms).not.toHaveBeenCalled()
  })
})

describe('selected Home Check context',()=>{
 beforeEach(()=>vi.clearAllMocks())
 function selectedDb(checks= [pending], overrides: Record<string,unknown>={}) {
  const db=query([])
  db.from.mockImplementation((table:string)=>query(table==='sms_conversations'?[{intake_state:{}}]:table==='home_check_sms_capture_sessions'?[{check_id:'check',expected_slot:'water_heater_label',version:'version',expires_at:new Date(Date.now()+600000).toISOString(),...overrides}]:checks).from(table))
  return db
 }
 it('uses the selected check and expected step without a caption',async()=>{
  const result=await prepareHomeCheckSms(context(selectedDb(),'', ['sms/a.jpg']))
  expect(result).toMatchObject({kind:'photo',check:{id:'check'},slot:'water_heater_label',expectedVersion:'version'})
 })
 it('does not switch to a newer check at the same property',async()=>{
  const newer={...pending,id:'newer',property_id:'same',created_at:'2026-10-29T00:00:00Z'}
  const result=await prepareHomeCheckSms(context(selectedDb([{...pending,property_id:'same'},newer]),'', ['sms/a.jpg']))
  expect(result).toMatchObject({kind:'photo',check:{id:'check'}})
 })
 it('renews an expired explicit selection when it is still the only assigned check',async()=>{
  const db=selectedDb([pending],{expires_at:'2020-01-01T00:00:00Z'})
  db.rpc.mockResolvedValue({data:{ok:true,checkId:'check',slot:'water_heater_label',version:'renewed'},error:null})
  expect(await prepareHomeCheckSms(context(db,'',['sms/a.jpg']))).toMatchObject({kind:'photo',check:{id:'check'},expectedVersion:'renewed'})
  expect(db.rpc).toHaveBeenCalledWith('home_check_sms_capture_context',expect.objectContaining({p_action:'bind',p_check_id:'check',p_version:'version',p_slot:'water_heater_label'}))
 })
 it('an expired selection with multiple assigned checks still asks instead of guessing',async()=>{
  const db=selectedDb([pending,{...pending,id:'other'}],{expires_at:'2020-01-01T00:00:00Z'})
  expect(await prepareHomeCheckSms(context(db,'',['sms/a.jpg']))).toMatchObject({kind:'hold_photo'})
  expect(db.rpc).not.toHaveBeenCalled()
 })
 it('does not guess the only check if no explicit selected check matches',async()=>{
  const db=selectedDb([pending],{check_id:'foreign-check',expires_at:'2020-01-01T00:00:00Z'})
  expect(await prepareHomeCheckSms(context(db,'',['sms/a.jpg']))).toMatchObject({kind:'hold_photo'})
  expect(db.rpc).not.toHaveBeenCalled()
 })
 it('a renewal racing a newer selection holds the photo without uploading',async()=>{
  const db=selectedDb([pending],{expires_at:'2020-01-01T00:00:00Z'})
  db.rpc.mockResolvedValue({data:{ok:false,reason:'stale'},error:null})
  expect(await prepareHomeCheckSms(context(db,'',['sms/a.jpg']))).toMatchObject({kind:'hold_photo'})
 })
 it('a context pointing to another account or reassigned check is not used',async()=>{
  expect(await prepareHomeCheckSms(context(selectedDb([pending],{check_id:'foreign-check'}),'',['sms/a.jpg']))).toMatchObject({kind:'hold_photo'})
 })
 it('an out-of-order photo is held and asks what it shows before any upload',async()=>{
  const db=actDb([])
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({category:'hvac',identifiedItem:{type:'Furnace'},labelReadability:{status:'readable'}} as never)
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_label',expectedVersion:'version',path:'sms/a.jpg',conversationId:'conv'})
  expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
  expect(result.reply).toContain('What does this photo show?')
 })
 it('a stale or busy claim cannot upload the photo',async()=>{
  const db=actDb([])
  db.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='home_check_sms_capture_context'?args.p_action==='bind'?{ok:true,version:'v'}:{ok:false}:true,error:null}))
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_label',path:'sms/a.jpg',conversationId:'conv'})
  expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
  expect(result.reply).toContain('was not attached')
 })
 it('a media path not proven to belong to this conversation is not downloaded',async()=>{
  const db=actDb([]),original=db.from.getMockImplementation()!
  db.from.mockImplementation((table:string)=>table==='sms_messages'?query([]).from(table):original(table))
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_label',path:'foreign/a.jpg',conversationId:'conv'})
  expect(readHomeCheckPhoto).not.toHaveBeenCalled();expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
  expect(result.reply).toContain('No photo was attached')
 })
 it('a second ambiguous photo does not replace the first held photo',async()=>{
  const db=actDb([]);db.rpc.mockResolvedValue({data:false,error:null})
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'hold_photo',conversationId:'conv',pending:{step:'check',path:'sms/b.jpg',at:new Date().toISOString(),checkIds:['check']},reply:'choose'})
  expect(result.reply).toContain('previous photo');expect(result.reply).toContain('newer photo was not attached')
 })
})

it('CANCEL clears held-photo context instead of interpreting the next number as an old choice',async()=>{
 const db=query([]);db.from.mockImplementation((table:string)=>query(table==='sms_conversations'?[{intake_state:{home_check_photo_pending:{step:'kind',checkId:'check',path:'sms/held.jpg',at:new Date().toISOString()}}}]:[pending]).from(table))
 expect(await prepareHomeCheckSms(context(db,'CANCEL'))).toMatchObject({kind:'cancel_photo',conversationId:'conv'})
})


describe('plain-language Home Check observations', () => {
 const completed = { ...pending, expires_at: new Date(Date.now()+86400000).toISOString(), completed_at: new Date().toISOString(), answers: { warningSigns: null, warningDetails: '', lastService: '', lastFilterChange: '' } }
 function observationsDb(options: { expired?: boolean; expectedSlot?: string | null; prompt?: string; selectedId?: string; checks?: unknown[] } = {}) {
  const db = query([])
  db.from.mockImplementation((table: string) => query(
   table === 'sms_conversations' ? [{ intake_state: {} }] :
   table === 'home_check_sms_capture_sessions' ? [{ check_id: options.selectedId ?? 'check', expected_slot: options.expectedSlot === undefined ? null : options.expectedSlot, version: 'v', expires_at: options.expired ? '2020-01-01T00:00:00Z' : new Date(Date.now()+600000).toISOString() }] :
   table === 'sms_messages' ? [{ body: options.prompt ?? 'All four photos are in. Did you notice leaks? Reply NO, or YES followed by what you noticed.' }] : options.checks ?? [completed]
  ).from(table))
  return db
 }
 it('accepts NO for the exact selected check without a reference or command', async () => {
  const db = observationsDb({ checks: [completed, { ...completed, id: 'newer' }] })
  expect(await prepareHomeCheckSms(context(db, 'NO'))).toMatchObject({ kind: 'answers', check: { id: 'check' }, answers: { warningSigns: false, warningDetails: '', lastService: '', lastFilterChange: '' } })
 })
 it('accepts delayed NO after photo-session expiry while the selected check still awaits it', async () => {
  expect(await prepareHomeCheckSms(context(observationsDb({ expired: true }), 'NO'))).toMatchObject({ kind: 'answers', check: { id: 'check' }, answers: { warningSigns: false } })
 })
 it('NONE explicitly records no warning signs after the direct question',async()=>{
  expect(await prepareHomeCheckSms(context(observationsDb({prompt:'Any leaks, unusual noises or smells? Reply NONE, YES + details, or UNSURE.'}),'NONE'))).toMatchObject({kind:'answers',answers:{warningSigns:false,observationsConfirmed:true}})
 })
 it('UNSURE records uncertainty without inventing a no-leak answer',async()=>{
  expect(await prepareHomeCheckSms(context(observationsDb({prompt:'Any leaks, unusual noises or smells? Reply NONE, YES + details, or UNSURE.'}),'UNSURE'))).toMatchObject({kind:'answers',answers:{warningSigns:null,observationsConfirmed:true}})
 })
 it('does not interpret NO after the old indirect command as a leak answer',async()=>{
  expect(await prepareHomeCheckSms(context(observationsDb({prompt:'All four photos are in. If you noticed leaks, reply HC-123456789012 ANSWERS YES.'}),'NO'))).toBeNull()
 })
 it('accepts YES with details and preserves unknown service dates', async () => {
  expect(await prepareHomeCheckSms(context(observationsDb(), 'YES water is dripping at the base'))).toMatchObject({ kind: 'answers', answers: { warningSigns: true, warningDetails: 'water is dripping at the base', lastService: '', lastFilterChange: '' } })
 })
 it('asks for details after bare YES without inventing a problem', async () => {
  const result = await prepareHomeCheckSms(context(observationsDb(), 'YES'))
  expect(result).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('YES + details') })
  expect(result?.kind).not.toBe('answers')
 })
 it.each([
  { checks: [{ ...completed, expires_at: '2020-01-01T00:00:00Z' }] }, { expectedSlot: 'heating_whole' }, { selectedId: 'foreign-check' },
  { prompt: 'Approve the latest estimate? Reply YES or NO.' },
  { checks: [{ ...completed, completed_at: null }] },
  { checks: [{ ...completed, answers: { ...completed.answers, warningSigns: false } }] },
 ])('does not consume a reply outside the current unanswered observation prompt: %j', async (options) => {
  expect(await prepareHomeCheckSms(context(observationsDb(options), 'NO'))).toBeNull()
 })
 it('final photo asks a plain question without a long code or pipe syntax', async () => {
  const result = await actHomeCheckSms(actDb(['water_heater_label','water_heater_whole','heating_label']) as never, 'landlord', {
   kind: 'photo', check: completed as never, slot: 'heating_whole', path: 'sms/final.jpg', conversationId: 'conv',
  })
  expect(result.reply).toContain('Reply NONE, YES + details, or UNSURE')
  expect(result.reply).not.toMatch(/HC-|ANSWERS|\|/)
 })
 it('RESULTS can preview an unanswered check without claiming no leaks',async()=>{
  expect(await prepareHomeCheckSms(context(observationsDb(),'RESULTS',[],true))).toMatchObject({kind:'results',check:{answers:{warningSigns:null}}})
 })
 it('RESULTS uses only the selected completed check after capture expiry', async () => {
  const ready={...completed,answers:{...completed.answers,warningSigns:false}}
  expect(await prepareHomeCheckSms(context(observationsDb({ expired:true,checks:[ready,{...ready,id:'other'}] }), 'RESULTS', [], true))).toMatchObject({kind:'results',check:{id:'check'}})
 })
 it('OK chooses the selected result among several pending results', async () => {
  expect(await prepareHomeCheckSms(context(observationsDb({ expired: true, checks: [completed, { ...completed, id: 'other' }] }), 'OK', [], true))).toMatchObject({ kind: 'confirm', check: { id: 'check' } })
 })
})


describe('one Results message before confirmation', () => {
 beforeEach(() => vi.clearAllMocks())
 it('self-capture returns no second saved acknowledgement after Results was sent', async () => {
  const result = await actHomeCheckSms(actDb([]) as never, 'landlord', { kind: 'answers', check: { ...pending, role: 'landlord' } as never, answers: { warningSigns: false, warningDetails: '', lastService: '', lastFilterChange: '' } })
  expect(saveHomeCheckAnswers).toHaveBeenCalledOnce()
  expect(result.reply).toBeUndefined()
 })
 it('pending analysis cannot be confirmed by SMS', async () => {
  vi.mocked(pendingHomeCheckSystems).mockResolvedValueOnce(['heating'])
  const result = await actHomeCheckSms(actDb([]) as never, 'landlord', { kind: 'confirm', check: {...pending,answers:{warningSigns:false}} as never })
  expect(result.reply).toContain('not confirmed yet')
  expect(result.reply).toContain('RESULTS')
 })
 it('RESULTS sends the preview without another saved acknowledgement', async () => {
  const result = await actHomeCheckSms(actDb([]) as never, 'landlord', { kind: 'results', check: pending as never })
  expect(notifyHomeCheckResult).toHaveBeenCalledWith(expect.anything(), pending, [], true)
  expect(result.reply).toBeUndefined()
 })
})

it('OK cannot confirm while the observation question remains unanswered',async()=>{
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'confirm',check:{...pending,answers:{warningSigns:null,observationsConfirmed:false}} as never})
 expect(result.reply).toContain('Any leaks, unusual noises or smells?')
})

it('answers after a self-capture Results preview do not trigger another full Results SMS',async()=>{
 const db=actDb([])
 const result=await actHomeCheckSms(db as never,'landlord',{kind:'answers',check:{...pending,role:'landlord',summary_sent_at:new Date().toISOString(),detected_warning:'photo warning'} as never,answers:{warningSigns:false,observationsConfirmed:true,warningDetails:'',lastService:'',lastFilterChange:''}})
 expect(saveHomeCheckAnswers).toHaveBeenLastCalledWith(db,expect.anything(),expect.anything(),{notifyResults:false})
 expect(result.reply).toContain('Reply OK to confirm the results above')
 expect(result.reply).not.toMatch(/Results:|years|Saved/)
})

it('OK keeps flagged unknowns unknown and returns confirmation with the photo warning intact',async()=>{
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'confirm',check:{...pending,answers:{warningSigns:false},detected_warning:'TPR valve discharge line concern'} as never})
 expect(confirmHomeCheck).toHaveBeenLastCalledWith(expect.anything(),'check','landlord',[],{acknowledgeUnknownLabels:true})
 expect(result.reply).toContain('Home Check records are saved')
 expect(result.reply).toContain('possible water-heater piping concern in Property Intelligence')
})
it('a label-review rejection produces a useful SMS instead of silence',async()=>{
 vi.mocked(confirmHomeCheck).mockRejectedValueOnce(new Error('Correct the flagged label in Property Intelligence or retake it before confirming'))
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'confirm',check:{...pending,answers:{warningSigns:false}} as never})
 expect(result.reply).toContain('label still needs review')
 expect(result.reply).toContain('not confirmed')
})
it('a failure after database commit cannot falsely report unconfirmed',async()=>{
 vi.mocked(confirmHomeCheck).mockRejectedValueOnce(new Error('post-commit logging failed'))
 vi.mocked(loadHomeCheck).mockResolvedValueOnce({...pending,confirmed_at:new Date().toISOString()} as never)
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'confirm',check:{...pending,answers:{warningSigns:false}} as never})
 expect(result.reply).toContain('Home Check records are saved')
 expect(result.reply).not.toContain('not confirmed')
})
it('an unavailable status read reports uncertainty rather than a false confirmation',async()=>{
 vi.mocked(confirmHomeCheck).mockRejectedValueOnce(new Error('network failed'))
 vi.mocked(loadHomeCheck).mockRejectedValueOnce(new Error('status read failed'))
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'confirm',check:{...pending,answers:{warningSigns:false}} as never})
 expect(result.reply).toContain('could not verify confirmation')
 expect(result.reply).not.toContain('Home Check records are saved')
})

it('repeating OK after confirmation returns the receipt without confirming or saving again',async()=>{
 vi.mocked(confirmHomeCheck).mockClear()
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'confirm',check:{...pending,confirmed_at:new Date().toISOString(),detected_warning:'TPR discharge line'} as never})
 expect(confirmHomeCheck).not.toHaveBeenCalled()
 expect(result.reply).toContain('Home Check records are saved')
 expect(result.reply).toContain('water-heater piping concern in Property Intelligence')
})

it('a repeated OK selects only the confirmed check bound to this sender and line',async()=>{
 const db=query([]);let reads=0;const filters:Array<[string,unknown[]]>=[]
 db.from.mockImplementation((table:string)=>{
  const q=query(table==='home_check_sms_capture_sessions'?[{check_id:'check',expected_slot:null,version:'v',expires_at:'2020-01-01T00:00:00Z'}]:table==='home_checks'?(reads++===0?[]:[{...pending,confirmed_at:'2026-10-30T01:08:28Z',status:'confirmed'}]):table==='sms_messages'?[{body:'Home Check confirmed for Birch'}]:[])
  const builder=q.from(table) as any
  const eq=builder.eq;builder.eq=(...args:unknown[])=>{filters.push(['eq',args]);return eq(...args)}
  return builder
 })
 expect(await prepareHomeCheckSms(context(db,'OK',[],true))).toMatchObject({kind:'confirm',check:{id:'check',status:'confirmed'}})
 expect(filters).toContainEqual(['eq',['landlord_id','landlord']])
 expect(filters).toContainEqual(['eq',['recipient_phone','+15551112222']])
 expect(filters).toContainEqual(['eq',['ulo_number','+15550001111']])
})

it('an unrelated later prompt prevents an old confirmation receipt from consuming OK',async()=>{
 const db=query([]);let reads=0
 db.from.mockImplementation((table:string)=>query(table==='home_check_sms_capture_sessions'?[{check_id:'check',expected_slot:null,version:'v',expires_at:'2020-01-01T00:00:00Z'}]:table==='home_checks'?(reads++===0?[]:[{...pending,confirmed_at:'2026-10-30T01:08:28Z',status:'confirmed'}]):table==='sms_messages'?[{body:'Please confirm a different request.'}]:[]).from(table))
 expect(await prepareHomeCheckSms(context(db,'OK',[],true))).toBeNull()
})

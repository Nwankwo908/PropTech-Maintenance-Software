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
vi.mock('./manufactureCorrection.ts', () => ({
  applyHomeCheckSmsManufactureCorrection: vi.fn(async () => ([
    { system: 'water_heater', verified: false, fields: {} },
    { system: 'heating', verified: false, manufactureDate: { year: 2014, month: null }, fields: {} },
  ])),
}))
import { applyHomeCheckSmsManufactureCorrection } from './manufactureCorrection.ts'
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
  it('handles vendor HOME CHECK before generic work-order clarification, without starting a check', async () => {
    const db = query([{ ...pending, confirmed_at: null, expires_at: new Date(Date.now() + 86400000).toISOString(), visit: { phase: 'awaiting_acceptance' } }])
    expect(await prepareHomeCheckSms(context(db, 'HOME CHECK'))).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('Only your property team can request a Home Check') })
    expect(db.from).not.toHaveBeenCalled()
    expect(db.filters.some(([method]) => method === 'update')).toBe(false)
    expect(db.rpc).not.toHaveBeenCalled()
    expect(createHomeCheck).not.toHaveBeenCalled()
  })
  it('keeps an unassigned vendor HOME CHECK in Home Check guidance rather than generic jobs', async () => {
    expect(await prepareHomeCheckSms(context(query([]), 'home check'))).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('Only your property team can request a Home Check') })
  })
  it('denies resident HOME CHECK before generic intake without reading or writing records', async () => {
    const db = query([])
    const ctx = context(db, 'HOME CHECK')
    ctx.identity.identity_type = 'resident'
    expect(await prepareHomeCheckSms(ctx)).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('Only your property team can request a Home Check') })
    expect(db.from).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
    expect(createHomeCheck).not.toHaveBeenCalled()
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
    expect(reply).toMatch(/Which home check is this photo or video for\?/)
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
    expect(result.reply).toMatch(/What does this photo or video show\?/)
    expect(result.reply).toMatch(/1\) Water heater label/)
    expect(db.updates).toContainEqual({
      intake_state: { home_check_photo_pending: expect.objectContaining({ step: 'kind', checkId: 'check', path: 'sms/a.jpg' }) },
    })
  })
  it('bare OK never confirms through a photo capture without a results review', async () => {
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
    expect(await prepareHomeCheckSms(context(db, 'OK', [], true))).toMatchObject({kind:'clarify'})
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
  expect(result.reply).toContain('What does this photo or video show?')
 })
 it('accepts a phone-camera video instead of the old JPEG-only reject',async()=>{
  const db=actDb([])
  const video=new Blob([new Uint8Array([1,2,3,4])],{type:'video/mp4'})
  db.storage={from:()=>({download:async()=>({data:video,error:null})})} as never
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({
    category:'water_heater',
    photoView:{equipment:'water_heater',framing:'label_closeup',confidence:'high'},
  } as never)
  const result=await actHomeCheckSms(db as never,'landlord',{
    kind:'photo',check:pending as never,path:'sms/clip.mp4',conversationId:'conv',
  })
  expect(result.reply).not.toMatch(/JPEG, PNG or WebP/i)
  expect(readHomeCheckPhoto).toHaveBeenCalled()
  expect(vi.mocked(readHomeCheckPhoto).mock.calls[0]?.[1]).toBe('video/mp4')
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
 const completed = { ...pending, created_at: '2026-11-02T12:00:00Z', expires_at: new Date(Date.now()+86400000).toISOString(), completed_at: new Date().toISOString(), answers: { warningSigns: null, warningDetails: '', lastService: '', lastFilterChange: '' } }
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
 it('RESULTS does not use a photo-capture selection as a landlord review selection', async () => {
  const ready={...completed,answers:{...completed.answers,warningSigns:false}}
  expect(await prepareHomeCheckSms(context(observationsDb({ expired:true,checks:[ready,{...ready,id:'other'}] }), 'RESULTS', [], true))).toMatchObject({kind:'clarify',reply:expect.stringContaining('Which Home Check results')})
 })
 it('RESULTS finds a vendor result when the landlord has no matching capture selection', async () => {
  const db=observationsDb({selectedId:'old-check',checks:[{...completed,role:'contractor',recipient_phone:'+14708880274'}]})
  expect(await prepareHomeCheckSms(context(db,'RESULTS',[],true))).toMatchObject({kind:'results',check:{id:'check'}})
  expect(db.filters).not.toContainEqual(['eq',['recipient_phone','+15550000001']])
 })
 it('RESULTS does not guess among multiple unselected results',async()=>{
  const db=observationsDb({selectedId:'old-check',checks:[completed,{...completed,id:'other'}]})
  expect(await prepareHomeCheckSms(context(db,'RESULTS',[],true))).toMatchObject({kind:'clarify',reply:expect.stringContaining('Which Home Check results')})
 })
 it('OK ignores a photo selection and offers completed results explicitly', async () => {
  expect(await prepareHomeCheckSms(context(observationsDb({ expired: true, checks: [completed, { ...completed, id: 'other' }] }), 'OK', [], true))).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('Which Home Check results') })
 })
})

describe('Home Check Results follow-up corrections', () => {
  const ready = {
    ...pending,
    role: 'landlord',
    created_at: '2026-11-02T12:00:00Z',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    completed_at: new Date().toISOString(),
    confirmed_at: null,
    status: 'completed',
    answers: { warningSigns: false, observationsConfirmed: true, warningDetails: '', lastService: '', lastFilterChange: '' },
  }
  const summary = {
    id: 'summary',
    body: 'Results: 78 Maple Ave, Irvington, NJ, Unit 2\nHeating system: Slant/Fin.\nAge unknown.\nYou noticed no leaks, unusual noises or smells.\nReply OK to confirm these records.',
    raw_payload: { source: 'home_check' },
    provider_status: 'delivered',
    from_number: '+15550001111',
    to_number: '+15551112222',
  }
  function followUpDb(bodyPrompt = summary) {
    const db = query([])
    db.from.mockImplementation((table: string) => query(
      table === 'sms_conversations'
        ? [{ intake_state: { home_check_results_review: { ids: ['check'], selectedId: 'check', summaryMessageId: 'summary', expiresAt: new Date(Date.now() + 600000).toISOString() } } }]
        : table === 'sms_messages' ? [bodyPrompt]
        : table === 'home_checks' ? [ready]
        : [],
    ).from(table))
    return db
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(true)
  })

  it('keeps Age of heating system 2014 on Home Check instead of an estimate clarify', async () => {
    expect(await prepareHomeCheckSms(context(followUpDb(), 'Age of heating system 2014', [], true))).toMatchObject({
      kind: 'correct_manufacture',
      check: { id: 'check' },
      correction: { system: 'heating', year: 2014, month: null },
    })
  })

  it('helps with free-text follow-up while Results await OK', async () => {
    const result = await prepareHomeCheckSms(context(followUpDb(), 'the age looks wrong', [], true))
    expect(result).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('Reply OK') })
    expect(String(result && 'reply' in result ? result.reply : '')).not.toMatch(/estimate|APPROVE|WO-/i)
  })

  it('leaves explicit APPROVE for the estimate handler', async () => {
    expect(await prepareHomeCheckSms(context(followUpDb(), 'APPROVE', [], true))).toBeNull()
  })

  it('applies the manufacture correction and resends Results', async () => {
    const result = await actHomeCheckSms(actDb([]) as never, 'landlord', {
      kind: 'correct_manufacture',
      check: ready as never,
      correction: { system: 'heating', year: 2014, month: null },
    })
    expect(applyHomeCheckSmsManufactureCorrection).toHaveBeenCalledWith(
      expect.anything(),
      ready,
      { system: 'heating', year: 2014, month: null },
    )
    expect(notifyHomeCheckResult).toHaveBeenCalled()
    expect(result.reply).toBeUndefined()
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


describe('remembered photo clarification', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(readHomeCheckPhoto).mockResolvedValue(null) })
  it('asks a short confirmation for an unreadable photo at the explicitly requested step', async () => {
    const db = actDb([])
    const result = await actHomeCheckSms(db as never, 'landlord', { kind: 'photo',
      check: pending as never, slot: 'heating_whole', expectedVersion: 'version', path: 'sms/a.jpg', conversationId: 'conv' })
    expect(result.reply).toContain('Is this the whole furnace or boiler')
    expect(result.reply).toContain('Reply YES or NO')
    expect(result.reply).not.toContain('1) Water heater')
    expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
    expect(db.updates).toContainEqual({ intake_state: { home_check_photo_pending: expect.objectContaining({ expectedSlot: 'heating_whole', path: 'sms/a.jpg' }) } })
  })
  function heldDb(open = [pending]) {
    const held = { step: 'kind', checkId: 'check', path: 'sms/held.jpg', at: new Date().toISOString(), expectedSlot: 'heating_whole' }
    const db = query([])
    db.from.mockImplementation((table: string) => query(table === 'sms_conversations' ? [{ intake_state: { home_check_photo_pending: held } }] : open).from(table))
    return db
  }
  it('YES resumes only the held photo and remembered check/slot', async () => {
    expect(await prepareHomeCheckSms(context(heldDb(), 'YES'))).toMatchObject({ kind: 'photo', check: { id: 'check' }, slot: 'heating_whole', path: 'sms/held.jpg' })
  })
  it('NO switches to the full menu without assigning the photo', async () => {
    expect(await prepareHomeCheckSms(context(heldDb(), 'NO'))).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('What does this photo or video show?') })
  })
  it('does not accept YES for an ended or inaccessible check', async () => {
    expect(await prepareHomeCheckSms(context(heldDb([]), 'YES'))).toMatchObject({ kind: 'clarify', reply: expect.stringContaining('has ended') })
  })
  it('keeps the full menu for a recognised conflicting photo', async () => {
    vi.mocked(readHomeCheckPhoto).mockResolvedValue({ category: 'water_heater', identifiedItem: { type: 'water heater' }, labelReadability: { status: 'not_visible' } } as never)
    const result = await actHomeCheckSms(actDb([]) as never, 'landlord', { kind: 'photo', check: pending as never, slot: 'heating_whole', expectedVersion: 'version', path: 'sms/a.jpg', conversationId: 'conv' })
    expect(result.reply).toContain('What does this photo or video show?')
    expect(result.reply).not.toContain('Reply YES or NO')
  })
})


describe('vendor and landlord batch admission', () => {
 const paths = ['sms/a.jpg','sms/b.jpg','sms/c.jpg','sms/d.jpg']
 function selected(role = 'contractor', checkId = 'check') {
   const db = query([])
   db.from.mockImplementation((table: string) => query(table === 'sms_conversations' ? [{ intake_state: {} }] : table === 'home_check_sms_capture_sessions' ? [{ check_id: checkId, expected_slot: 'water_heater_label', version: 'version', expires_at: new Date(Date.now()+600000).toISOString() }] : [{ ...pending, role }]).from(table))
   return db
 }
 it.each(['contractor', 'landlord'] as const)('accepts four photos for the explicitly selected %s check', async (role) => {
   expect(await prepareHomeCheckSms(context(selected(role), '', paths))).toMatchObject({kind:'vendor_batch',check:{id:'check', role},paths})
 })
 it('keeps tenant on the guided one-photo flow', async () => {
   expect(await prepareHomeCheckSms(context(selected('tenant'), '', paths))).toMatchObject({kind:'clarify',reply:expect.stringContaining('one photo per text')})
 })
 it('does not guess a check when the selection belongs to another check/account', async () => {
   expect(await prepareHomeCheckSms(context(selected('contractor','foreign'), '', paths))).toMatchObject({kind:'clarify'})
 })
 it('rejects duplicate paths and incomplete batches', async () => {
   expect(await prepareHomeCheckSms(context(selected(), '', paths.slice(0,2)))).toMatchObject({kind:'clarify',reply:expect.stringContaining('four different photos')})
   expect(await prepareHomeCheckSms(context(selected(), '', ['sms/a.jpg','sms/a.jpg','sms/c.jpg','sms/d.jpg']))).toMatchObject({kind:'clarify'})
 })
 it('does not upload any photos if batch identification is uncertain', async () => {
   vi.mocked(identifyVendorHomeCheckBatch).mockResolvedValueOnce(null)
   vi.mocked(uploadHomeCheckPhoto).mockClear()
   const result = await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'vendor_batch',check:pending as never,paths,conversationId:'conv'})
   expect(result.reply).toContain('No equipment records were saved')
   expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 })
 it('never replaces a partly completed check with a batch', async () => {
   vi.mocked(uploadHomeCheckPhoto).mockClear()
   const result = await actHomeCheckSms(actDb(['water_heater_label']) as never,'landlord',{kind:'vendor_batch',check:pending as never,paths,conversationId:'conv'})
   expect(result.reply).toContain('already has photos')
   expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 })
 it.each([false,true])('uses sequential capture claims and reports interruption truthfully (%s)', async fail => {
   vi.mocked(analyzeHomeCheckBatch).mockClear()
   const saved: string[] = []
   const slots = ['water_heater_label','water_heater_whole','heating_label','heating_whole']
   const db = query([])
   db.from.mockImplementation((table: string) => query(table === 'home_check_photos' ? saved.map(slot=>({slot})) : table === 'home_check_sms_capture_sessions' ? [{check_id:'check',expected_slot:slots[saved.length],version:'version'+saved.length,expires_at:new Date(Date.now()+600000).toISOString()}] : []).from(table))
   db.rpc.mockResolvedValue({data:{ok:true,claim:'claim'},error:null})
   vi.mocked(identifyVendorHomeCheckBatch).mockResolvedValueOnce(paths.map((path,i)=>({path,slot:slots[i],bytes:new Uint8Array([1]),contentType:'image/jpeg'})) as never)
   vi.mocked(uploadHomeCheckPhoto).mockImplementation(async (_db,_check,input) => {
     if (fail && saved.length===1) throw Error('storage failed')
     saved.push(input.slot)
     return {feedback:[]} as never
   })
   try {
     const result = await actHomeCheckSms(db as never,'landlord',{kind:'vendor_batch',check:pending as never,paths,conversationId:'conv'})
     expect(result.reply).toContain(fail ? '1 of four have been attached' : 'All four photos are saved')
     expect(saved).toEqual(fail ? slots.slice(0,1) : slots)
     expect(analyzeHomeCheckBatch).toHaveBeenCalledTimes(fail ? 0 : 1)
     for (const call of vi.mocked(uploadHomeCheckPhoto).mock.calls.slice(-saved.length)) {
       expect(call[2]).toMatchObject({ deferEquipmentAnalysis: true, skipOutreach: true })
     }
     expect(db.rpc).toHaveBeenCalledWith('home_check_sms_capture_context',expect.objectContaining({p_action:'claim',p_landlord_id:'landlord',p_conversation_id:'conv',p_check_id:'check',p_version:'version0'}))
   } finally { vi.mocked(uploadHomeCheckPhoto).mockResolvedValue({feedback:[]} as never) }
 })
})

describe('vendor name SMS routing regression', () => {
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(true)})
 function guideDb(step='pick_contractor') {
  const db=query([])
  db.from.mockImplementation((table:string)=>query(table==='sms_conversations'?[{intake_state:{home_check_guide:{step,role:'contractor',updatedAt:new Date().toISOString()}}}]:[]).from(table))
  return db
 }
 it.each(['Vendor test disposble','vendor test disposable','Disposable test vendor','Can you use disposble vendor'])('routes %s to the active contractor guide before generic landlord handling',async body=>{
  expect(await prepareHomeCheckSms(context(guideDb(),body,[],true))).toMatchObject({kind:'guide',body,sender:'landlord',conversationId:'conv'})
 })
 it('does not route arbitrary text to another Home Check step',async()=>{
  expect(await prepareHomeCheckSms(context(guideDb('pick_who'),'Tell me about rents',[],true))).toBeNull()
 })
 it('does not route names into an absent guide',async()=>{
  expect(await prepareHomeCheckSms(context(query([]),'Vendor test disposble',[],true))).toBeNull()
 })
 it('does not bypass current landlord-phone authorization',async()=>{
  vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(false)
  expect(await prepareHomeCheckSms(context(guideDb(),'Vendor test disposble',[],true))).toBeNull()
 })
})

it('carries a misspelled SMS through dispatch into a confirmation-only guide turn', async()=>{
 vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(true)
 const state={step:'pick_contractor',role:'contractor',updatedAt:new Date().toISOString(),propertyId:'test-property'}
 const db=query([])
 db.from.mockImplementation((table:string)=>query(table==='sms_conversations'?[{intake_state:{home_check_guide:state}}]:[]).from(table))
 const action=await prepareHomeCheckSms(context(db,'Vendor test disposble',[],true))
 expect(action?.kind).toBe('guide')
 if(action?.kind!=='guide') throw Error('Expected Home Check routing')
 const turn=reduceHomeCheckGuide({state:state as never,body:action.body,sender:action.sender,now:new Date(),catalog:{properties:[],vendors:[{id:'test-vendor',name:'Disposable test vendor',distanceKm:null}],tenant:null}})
 expect(turn.state?.vendorConfirmId).toBe('test-vendor')
 expect(turn.replies[0]).toContain('Did you mean Disposable test vendor?')
 expect(turn.effects).toEqual([])
})

describe('carrier-split vendor upload collection', () => {
 const paths=['sms/a.jpg','sms/b.jpg','sms/c.jpg','sms/d.jpg']
 function collectingDb(expired = false, selectedId = 'check') {
  const db=query([])
  db.from.mockImplementation((table:string)=>query(
   table==='home_check_sms_capture_sessions' ? [{check_id:selectedId,expected_slot:'water_heater_label',version:'v',expires_at:new Date(Date.now()+(expired ? -600000 : 600000)).toISOString()}] :
   table==='home_checks' ? [{...pending,visit:{phase:'in_progress'}}] : []
  ).from(table))
  return db
 }
 it.each([1,2,4])('collects %s carrier attachments for the explicitly selected active vendor visit',async count=>{
  const result=await prepareHomeCheckSms(context(collectingDb(),'',paths.slice(0,count)))
  expect(result).toMatchObject({kind:'vendor_collect',paths:paths.slice(0,count),check:{id:'check'}})
 })
 it.each([1,2,4])('keeps %s delayed carrier attachments in batch routing after session expiry',async count=>{
  const result=await prepareHomeCheckSms(context(collectingDb(true),'',paths.slice(0,count)))
  expect(result).toMatchObject({kind:'vendor_collect',expectedVersion:'v',check:{id:'check'}})
 })
 it('keeps the explicit expired selection when another vendor check is also open',async()=>{
  const db=collectingDb(true),original=db.from.getMockImplementation()!
  db.from.mockImplementation((table:string)=>table==='home_checks'?query([{...pending,visit:{phase:'in_progress'}},{...pending,id:'other',visit:{phase:'in_progress'}}]).from(table):original(table))
  expect(await prepareHomeCheckSms(context(db,'',paths))).toMatchObject({kind:'vendor_collect',check:{id:'check'},expectedVersion:'v'})
 })
 it('does not infer the selected vendor check from a different expired selection',async()=>{
  const result=await prepareHomeCheckSms(context(collectingDb(true,'other-check'),'',paths.slice(0,1)))
  expect(result?.kind).not.toBe('vendor_collect')
 })
 it('a changed selection never continues into classification or attachment',async()=>{
  const db=collectingDb(true);db.rpc.mockResolvedValue({data:{status:'stale'},error:null})
  vi.mocked(identifyVendorHomeCheckBatch).mockClear()
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',expectedVersion:'v',check:pending as never,paths,conversationId:'conv'})
  expect(db.rpc).toHaveBeenCalledWith('collect_selected_home_check_vendor_photos',{p_landlord_id:'landlord',p_conversation_id:'conv',p_check_id:'check',p_capture_version:'v',p_paths:paths})
  expect(result.reply).toContain('selected Home Check changed')
  expect(identifyVendorHomeCheckBatch).not.toHaveBeenCalled()
 })
 it('sends one receiving acknowledgement and keeps later partial receipts quiet',async()=>{
  for(const count of [1,2,3]) {
   const db=collectingDb();db.rpc.mockResolvedValue({data:{status:'collecting',count},error:null})
   const result=await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',expectedVersion:'v',check:pending as never,paths:[paths[count-1]],conversationId:'conv'})
   expect(result.reply).toEqual(count===1?expect.stringContaining('If you’ve sent all four photos, please wait'):undefined)
  }
 })
 it.each(['duplicate','processing'])('does not send repeated messages for %s delivery',async status=>{
  const db=collectingDb();db.rpc.mockResolvedValue({data:{status},error:null})
  expect(await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',expectedVersion:'v',check:pending as never,paths,conversationId:'conv'})).toEqual({})
 })
 it('does not claim success when provenance or queue storage fails',async()=>{
  const db=collectingDb();db.rpc.mockResolvedValue({data:null,error:{message:'scope mismatch'}})
  expect((await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',expectedVersion:'v',check:pending as never,paths,conversationId:'conv'})).reply).toContain('could not safely group')
 })
 it('retains the group for audit and enables guided recovery after uncertain classification',async()=>{
  const db=collectingDb()
  db.rpc.mockImplementation(async(name:string)=>name==='collect_selected_home_check_vendor_photos'?{data:{status:'ready',paths,claim:'token'},error:null}:{data:true,error:null})
  vi.mocked(identifyVendorHomeCheckBatch).mockResolvedValueOnce(null)
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',expectedVersion:'v',check:pending as never,paths,conversationId:'conv'})
  expect(result.reply).toContain('No equipment records were saved')
  expect(db.rpc).toHaveBeenCalledWith('finish_home_check_vendor_photos',{p_landlord_id:'landlord',p_conversation_id:'conv',p_check_id:'check',p_claim:'token'})
 })
})

it.each([2,3])('acknowledges an initial carrier delivery containing %s photos',async count=>{
 const db=query([])
 db.rpc.mockResolvedValue({data:{status:'collecting',count,first:true},error:null})
 const result=await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',expectedVersion:'v',check:pending as never,paths:['a','b','c'].slice(0,count),conversationId:'conv'})
 expect(result.reply).toContain('If you’ve sent all four photos, please wait')
 expect(result.reply).not.toMatch(/remaining|Received \d of/)
})

it('stores safe batch diagnostics even when photo identification fails',async()=>{
 vi.mocked(identifyVendorHomeCheckBatch).mockImplementationOnce(async(_paths,_read,_identify,observe)=>{observe?.({stage:'reader',photoIndex:2,outcome:'timeout',durationMs:10000,provider:null});return null})
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'vendor_batch',check:pending as never,paths:['private/a','private/b','private/c','private/d'],conversationId:'conv'})
 expect(result.reply).toContain('Please do not resend')
 const metadata=vi.mocked(homeCheckEvent).mock.calls.filter(call=>call[2]==='photo_batch_identification_diagnostics').at(-1)?.[3]
 expect(metadata).toMatchObject({schemaVersion:1,traceId:expect.any(String),diagnostics:[{stage:'reader',photoIndex:2,outcome:'timeout',durationMs:10000,provider:null}]})
 expect(JSON.stringify(metadata)).not.toContain('private/')
})
it('slow diagnostic persistence cannot indefinitely block photo handling',async()=>{
 vi.useFakeTimers();const log=vi.spyOn(console,'info').mockImplementation(()=>{})
 try {
  vi.mocked(homeCheckEvent).mockImplementation(()=>new Promise(()=>{}))
  vi.mocked(identifyVendorHomeCheckBatch).mockResolvedValueOnce(null)
  const task=actHomeCheckSms(actDb([]) as never,'landlord',{kind:'vendor_batch',check:pending as never,paths:['a','b','c','d'],conversationId:'conv'})
  await vi.advanceTimersByTimeAsync(2000)
  expect((await task).reply).toContain('No equipment records were saved')
  expect(log).toHaveBeenCalled()
 } finally {vi.useRealTimers();log.mockRestore();vi.mocked(homeCheckEvent).mockResolvedValue(undefined)}
})

describe('guided photo burst serialization',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(readHomeCheckPhoto).mockResolvedValue(null)})
 it('claims the step before any AI call and lets just one burst worker ask a question',async()=>{
  const db=actDb([]),original=db.rpc.getMockImplementation()!;let busy=false,version='version'
  db.rpc.mockImplementation(async(name:string,args:any)=>{
   if(name==='home_check_sms_capture_context'){
    if(args.p_action==='claim'){
     if(busy||args.p_version!==version)return {data:{ok:false,reason:'busy'},error:null}
     busy=true;return {data:{ok:true,claim:'owner',version},error:null}
    }
    if(args.p_action==='release'){busy=false;version='changed';return {data:{ok:true,version},error:null}}
   }
   return original(name,args)
  })
  vi.mocked(readHomeCheckPhoto).mockImplementationOnce(async()=>{
   expect(busy).toBe(true);await Promise.resolve();return {category:'hvac',photoView:{equipment:'heating_system',framing:'whole_appliance',confidence:'high'}} as never
  })
  const actions=['a','b','c','d'].map(p=>({kind:'photo' as const,check:{...pending,role:'landlord'} as never,slot:'water_heater_label' as const,expectedVersion:'version',path:`sms/${p}.jpg`,conversationId:'conv'}))
  const results=await Promise.all(actions.map(a=>actHomeCheckSms(db as never,'landlord',a)))
  expect(results.filter(r=>r.reply)).toHaveLength(1)
  expect(results.find(r=>r.reply)?.reply).toContain('What does this photo or video show?')
  expect(readHomeCheckPhoto).toHaveBeenCalledTimes(1);expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
  expect(busy).toBe(false)
 })
 it('does not run AI for an old step version and does not emit a competing retry prompt',async()=>{
  const db=actDb([]);db.rpc.mockResolvedValue({data:{ok:false,reason:'stale'},error:null})
  expect(await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_label',expectedVersion:'old',path:'sms/a.jpg',conversationId:'conv'})).toEqual({})
  expect(readHomeCheckPhoto).not.toHaveBeenCalled();expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 })
})

it('mutes sibling MMS that arrived before the held-photo prompt instead of sending duplicate reminders',async()=>{
 const db=query([]);const now=Date.now()
 db.from.mockImplementation((table:string)=>query(table==='home_checks'?[{...pending,role:'landlord'}]:table==='home_check_sms_capture_sessions'?[{check_id:'check',expected_slot:'water_heater_label',version:'v',expires_at:new Date(now+600000).toISOString()}]:table==='sms_conversations'?[{intake_state:{home_check_photo_pending:{step:'kind',path:'first',checkId:'check',at:new Date(now).toISOString()}}}]:table==='sms_messages'?[{created_at:new Date(now-1000).toISOString()}]:[]).from(table))
 expect(await prepareHomeCheckSms(context(db,'',['sibling'],true))).toEqual({kind:'quiet'})
 expect(await actHomeCheckSms(db as never,'landlord',{kind:'quiet'})).toEqual({})
})

it.each([true,false])('retains three matched vendor views only after atomic retake preparation (%s)',async allowed=>{
 const db=actDb([]);const paths=['a','b','c','d']
 const diagnostic:any[]=[
  {stage:'placement',photoIndex:0,outcome:'success',slot:'water_heater_label',view:{equipment:'water_heater',framing:'label_closeup',confidence:'high'},durationMs:0},
  {stage:'placement',photoIndex:1,outcome:'success',slot:'water_heater_whole',view:{equipment:'water_heater',framing:'whole_appliance',confidence:'high'},durationMs:0},
  {stage:'placement',photoIndex:2,outcome:'not_equipment',slot:null,view:{equipment:'other',framing:'label_closeup',confidence:'high'},durationMs:0},
  {stage:'placement',photoIndex:3,outcome:'success',slot:'heating_whole',view:{equipment:'heating_system',framing:'whole_appliance',confidence:'high'},durationMs:0},
 ]
 db.rpc.mockImplementation(async(name:string)=>({data:name==='collect_selected_home_check_vendor_photos'?{status:'ready',paths,claim:'token'}:name==='prepare_home_check_vendor_photo_retake'?allowed:true,error:null}))
 vi.mocked(identifyVendorHomeCheckBatch).mockImplementationOnce(async(_paths,_read,_identify,observe)=>{diagnostic.forEach(e=>observe?.(e));return null})
 const result=await actHomeCheckSms(db as never,'landlord',{kind:'vendor_collect',check:pending as never,conversationId:'conv',expectedVersion:'v',paths})
 expect(db.rpc).toHaveBeenCalledWith('prepare_home_check_vendor_photo_retake',expect.objectContaining({p_claim:'token',p_capture_version:'v',p_keep_paths:['a','b','d'],p_missing_slot:'heating_label'}))
 expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 if(allowed){expect(result.reply).toContain('kept the other three');expect(result.reply).toContain('heating-system label');expect(db.rpc.mock.calls.some(c=>c[0]==='finish_home_check_vendor_photos')).toBe(false)}
 else {expect(result.reply).not.toContain('kept the other three');expect(db.rpc).toHaveBeenCalledWith('finish_home_check_vendor_photos',expect.anything())}
})
it.each(['processing','rate_limited','awaiting_photo','unavailable'])('handles saved-photo retry status without re-running AI (%s)',async status=>{
 vi.mocked(identifyVendorHomeCheckBatch).mockClear();vi.mocked(uploadHomeCheckPhoto).mockClear()
 const db=actDb([]);db.rpc.mockResolvedValue({data:{status},error:null})
 await actHomeCheckSms(db as never,'landlord',{kind:'vendor_retry',check:pending as never,conversationId:'conv',expectedVersion:'v'})
 expect(identifyVendorHomeCheckBatch).not.toHaveBeenCalled();expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 expect(db.rpc).toHaveBeenCalledWith('retry_home_check_vendor_photos',{p_landlord_id:'landlord',p_conversation_id:'conv',p_check_id:'check',p_capture_version:'v'})
})

it.each([true,false])('normalizes a recovered heating-label selection only under its batch lease (%s)', async allowed => {
 const db=actDb([]); const paths=['a','b','c','d'];
 vi.mocked(uploadHomeCheckPhoto).mockClear();
 vi.mocked(identifyVendorHomeCheckBatch).mockResolvedValueOnce(paths.map((path,i)=>({path,slot:['water_heater_label','water_heater_whole','heating_label','heating_whole'][i],bytes:new Uint8Array([1]),contentType:'image/jpeg'})) as never);
 db.rpc.mockImplementation(async(name:string)=>({data:name==='prepare_home_check_vendor_batch_attachment'?allowed:{ok:true,claim:'claim'},error:null}));
 const result=await actHomeCheckSms(db as never,'landlord',{kind:'vendor_batch',check:pending as never,paths,conversationId:'conv',batchClaim:'lease',captureVersion:'selected'});
 expect(db.rpc).toHaveBeenCalledWith('prepare_home_check_vendor_batch_attachment',{p_landlord_id:'landlord',p_conversation_id:'conv',p_check_id:'check',p_claim:'lease',p_capture_version:'selected'});
 expect(result.reply).toContain(allowed?'four uploaded photos are retained':'could not safely save');
 expect(result.reply).toContain('RETRY PHOTOS');
 expect(result.reply).not.toContain('Please send a photo');
 expect(uploadHomeCheckPhoto).not.toHaveBeenCalled();
});

it.each([true,false])('resumes only the original scoped held-photo question without uploading (%s)',async allowed=>{
 const db=actDb([]);db.rpc.mockResolvedValue({data:allowed?{checkId:'check',expectedSlot:null}:null,error:null});
 db.from.mockImplementation((table:string)=>query(table==='home_checks'?[pending]:[]).from(table));
 vi.mocked(uploadHomeCheckPhoto).mockClear();
 const result=await prepareHomeCheckSms(context(db,'RESUME PHOTOS',[],true));
 expect(result).toMatchObject({kind:'clarify',reply:expect.stringContaining(allowed?'What does this photo or video show?':'No photo was changed')});
 expect(db.rpc).toHaveBeenCalledWith('resume_home_check_sms_photo',expect.objectContaining({p_landlord_id:'landlord',p_conversation_id:'conv',p_to:'+15550001111'}));
 expect(uploadHomeCheckPhoto).not.toHaveBeenCalled();
});

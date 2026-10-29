import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actHomeCheckSms,
  prepareHomeCheckSms,
  resolveHomeCheckLandlord,
  runHomeCheckReminder,
} from './sms.ts'
import { createHomeCheck, sendHomeCheckSms, uploadHomeCheckPhoto } from './service.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'
import { isLandlordAccountOrOpsPhone } from '../sms/landlordAccountPhone.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

vi.mock('../sms/inbound_db.ts', () => ({ normalizeSmsPhone: (phone: string) => phone }))
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
  for (const method of ['select', 'eq', 'in', 'gt', 'not', 'is', 'update']) {
    builder[method] = (...args: unknown[]) => {
      filters.push([method, args])
      return builder
    }
  }
  builder.maybeSingle = () =>
    Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })
  builder.single = builder.maybeSingle
  return { from: vi.fn(() => builder), filters }
}
function actDb(photoSlots: string[]) {
  const updates: unknown[] = []
  const base = query([])
  base.from.mockImplementation((table: string) => {
    const q = query(table === 'home_check_photos' ? photoSlots.map((slot) => ({ slot })) : [{ intake_state: {} }]).from(table) as Record<string, unknown>
    const update = q.update as (...args: unknown[]) => unknown
    q.update = (value: unknown) => {
      updates.push(value)
      return update(value)
    }
    return q
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
    for (const body of ['STOP', 'START', 'HELP', 'The sink is leaking', 'YES']) {
      expect(await prepareHomeCheckSms(context(db, body))).toBeNull()
    }
    expect(db.from).not.toHaveBeenCalled()
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
  it('files a photo with no text against the only open check and reads it for the slot', async () => {
    expect(await prepareHomeCheckSms(context(query([pending]), '', ['sms/a.jpg']))).toMatchObject({
      kind: 'photo',
      check: { id: 'check' },
      slot: null,
      path: 'sms/a.jpg',
    })
  })
  it('uses the newest check when every open check is for the same place', async () => {
    const older = { ...pending, id: 'older', property_id: 'p', unit_id: null, created_at: '2026-10-27T12:00:00Z' }
    const newer = { ...pending, id: 'newer', property_id: 'p', unit_id: null, created_at: '2026-10-28T12:00:00Z' }
    expect(await prepareHomeCheckSms(context(query([older, newer]), '', ['sms/a.jpg']))).toMatchObject({
      kind: 'photo',
      check: { id: 'newer' },
      slot: null,
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

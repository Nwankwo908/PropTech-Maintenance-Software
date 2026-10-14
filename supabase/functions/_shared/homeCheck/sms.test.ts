import { describe, expect, it, vi } from 'vitest'
import { prepareHomeCheckSms, resolveHomeCheckLandlord, runHomeCheckReminder } from './sms.ts'
import { sendHomeCheckSms } from './service.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

vi.mock('../sms/inbound_db.ts', () => ({ normalizeSmsPhone: (phone: string) => phone }))
vi.mock('./service.ts', () => ({
  requireData: ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) throw error
    return data
  },
  checkLocation: (check: { property_label: string; unit_label: string }) =>
    `${check.property_label} / ${check.unit_label}`,
  checked: (value: PromiseLike<unknown>) => Promise.resolve(value),
  sendHomeCheckSms: vi.fn(async () => {}),
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
  it('reserves CHECK initiation for landlord identities', async () => {
    const db = query([])
    expect(await prepareHomeCheckSms(context(db, 'CHECK 12A'))).toBeNull()
    expect(await prepareHomeCheckSms(context(db, 'CHECK 12A', [], true))).toMatchObject({
      kind: 'start',
      command: { role: 'tenant', target: '12A' },
    })
    expect(db.from).not.toHaveBeenCalled()
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
      const [body, media] of [['', ['sms/a.jpg']], ['HC-000000000000 1', ['sms/a.jpg']], [
        `${pending.reference} 1`,
        ['sms/a.jpg', 'sms/b.jpg'],
      ], [`${pending.reference} 1`, ['https://example.com/a.jpg']]] as Array<[string, string[]]>
    ) {
      expect(await prepareHomeCheckSms(context(query([pending]), body, media))).toMatchObject({
        kind: 'clarify',
      })
    }
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
  it('claims the single reminder before sending and skips subsequent cron calls', async () => {
    vi.mocked(sendHomeCheckSms).mockClear()
    const db = query([{ id: 'check' }])
    await runHomeCheckReminder(db as never, pending as never)
    expect(db.filters).toContainEqual(['is', ['reminder_claimed_at', null]])
    expect(db.filters).toContainEqual(['eq', ['status', 'collecting']])
    await runHomeCheckReminder(query([]) as never, pending as never)
    expect(sendHomeCheckSms).toHaveBeenCalledTimes(1)
  })
  it('a provider failure does not create a second reminder attempt', async () => {
    vi.mocked(sendHomeCheckSms).mockClear().mockRejectedValueOnce(new Error('Provider timeout'))
    await expect(runHomeCheckReminder(query([{ id: 'check' }]) as never, pending as never)).rejects
      .toThrow('Provider timeout')
    await runHomeCheckReminder(query([]) as never, pending as never)
    expect(sendHomeCheckSms).toHaveBeenCalledTimes(1)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHomeCheck } from './service.ts'
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

function client(ownerPhone: string | null = '+15553334444', vendorPhone: string | null = '+15558889999') {
  let check: Record<string, unknown> | null = null
  const rpc = vi.fn(async (_name: string, args: { p_input: Record<string, unknown> }) => {
    check = { ...args.p_input, workflow_run_id: 'workflow', status: 'collecting' }
    return { data: null, error: null }
  })
  return {
    rpc,
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
          ? single ? check : []
          : [],
      })
      const builder: Record<string, unknown> = {
        then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(result())),
      }
      for (const method of ['select', 'eq', 'gte']) builder[method] = () => builder
      for (const method of ['insert', 'update']) {
        builder[method] = () => {
          mutation = true
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
  it('sends contractor instructions and the capture link only to the selected vendor', async () => {
    const db = client()
    await createHomeCheck(db as never, {
      ...request, role: 'contractor', vendorId: 'vendor',
      jobWindowEnd: new Date(Date.now() + 86400000).toISOString(),
    })
    expect(sendInboundAutoReply).toHaveBeenCalledTimes(1)
    expect(sendInboundAutoReply).toHaveBeenCalledWith(db, expect.objectContaining({
      toNumber: '+15558889999',
      body: expect.stringContaining('Open the link for guided steps'),
    }))
    const body = vi.mocked(sendInboundAutoReply).mock.calls[0][1].body
    expect(body).toContain('https://app.ulohome.io/c/')
    expect(body).toContain('No repairs are authorized')
    expect(body).not.toContain('For text photos:')
    expect(body).not.toContain('Forward this')
    expect(body).not.toContain('filter dates')
    expect(body).not.toContain('Last service')
    expect(body.trim().split('\n').at(-1)).toMatch(/^https:\/\/app\.ulohome\.io\/c\//)
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
})

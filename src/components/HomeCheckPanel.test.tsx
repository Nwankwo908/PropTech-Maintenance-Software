import { removeInspectionAsset } from '@/api/inspectionAssetAssess'
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { homeCheckRequest } from '@/api/homeCheck'
import { HomeCheckCapturePage } from '@/components/HomeCheckCapturePage'
import { HomeCheckPanel, oneRowPerAppliance, previousSerialForReview } from '@/components/HomeCheckPanel'
import { HOME_CHECK_CHANGED_EVENT } from '@/lib/homeCheckEvents'
import type { HomeCheckField } from '@shared/homeCheck'

vi.mock('@/api/inspectionAssetAssess', () => ({ removeInspectionAsset: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('@/lib/assetRegistry', () => ({ notifyAssetRegistryChanged: vi.fn() }))
vi.mock('@/api/homeCheck', () => ({ homeCheckRequest: vi.fn() }))

function field(value: string | null): HomeCheckField {
  return {
    value,
    source: 'photo_text',
    capturedBy: 'landlord',
    confidence: 'low',
    photoIds: [],
  }
}

function asset(id: string, system: 'water_heater' | 'heating') {
  return {
    id,
    system,
    verified: false,
    manufactureDate: { year: null, month: null },
    fields: {
      make: field(null),
      model: field(null),
      serial: field(null),
      approximateAge: field(null),
      condition: field(null),
      lastService: field(null),
      lastFilterChange: field(null),
    },
  }
}

type ListedHomeCheckFixture = Parameters<typeof previousSerialForReview>[0]
type AssessmentRow = Parameters<typeof oneRowPerAppliance>[0][number]

const openCheck = {
  id: 'check',
  reference: 'HC-100',
  property_label: '14 Maple Ave',
  unit_label: null,
  status: 'completed',
  expires_at: '2026-11-01T00:00:00.000Z',
  completed_at: '2026-10-25T00:00:00.000Z',
  confirmed_at: null,
  labels_readable: false,
  assets: [asset('heater', 'water_heater'), asset('furnace', 'heating')],
  photos: [
    { slot: 'water_heater_label', previewUrl: null as string | null, state: 'ready' },
    { slot: 'heating_label', previewUrl: null as string | null, state: 'ready' },
  ],
  role: 'landlord',
  sent: 0,
  opened: 0,
  completed: 1,
  labelReadable: 0,
  confirmed: 0,
  averageMinutes: null,
  issueShare: null,
  approvedJobShare: null,
}

afterEach(() => cleanup())
beforeEach(() => { vi.mocked(homeCheckRequest).mockReset(); vi.mocked(removeInspectionAsset).mockReset() })

describe('Home Check results', () => {
  afterEach(() => cleanup())
  beforeEach(() => {
    vi.mocked(homeCheckRequest).mockReset()
    vi.mocked(removeInspectionAsset).mockReset()
  })

  it('keeps one water heater and one heating system when another check repeats them', async () => {
    const older = {
      ...openCheck,
      id: 'older',
      assets: [
        asset('old-heater', 'water_heater'),
        asset('old-furnace', 'heating'),
      ],
    }
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [openCheck, older], metrics: [] })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    expect(await screen.findAllByText('Water heater')).toHaveLength(1)
    expect(screen.getAllByText('Heating system')).toHaveLength(1)
  })

  it('does not show or restore another property’s rows while switching or receiving a late response', async () => {
    const oldAsset = asset('old-asset', 'water_heater')
    oldAsset.fields.make = field('Old property brand')
    const newAsset = asset('new-asset', 'water_heater')
    newAsset.fields.make = field('New property brand')
    let finishOld!: (value: unknown) => void
    let finishNew!: (value: unknown) => void
    let oldCalls = 0
    vi.mocked(homeCheckRequest).mockImplementation((body: Record<string, unknown>) => {
      if (body.action !== 'list') return Promise.resolve({ reviews: [] }) as never
      if (body.propertyId === 'maple' && oldCalls++ === 0) return Promise.resolve({ checks: [{ ...openCheck, assets: [oldAsset] }], metrics: [] }) as never
      return new Promise(resolve => { if (body.propertyId === 'maple') finishOld = resolve; else finishNew = resolve }) as never
    })
    const view = render(<HomeCheckPanel building='Maple' propertyId='maple' />)
    expect((await screen.findAllByText(/Old property brand/)).length).toBeGreaterThan(0)
    act(() => window.dispatchEvent(new CustomEvent(HOME_CHECK_CHANGED_EVENT, { detail: { propertyId: 'maple' } })))
    view.rerender(<HomeCheckPanel building='Birch' propertyId='birch' />)
    expect(screen.queryAllByText(/Old property brand/)).toHaveLength(0)
    await act(async () => finishNew({ checks: [{ ...openCheck, assets: [newAsset] }], metrics: [] }))
    expect((await screen.findAllByText(/New property brand/)).length).toBeGreaterThan(0)
    await act(async () => finishOld({ checks: [{ ...openCheck, assets: [oldAsset] }], metrics: [] }))
    expect(screen.queryAllByText(/Old property brand/)).toHaveLength(0)
    expect(screen.getAllByText(/New property brand/).length).toBeGreaterThan(0)
  })

  it('hides an unmatched appliance and explains it above the table', async () => {
    const mismatched = {
      ...openCheck,
      assets: [
        {
          ...asset('heater', 'water_heater'),
          labelReadability: {
            status: 'uncertain' as const,
            modelConfidence: 0,
            serialConfidence: 0,
            uncertainCharacters: [],
            formatWarnings: [],
            retakeRequested: true,
            retakeMessage: 'These photos do not match the selected system. Send its whole-equipment photo and data plate.',
          },
        },
        asset('furnace', 'heating'),
      ],
    }
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [mismatched], metrics: [] })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('Recent photos do not match the selected system. Please try again.')
    expect(banner.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Water heater')).toBeNull()
    const heating = screen.getByText('Heating system')
    expect(banner.compareDocumentPosition(heating) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the equipment table without the retired capture instructions', async () => {
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [openCheck], metrics: [] })
    const html = render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    const header = await screen.findByRole('heading', { name: 'Appliance equipment' })
    const waterHeater = screen.getByText('Water heater')
    expect(header.compareDocumentPosition(waterHeater) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(html.container.textContent).not.toContain('Scan property equipment')
    expect(html.container.textContent).not.toContain('I’ll do it')
    expect(html.container.textContent).not.toContain('Ask my tenant')
    expect(html.container.textContent).not.toContain('Open my Home Check')
    expect(html.container.textContent).not.toContain('HC-100')
    expect(html.container.textContent).not.toContain('14 Maple Ave')
    expect(html.container.textContent).not.toContain('collecting')
  })

  it('shows multiple unfinished checks without repeated edit/confirm buttons or an Action column', async () => {
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [openCheck, { ...openCheck, id: 'second-check' }], metrics: [] })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    expect(await screen.findByText('Water heater')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit selected/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm asset records' })).toBeNull()
    expect(screen.queryByText('Action', { exact: true })).toBeNull()
    expect(screen.getByText('Brand / Model')).toBeTruthy()
    expect(screen.getByText('Made')).toBeTruthy()
    expect(screen.getByText('Condition')).toBeTruthy()
  })

  it('reloads the table after either upload entry finishes', async () => {
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [], metrics: [] })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    await waitFor(() => expect(homeCheckRequest).toHaveBeenCalled())
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [openCheck], metrics: [] })
    window.dispatchEvent(new CustomEvent(HOME_CHECK_CHANGED_EVENT, { detail: { propertyId: 'maple' } }))
    expect(await screen.findByText('Water heater')).toBeTruthy()
  })
})

describe('retired Home Check links', () => {
  it('explains the old page and does not offer another upload', () => {
    const html = render(<HomeCheckCapturePage />)
    expect(html.container.textContent).toContain('This Home Check link is no longer used')
    expect(html.container.querySelector('input')).toBeNull()
  })
})

describe('Home Check document table placement', () => {
  afterEach(cleanup)
  it('does not render photo follow-up prose below the equipment table', async () => {
    vi.mocked(homeCheckRequest).mockResolvedValue({ checks: [{ ...openCheck, issue_ticket_id: 'photo-review', detected_warning: 'The TPR line must run downward' }], metrics: [] })
    render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
    expect(await screen.findByText('Water heater')).toBeTruthy()
    expect(screen.queryByText(/Follow-up opened/)).toBeNull()
    expect(screen.queryByText(/TPR line must/)).toBeNull()
  })
})


it('shows Delete selected only after selection and deletes only the checked record', async () => {
  let assets = [...openCheck.assets]
  vi.mocked(homeCheckRequest).mockImplementation(async () => ({checks:[{...openCheck,assets}],metrics:[]}))
  vi.mocked(removeInspectionAsset).mockImplementation(async id=>{assets=assets.filter(asset=>asset.id!==id)})
  render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
  expect(await screen.findByText('Water heater')).toBeTruthy()
  expect(screen.queryByRole('button',{name:/Delete selected/})).toBeNull()
  fireEvent.click(screen.getByLabelText('Select Water heater'))
  fireEvent.click(screen.getByRole('button',{name:'Delete selected (1)'}))
  await waitFor(()=>expect(removeInspectionAsset).toHaveBeenCalledExactlyOnceWith('heater'))
  await waitFor(()=>expect(screen.queryByText('Water heater')).toBeNull())
  expect(screen.getByText('Heating system')).toBeTruthy()
  expect(screen.queryByRole('button',{name:/Delete selected/})).toBeNull()
})
it('keeps failed deletion selected and shows its error',async()=>{
  vi.mocked(homeCheckRequest).mockResolvedValue({checks:[openCheck],metrics:[]})
  vi.mocked(removeInspectionAsset).mockRejectedValueOnce(Error('Deletion failed'))
  render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' />)
  expect(await screen.findByText('Water heater')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Select Water heater'))
  fireEvent.click(screen.getByRole('button',{name:'Delete selected (1)'}))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','Deletion failed')
  expect(screen.getByText('Water heater')).toBeTruthy()
  expect(screen.getByRole('button',{name:'Delete selected (1)'})).toBeTruthy()
})

it('on partial failure clears only successful selections and reports the remaining failure',async()=>{
  let assets=[...openCheck.assets]
  vi.mocked(homeCheckRequest).mockImplementation(async()=>({checks:[{...openCheck,assets}],metrics:[]}))
  vi.mocked(removeInspectionAsset).mockImplementation(async id=>{
    if(id==='furnace')throw Error('Furnace deletion failed')
    assets=assets.filter(asset=>asset.id!==id)
  })
  const onDeleted=vi.fn()
  render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple' onAssetsDeleted={onDeleted} />)
  expect(await screen.findByText('Water heater')).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Select all assets'))
  fireEvent.click(screen.getByRole('button',{name:'Delete selected (2)'}))
  await waitFor(()=>expect(onDeleted).toHaveBeenCalledWith(['heater']))
  expect(screen.getByRole('alert').textContent).toContain('Deleted 1 of 2 selected records')
  expect(screen.queryByText('Water heater')).toBeNull()
  expect(screen.getByText('Heating system')).toBeTruthy()
  expect(screen.getByRole('button',{name:'Delete selected (1)'})).toBeTruthy()
  expect(vi.mocked(removeInspectionAsset).mock.calls.map(call=>call[0])).toEqual(['heater','furnace'])
})

it('shows the newest Home Check draft without reviving an older verified serial',()=>{
 const old={id:'old',recordedAt:'2026-10-30T12:00:00Z',categoryLabel:'Heating system',actionLabel:'Details verified',result:{category:'hvac',identifiedItem:{type:'furnace',brand:'ICP',serialNumber:'OLD'}}} as AssessmentRow
 const latest={id:'latest',recordedAt:'2026-11-03T12:00:00Z',categoryLabel:'Heating system',actionLabel:'Review details',result:{category:'hvac',identifiedItem:{type:'indoor_section',brand:'ICP'}}} as AssessmentRow
 expect(oneRowPerAppliance([old,latest])).toEqual([latest]);
 expect(oneRowPerAppliance([latest,old])).toEqual([latest]);
 expect(oneRowPerAppliance([latest,old])[0]?.result?.identifiedItem.serialNumber).toBeUndefined();
});
it('opens the exact label photo and saves a scoped serial review without confirming the check',async()=>{
 const check=structuredClone(openCheck);check.assets[1]!.fields.serial.photoIds=['heating-photo'];
 check.photos=[{slot:'heating_label',previewUrl:'https://example.invalid/heating-label',state:'ready'}];
 vi.mocked(homeCheckRequest).mockImplementation(async body=>body.action==='serial_review'?{ok:true}:{checks:[check],metrics:[]} as never);
 render(<HomeCheckPanel building='14 Maple Ave' propertyId='maple'/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review serial number'}));
 expect((screen.getByAltText('Appliance label for this Home Check') as HTMLImageElement).src).toBe('https://example.invalid/heating-label');
 fireEvent.change(screen.getByLabelText('Serial number'),{target:{value:'X132753655'}});
 fireEvent.click(screen.getByRole('button',{name:'Save serial number'}));
 await waitFor(()=>expect(homeCheckRequest).toHaveBeenCalledWith({action:'serial_review',id:'check',propertyId:'maple',assetId:'furnace',photoId:'heating-photo',serial:'X132753655',unknown:false}));
 expect(vi.mocked(homeCheckRequest).mock.calls.some(([b])=>b.action==='confirm'||b.action==='photo_review')).toBe(false);
});

it('retains only a matching confirmed historical serial as a review candidate',()=>{
 const current=asset('current','heating');current.fields.make=field('ICP');current.fields.model=field('MODEL');
 const old=asset('old','heating');old.verified=true;old.fields.make=field('ICP');old.fields.model=field('MODEL');old.fields.serial=field('X132753655');
 const check={...openCheck,created_at:'2026-11-03T00:00:00Z',assets:[current]};
 const prior={...openCheck,id:'prior',created_at:'2026-10-29T00:00:00Z',confirmed_at:'2026-10-30T00:00:00Z',assets:[old]};
 const asCheck = (value: unknown) => value as ListedHomeCheckFixture
 const asAsset = (value: unknown) => value as ListedHomeCheckFixture['assets'][number]
 expect(previousSerialForReview(asCheck(check),asAsset(current),[asCheck(prior)])).toBe('X132753655');
 expect(current.fields.serial.value).toBe(null);
 expect(previousSerialForReview(asCheck(check),asAsset(current),[asCheck({...prior,unit_label:'2'})])).toBeUndefined();
 old.fields.model=field('OTHER');expect(previousSerialForReview(asCheck(check),asAsset(current),[asCheck(prior)])).toBeUndefined();
 old.fields.model=field('MODEL');current.fields.serial.source='landlord';expect(previousSerialForReview(asCheck(check),asAsset(current),[asCheck(prior)])).toBeUndefined();
});

it('shows the previous serial in the current row and confirms it without typing',async()=>{
 const current=asset('current','heating');current.fields.make=field('ICP');current.fields.model=field('MODEL');current.fields.serial.photoIds=['label'];
 const old=structuredClone(current);old.id='old';old.verified=true;old.fields.serial=field('X132753655');
 const check={...openCheck,created_at:'2026-11-03T00:00:00Z',assets:[current],photos:[{slot:'heating_label',previewUrl:'https://example.invalid/label'}]};
 const prior={...openCheck,id:'prior',created_at:'2026-10-29T00:00:00Z',confirmed_at:'2026-10-30T00:00:00Z',assets:[old]};
 vi.mocked(homeCheckRequest).mockImplementation(async body=>body.action==='serial_review'?{ok:true}:{checks:[check,prior],metrics:[]} as never);
 render(<HomeCheckPanel building='Maple' propertyId='maple'/>);
 expect(await screen.findByText('Previously saved')).toBeTruthy();expect(screen.getByText('X132753655')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Review serial number'}));
 expect((screen.getByLabelText('Serial number') as HTMLInputElement).value).toBe('X132753655');
 expect(vi.mocked(homeCheckRequest).mock.calls.some(([b])=>b.action==='serial_review')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Confirm serial number'}));
 await waitFor(()=>expect(homeCheckRequest).toHaveBeenCalledWith({action:'serial_review',id:'check',propertyId:'maple',assetId:'current',photoId:'label',serial:'X132753655',unknown:false}));
});

/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listInspectionAssets } from '@/api/inspectionAssetAssess'
import { ApplianceInspectionUploader } from '@/components/ApplianceInspectionUploader'

vi.mock('@/lib/prepareInspectionDocumentUpload', () => ({ prepareInspectionDocumentUpload: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('@/lib/assetRegistry', () => ({ notifyAssetRegistryChanged: vi.fn() }))
vi.mock('@/api/inspectionAssetAssess', () => ({
  loadBuildingInspectionSession: vi.fn().mockResolvedValue({ id: 'session', photos: [] }),
  listInspectionAssets: vi.fn().mockResolvedValue([]),
  signInspectionUploadUrls: vi.fn().mockResolvedValue(new Map()),
  confirmInspectionPhoto: vi.fn(),
  removeInspectionAsset: vi.fn(),
  removeInspectionPhoto: vi.fn(),
  retryInspectionPhoto: vi.fn(),
  updateInspectionAssetDetails: vi.fn(),
  uploadAndAnalyzeInspectionPhoto: vi.fn(),
}))
vi.mock('@/components/HomeCheckPanel', () => ({
  HomeCheckPanel: ({ equipmentRows }: { equipmentRows: Array<{ id: string }> }) => <div>equipment table{equipmentRows?.map(row => <span key={row.id}>{row.id}</span>)}</div>,
}))

describe('ApplianceInspectionUploader', () => {
  afterEach(() => cleanup())

  it('remounts property-scoped upload state and ignores assets returned for a previous property', async () => {
    let resolveOld!: (rows: unknown[]) => void
    vi.mocked(listInspectionAssets).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve as never }))
      .mockResolvedValueOnce([{ id: 'birch-appliance', appliance_type: 'water_heater', metadata: {} }] as never)
    const view = render(<ApplianceInspectionUploader building='Maple' propertyId='maple' />)
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
    view.rerender(<ApplianceInspectionUploader building='Birch' propertyId='birch' />)
    expect(await screen.findByText('birch-appliance')).toBeTruthy()
    await act(async () => resolveOld([{ id: 'maple-appliance', appliance_type: 'water_heater', metadata: {} }]))
    expect(screen.queryByText('maple-appliance')).toBeNull()
    expect(screen.getByText('birch-appliance')).toBeTruthy()
  })

  it('opens the photo order below both upload cards from a plus', () => {
    render(
      <ApplianceInspectionUploader
        building="14 Maple Ave"
        propertyId="maple"
        leading={<p>Upload inspection report</p>}
      />,
    )
    const report = screen.getByText('Upload inspection report')
    const appliance = screen.getByText('Appliance equipment upload')
    const instructions = screen.getByRole('button', { name: 'Add appliance equipment instructions.' })
    expect(instructions.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('heading', { name: 'Add equipment photos' })).toBeNull()
    expect(report.compareDocumentPosition(appliance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(appliance.compareDocumentPosition(instructions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(instructions)
    expect(instructions.getAttribute('aria-expanded')).toBe('true')
    const guide = screen.getByRole('heading', { name: 'Add equipment photos' })
    expect(instructions.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(/Upload these photos in this exact order/)).toBeTruthy()
    expect(screen.getByText(/Water heater label:/)).toBeTruthy()
    expect(screen.getByText(/Whole heating system:/)).toBeTruthy()
    expect(screen.queryByText(/When results appear/)).toBeNull()
    expect(screen.queryByText(/If something needs fixing/)).toBeNull()
    expect(screen.getByText(/PDFs are processed as inspection reports/)).toBeTruthy()
    const assign = screen.getByRole('button', { name: 'Request home check' })
    const title = screen.getByRole('heading', { name: 'Request home check' })
    const caption = screen.getByText('Have a trusted professional capture your water heating system, and appliance details for you.')
    const art = document.querySelector('img[src*="Technician"]')
    expect(title.closest('section')?.style.background).toContain('radial-gradient')
    expect(title.closest('section')?.style.background).toContain('rgba(224, 242, 239, 0.6)')
    expect(title.closest('section')?.className).toContain('border-[#e5e7eb]')
    expect(title.closest('section')?.className).not.toMatch(/shadow-\[/)
    expect(title.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(caption.compareDocumentPosition(assign) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(art).toBeTruthy()
    expect(assign.compareDocumentPosition(art!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const yourself = screen.getByRole('heading', { name: 'Or add information yourself' })
    expect(title.compareDocumentPosition(yourself) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(yourself.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(assign.compareDocumentPosition(appliance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a water heater label example when that step is selected', () => {
    render(
      <ApplianceInspectionUploader
        building="14 Maple Ave"
        propertyId="maple"
        leading={<p>Upload inspection report</p>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add appliance equipment instructions.' }))
    expect(screen.queryByRole('img', { name: 'Example of a water heater label' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Water heater label:' }))
    expect(screen.getByRole('img', { name: 'Example of a water heater label' })).toBeTruthy()
    expect(screen.getByText('Here is an example of a water heater label.')).toBeTruthy()
  })

  it('shows a whole water heater example when that step is selected', () => {
    render(
      <ApplianceInspectionUploader
        building="14 Maple Ave"
        propertyId="maple"
        leading={<p>Upload inspection report</p>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add appliance equipment instructions.' }))
    expect(screen.queryByRole('img', { name: 'Example of a whole water heater' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Whole water heater:' }))
    expect(screen.getByRole('img', { name: 'Example of a whole water heater' })).toBeTruthy()
    expect(screen.getByText('Here is an example of a whole water heater.')).toBeTruthy()
  })

  it('shows a heating system label example when that step is selected', () => {
    render(
      <ApplianceInspectionUploader
        building="14 Maple Ave"
        propertyId="maple"
        leading={<p>Upload inspection report</p>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add appliance equipment instructions.' }))
    expect(screen.queryByRole('img', { name: 'Example of a heating system label' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Heating system label:' }))
    expect(screen.getByRole('img', { name: 'Example of a heating system label' })).toBeTruthy()
    expect(screen.getByText('Here is an example of a heating system label.')).toBeTruthy()
  })

  it('shows a whole heating system example when that step is selected', () => {
    render(
      <ApplianceInspectionUploader
        building="14 Maple Ave"
        propertyId="maple"
        leading={<p>Upload inspection report</p>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add appliance equipment instructions.' }))
    expect(screen.queryByRole('img', { name: 'Example of a whole heating system' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Whole heating system:' }))
    expect(screen.getByRole('img', { name: 'Example of a whole heating system' })).toBeTruthy()
    expect(screen.getByText('Here is an example of a whole heating system.')).toBeTruthy()
  })
})

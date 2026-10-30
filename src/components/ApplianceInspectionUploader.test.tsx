/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplianceInspectionUploader } from '@/components/ApplianceInspectionUploader'

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
  HomeCheckPanel: () => <div>equipment table</div>,
}))

describe('ApplianceInspectionUploader', () => {
  afterEach(() => cleanup())

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
    const instructions = screen.getByRole('button', { name: 'Add equipment instructions.' })
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
    expect(title.closest('section')?.className).toContain('bg-[#E6F4E9]')
    expect(title.closest('section')?.className).toContain('border-[#C3E0CC]')
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
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment instructions.' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Add equipment instructions.' }))
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
    expect(screen.queryByRole('img', { name: 'Example of a whole heating system' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Whole heating system:' }))
    expect(screen.getByRole('img', { name: 'Example of a whole heating system' })).toBeTruthy()
    expect(screen.getByText('Here is an example of a whole heating system.')).toBeTruthy()
  })
})

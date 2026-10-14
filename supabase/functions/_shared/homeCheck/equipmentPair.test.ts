import { describe, expect, it, vi } from 'vitest'
import { analyzeHomeCheckEquipmentPair } from './equipmentPair.ts'

vi.mock('../vision/analyzeInspectionPhoto.ts', () => ({ analyzeInspectionPhotoRow: vi.fn() }))
vi.mock(
  '../vision/ingestInspectionUpload.ts',
  () => ({ inspectionBytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64') }),
)
const pair = [{
  slot: 'water_heater_label',
  inspection_photo_id: 'label',
  storage_path: 'scope/label.jpg',
}, { slot: 'water_heater_whole', inspection_photo_id: 'whole', storage_path: 'scope/whole.jpg' }]
function client(first = pair, current = first) {
  let reads = 0
  const filters: unknown[][] = []
  const updates: unknown[] = []
  return {
    filters,
    updates,
    from(table: string) {
      const data = table === 'home_check_photos' ? reads++ ? current : first : null
      const builder: Record<string, unknown> = {
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve(resolve({ data, error: null })),
      }
      for (const method of ['select', 'eq', 'in']) {
        builder[method] = (...args: unknown[]) => {
          filters.push([table, method, ...args])
          return builder
        }
      }
      builder.update = (value: unknown) => {
        updates.push(value)
        return builder
      }
      return builder
    },
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async (path: string) => ({
          data: new Blob([path.endsWith('label.jpg') ? new Uint8Array([1]) : new Uint8Array([2])], {
            type: 'image/jpeg',
          }),
          error: null,
        })),
      })),
    },
  }
}
describe('Scoped paired equipment photos', () => {
  it('waits for the label and whole-system view before reading', async () => {
    const analyze = vi.fn()
    expect(
      await analyzeHomeCheckEquipmentPair(
        client(pair.slice(0, 1)) as never,
        'check',
        'water_heater_label',
        analyze,
      ),
    ).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })
  it('sends exactly the scoped label and overview in one reading and preserves the actual provider', async () => {
    const db = client()
    const analyze = vi.fn(async () => ({
      status: 'needs_review',
      provider: 'claude',
      ai_result: { category: 'water_heater' },
    }))
    await analyzeHomeCheckEquipmentPair(db as never, 'check', 'water_heater_whole', analyze)
    expect(db.filters).toContainEqual(['home_check_photos', 'eq', 'check_id', 'check'])
    expect(db.filters).toContainEqual(['home_check_photos', 'in', 'slot', [
      'water_heater_label',
      'water_heater_whole',
    ]])
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0]).toEqual([
      db,
      'label',
      'AQ==',
      'image/jpeg',
      'water_heater',
      'photo',
      'scope/label.jpg',
      {
        purpose: 'label',
        referenceImages: [{ purpose: 'overview', imageBase64: 'Ag==', mediaType: 'image/jpeg' }],
      },
    ])
    expect(db.updates).toContainEqual(
      expect.objectContaining({ provider: 'claude', status: 'needs_review' }),
    )
  })
  it('does not copy an old reading when a label is replaced during analysis', async () => {
    const db = client(pair, [{ ...pair[0], inspection_photo_id: 'new-label' }, pair[1]])
    const analyze = vi.fn(async () => ({
      status: 'needs_review',
      ai_result: { category: 'water_heater' },
    }))
    expect(await analyzeHomeCheckEquipmentPair(db as never, 'check', 'water_heater_label', analyze))
      .toBeNull()
    expect(db.updates).toEqual([])
  })
  it('reports a provider outage as a read error without pretending the label was readable', async () => {
    const db = client()
    expect(
      await analyzeHomeCheckEquipmentPair(
        db as never,
        'check',
        'water_heater_label',
        vi.fn(async () => {
          throw new Error('provider unavailable')
        }),
      ),
    ).toBeNull()
    expect(db.updates).toContainEqual(expect.objectContaining({ status: 'error' }))
  })
  it('requests the right system when a furnace photo is sent to the water heater slots', async () => {
    const db = client()
    await analyzeHomeCheckEquipmentPair(
      db as never,
      'check',
      'water_heater_label',
      vi.fn(async () => ({
        status: 'needs_review',
        ai_result: {
          category: 'hvac',
          identifiedItem: { type: 'furnace', modelNumber: 'WRONG', serialNumber: '123456' },
          estimatedAge: { value: 8 },
        },
      })),
    )
    expect(db.updates).toContainEqual(expect.objectContaining({
      ai_result: expect.objectContaining({
        identifiedItem: expect.objectContaining({
          modelNumber: undefined,
          serialNumber: undefined,
        }),
        estimatedAge: expect.objectContaining({ value: null }),
        labelReadability: expect.objectContaining({ retakeRequested: true }),
      }),
    }))
  })
})

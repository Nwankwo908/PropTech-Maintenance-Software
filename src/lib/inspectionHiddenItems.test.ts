import { describe, expect, it } from 'vitest'
import {
  hideInspectionItems,
  isHiddenInspectionAsset,
  isHiddenInspectionPhoto,
} from '@/lib/inspectionHiddenItems'

describe('inspectionHiddenItems', () => {
  it('hides a deleted photo and its linked asset', () => {
    hideInspectionItems('12 Main St', {
      photoIds: ['photo-1'],
      assetIds: ['asset-1'],
    })
    expect(isHiddenInspectionPhoto('12 Main St', { id: 'photo-1', unitAssetId: 'asset-1' })).toBe(
      true,
    )
    expect(
      isHiddenInspectionAsset('12 Main St', {
        id: 'asset-1',
        metadata: { photoId: 'photo-1' },
      }),
    ).toBe(true)
    expect(isHiddenInspectionPhoto('12 Main St', { id: 'photo-2' })).toBe(false)
  })
})

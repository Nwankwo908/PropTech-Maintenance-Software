import { describe, expect, it } from 'vitest'
import { adminRightRailPanelClass, railPanelWidthClasses } from '@/lib/adminRightRail'

describe('admin right rail width', () => {
  it('sets an explicit width so stacked panels cannot expand to 100vw', () => {
    expect(railPanelWidthClasses()).toBe(
      'w-[min(100vw,520px)] max-w-[min(100vw,520px)]',
    )
    const cls = adminRightRailPanelClass('left')
    expect(cls).toContain('w-[min(100vw,520px)]')
    expect(cls).not.toMatch(/(?:^| )w-full(?: |$)/)
    expect(cls).toContain('shrink-0')
  })
})

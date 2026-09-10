import { describe, expect, it } from 'vitest'
import { layoutFromFrame } from './SetupSuccessCheckboxGuide'

describe('setup success guide layout', () => {
  it('keeps the chat bubble to the left when there is room', () => {
    const layout = layoutFromFrame(200, 400, 36, 36, 1280, 800)
    expect(layout.bubblePlacement).toBe('left')
    expect(layout.bubbleLeft).toBeLessThan(400)
  })

  it('places the chat bubble to the right of a left-edge target on a phone', () => {
    const layout = layoutFromFrame(120, 16, 36, 36, 390, 844)
    expect(layout.bubblePlacement).toBe('right')
    expect(layout.bubbleLeft).toBeGreaterThanOrEqual(16)
    expect(layout.bubbleLeft + layout.bubbleWidth).toBeLessThanOrEqual(390 - 16)
  })

  it('places the chat bubble below when neither side fits', () => {
    const layout = layoutFromFrame(120, 140, 80, 40, 390, 844)
    expect(layout.bubblePlacement).toBe('below')
    expect(layout.bubbleLeft).toBeGreaterThanOrEqual(16)
    expect(layout.bubbleLeft + layout.bubbleWidth).toBeLessThanOrEqual(390 - 16)
  })

  it('places the chat bubble above when the target is near the bottom of the screen', () => {
    const layout = layoutFromFrame(760, 140, 80, 40, 390, 844)
    expect(layout.bubblePlacement).toBe('above')
    expect(layout.bubbleTop).toBeLessThan(760)
  })

  it('places the chat bubble to the right when the target is on the left of a tablet', () => {
    const layout = layoutFromFrame(200, 24, 40, 40, 820, 1180)
    expect(['right', 'below']).toContain(layout.bubblePlacement)
    expect(layout.bubbleLeft).toBeGreaterThanOrEqual(16)
    expect(layout.bubbleLeft + layout.bubbleWidth).toBeLessThanOrEqual(820 - 16)
  })
})

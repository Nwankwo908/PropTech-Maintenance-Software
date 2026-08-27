import { describe, expect, it } from 'vitest'
import { logoColumnOverlapsBox } from './hideOverlappingLogoColumnRule'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this
    },
  } as DOMRect
}

describe('logoColumnOverlapsBox', () => {
  const stage = rect(200, 100, 800, 400)

  it('hides a vertical rule that crosses the How It Works card', () => {
    expect(logoColumnOverlapsBox(rect(250, 0, 1, 900), stage)).toBe(true)
  })

  it('keeps a rule that sits to the left of the card', () => {
    expect(logoColumnOverlapsBox(rect(120, 0, 1, 900), stage)).toBe(false)
  })

  it('keeps a rule that sits to the right of the card', () => {
    expect(logoColumnOverlapsBox(rect(1100, 0, 1, 900), stage)).toBe(false)
  })

  it('keeps a rule that does not share vertical space with the card', () => {
    expect(logoColumnOverlapsBox(rect(250, 600, 1, 200), stage)).toBe(false)
  })
})

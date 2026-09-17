import { describe, expect, it } from 'vitest'
import { resolvePhotoRequest } from '@shared/maintenance/photoRequestPolicy.ts'

describe('resolvePhotoRequest', () => {
  it('asks for photos on water, structure, appliance, and pest', () => {
    expect(resolvePhotoRequest({ text: 'Active leak soaking the floor' }).requested).toBe(true)
    expect(resolvePhotoRequest({ text: "There's a crack going up my wall." }).requested).toBe(true)
    expect(resolvePhotoRequest({ text: 'Fridge not cold' }).requested).toBe(true)
    expect(resolvePhotoRequest({ text: 'I saw a mouse in the kitchen' }).requested).toBe(true)
    expect(resolvePhotoRequest({ text: 'My door broke' }).requested).toBe(true)
  })

  it('asks for plumbing, HVAC, and faucet photos; skips electrical hazards', () => {
    expect(resolvePhotoRequest({ text: 'No heat', primaryCategory: 'hvac' }).requested).toBe(
      true,
    )
    expect(resolvePhotoRequest({ text: 'Leaky faucet' }).requested).toBe(true)
    expect(
      resolvePhotoRequest({
        text:
          'Hello. My bathroom sink is leaking bad. The wood of the bottom drawer of the vanity has soaked and broke.',
      }).requested,
    ).toBe(true)
    expect(resolvePhotoRequest({ text: 'Outlet sparks' }).requested).toBe(false)
  })

  it('does not ask when a photo is already attached', () => {
    expect(
      resolvePhotoRequest({
        text: 'I saw a mouse in the kitchen',
        hasPhotoAlready: true,
      }).requested,
    ).toBe(false)
  })
})

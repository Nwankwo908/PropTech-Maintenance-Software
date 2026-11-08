import { describe, expect, it } from 'vitest'
import { diffPropertyUnitFields } from './propertyUnitFields'

describe('diffPropertyUnitFields', () => {
  const current = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ]

  it('renames a unit and adds a new one', () => {
    expect(
      diffPropertyUnitFields(current, [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'C' },
        { id: null, label: 'D' },
      ]),
    ).toEqual({
      ok: true,
      changes: [
        { kind: 'rename', id: 'b', from: 'B', to: 'C' },
        { kind: 'add', label: 'D' },
      ],
    })
  })

  it('rejects a blank or repeated unit name', () => {
    expect(diffPropertyUnitFields(current, [{ id: 'a', label: '  ' }]).ok).toBe(false)
    expect(
      diffPropertyUnitFields(current, [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'a' },
      ]).ok,
    ).toBe(false)
  })

  it('leaves existing units unchanged when the names match', () => {
    expect(
      diffPropertyUnitFields(current, [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ]),
    ).toEqual({ ok: true, changes: [] })
  })
})

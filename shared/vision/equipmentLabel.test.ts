import { describe, expect, it } from 'vitest'
import {
  guardEquipmentLabel,
  needsLabelBackup,
  normalizeLabelReadability,
  serialFormatWarnings,
} from './equipmentLabel'

const readable = {
  status: 'readable' as const,
  modelConfidence: 98,
  serialConfidence: 97,
  uncertainCharacters: [],
  retakeRequested: false,
  formatWarnings: [],
}
const reading = {
  category: 'water_heater',
  identifiedItem: { brand: 'Example maker', modelNumber: 'X123', serialNumber: 'AB081234' },
  estimatedAge: { value: 11, confidence: 'high' as const, basis: 'Serial date code estimate' },
  labelReadability: readable,
}
describe('Equipment label evidence', () => {
  it('retains readable IDs and estimates without silently changing characters', () => {
    const result = guardEquipmentLabel(reading)
    expect(result.identifiedItem.serialNumber).toBe('AB081234')
    expect(result.estimatedAge.value).toBe(11)
    expect(needsLabelBackup(result)).toBe(false)
  })
  it('flags 0/O without choosing a serial or manufacturing date', () => {
    const result = guardEquipmentLabel({
      ...reading,
      labelReadability: {
        ...readable,
        status: 'uncertain',
        uncertainCharacters: [{ field: 'serialNumber', index: 2, alternatives: ['0', 'O'] }],
      },
    })
    expect(result.identifiedItem.serialNumber).toBeUndefined()
    expect(result.identifiedItem.modelNumber).toBe('X123')
    expect(result.labelReadability.readings?.serialNumber).toBe('AB[0/O]81234')
    expect(result.estimatedAge.value).toBeNull()
    expect(guardEquipmentLabel(result).labelReadability.readings?.serialNumber).toBe('AB[0/O]81234')
    expect(needsLabelBackup(result)).toBe(true)
  })
  it('unreadable and low-confidence numbers stay unknown and request a retake', () => {
    for (
      const quality of [{ ...readable, status: 'unreadable' as const }, {
        ...readable,
        modelConfidence: 20,
        serialConfidence: 20,
      }]
    ) {
      const result = guardEquipmentLabel({ ...reading, labelReadability: quality })
      expect(result.identifiedItem.modelNumber).toBeUndefined()
      expect(result.identifiedItem.serialNumber).toBeUndefined()
      expect(result.labelReadability.retakeMessage).toBe(
        'Label unreadable, please send a closer photo without flash.',
      )
    }
  })
  it('does not spend a backup call on a whole photo with no data plate', () => {
    expect(
      needsLabelBackup(
        { ...reading, labelReadability: { ...readable, status: 'not_visible' } },
        'overview',
      ),
    ).toBe(false)
  })
  it('catches unknown serial characters and manufacturer-specific format violations without repairing them', () => {
    expect(serialFormatWarnings('AB?12345', 'Any', 'water_heater').length).toBe(1)
    const rule = {
      manufacturer: 'Example maker',
      category: 'water_heater',
      pattern: '[0-9]{10}',
      description: 'This documented family uses ten digits.',
      source: 'https://example.test/manual',
    }
    expect(serialFormatWarnings('0123456789', 'Example maker', 'water_heater', [rule])).toEqual([])
    expect(serialFormatWarnings('O123456789', 'Example maker', 'water_heater', [rule]).length).toBe(
      1,
    )
    expect(serialFormatWarnings('O123456789', 'Example maker', 'boiler', [rule])).toEqual([])
    expect(
      guardEquipmentLabel({
        ...reading,
        identifiedItem: { ...reading.identifiedItem, serialNumber: 'O123456789' },
      }, [rule]).identifiedItem.serialNumber,
    ).toBeUndefined()
  })
  it('ignores unsupported manufacturer rules and malformed ambiguity flags', () => {
    const quality = normalizeLabelReadability({
      status: 'uncertain',
      uncertainCharacters: [{ field: 'serialNumber', index: -1, alternatives: ['8', 'B'] }, {
        field: 'serialNumber',
        index: 3,
        alternatives: ['8', 'B'],
      }],
    })!
    expect(quality.uncertainCharacters).toEqual([{
      field: 'serialNumber',
      index: 3,
      alternatives: ['8', 'B'],
    }])
    expect(
      guardEquipmentLabel({ ...reading, labelReadability: { ...readable, status: 'uncertain' } })
        .identifiedItem.serialNumber,
    ).toBeUndefined()
  })
})

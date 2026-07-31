import { describe, expect, it } from 'vitest'
import {
  createEmptyResidentForm,
  residentFormRowHasUserInput,
  residentFormsHaveData,
} from './onboardingResidentForm'
import {
  createEmptyVendorForm,
  dedupeVendorForms,
  normalizeVendorFormRow,
} from './onboardingVendorForm'
import {
  createEmptyPropertyForm,
  propertyFormToOnboarding,
} from './onboardingPropertyForm'

describe('resident form cleanup / blank rows', () => {
  it('treats empty rows as having no user input', () => {
    expect(residentFormRowHasUserInput(createEmptyResidentForm())).toBe(false)
    expect(residentFormsHaveData([createEmptyResidentForm(), createEmptyResidentForm()])).toBe(
      false,
    )
  })

  it('detects any filled field as user input', () => {
    expect(
      residentFormRowHasUserInput({
        ...createEmptyResidentForm(),
        fullName: 'Jamie',
      }),
    ).toBe(true)
    expect(
      residentFormsHaveData([
        createEmptyResidentForm(),
        { ...createEmptyResidentForm(), phone: '2025550111' },
      ]),
    ).toBe(true)
  })

  it('ignores blank name rows when selecting residents to save', () => {
    const forms = [
      { ...createEmptyResidentForm(), fullName: 'Jamie Tenant', unit: '101' },
      createEmptyResidentForm(),
      { ...createEmptyResidentForm(), fullName: '  ', unit: '102' },
    ]
    const toSave = forms.filter((form) => form.fullName.trim())
    expect(toSave).toHaveLength(1)
    expect(toSave[0]?.fullName).toBe('Jamie Tenant')
  })
})

describe('vendor form cleanup / blank rows', () => {
  it('ignores blank name rows when selecting vendors to save', () => {
    const forms = [
      { ...createEmptyVendorForm(), name: 'Flex Plumbing' },
      createEmptyVendorForm(),
      { ...createEmptyVendorForm(), name: '', category: 'plumbing' },
    ]
    const toSave = forms.filter((form) => form.name.trim())
    expect(toSave).toHaveLength(1)
    expect(toSave[0]?.name).toBe('Flex Plumbing')
  })

  it('dedupes by name and prefers persisted UUID rows', () => {
    const persistedId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const deduped = dedupeVendorForms([
      normalizeVendorFormRow({
        id: 'vendor-temp-1',
        name: 'Flex Plumbing',
        phone: '111',
      }),
      normalizeVendorFormRow({
        id: persistedId,
        name: 'flex plumbing',
        phone: '222',
      }),
      normalizeVendorFormRow({ id: 'vendor-temp-2', name: '' }),
    ])
    expect(deduped.filter((row) => row.name.trim())).toHaveLength(1)
    expect(deduped.find((row) => row.name.trim())?.id).toBe(persistedId)
  })

  it('keeps unnamed blank rows and seeds one empty row when given none', () => {
    const twoBlank = dedupeVendorForms([createEmptyVendorForm(), createEmptyVendorForm()])
    expect(twoBlank).toHaveLength(2)
    expect(twoBlank.every((row) => row.name === '')).toBe(true)

    const seeded = dedupeVendorForms([])
    expect(seeded).toHaveLength(1)
    expect(seeded[0]?.name).toBe('')
  })
})

describe('propertyFormToOnboarding', () => {
  it('returns null for incomplete property rows', () => {
    expect(propertyFormToOnboarding(createEmptyPropertyForm())).toBeNull()
    expect(
      propertyFormToOnboarding({
        ...createEmptyPropertyForm(),
        name: 'Maple',
        address: '1 Main',
        city: 'Atlanta',
        state: 'GA',
        zipCode: '30301',
        unitCount: '0',
      }),
    ).toBeNull()
  })

  it('accepts a complete property row', () => {
    const property = propertyFormToOnboarding({
      ...createEmptyPropertyForm(),
      id: 'prop-1',
      name: 'Maple Court',
      address: '100 Maple St',
      city: 'Atlanta',
      state: 'ga',
      zipCode: '30301',
      unitCount: '4',
    })
    expect(property).toMatchObject({
      id: 'prop-1',
      name: 'Maple Court',
      state: 'GA',
      unitCount: 4,
    })
  })
})

/** Shared identity/date presentation for Home Check SMS and Property Intelligence. */
type Equipment = {
  system: 'water_heater' | 'heating'
  identifiedType?: string
  manufactureDate?: { year: number | null; month: number | null }
  fields: { make: { value: string | number | null }; model: { value: string | number | null }; approximateAge: { value: string | number | null; basis?: string } }
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export function homeCheckEquipment(asset: Equipment, now = new Date()) {
  const label = asset.system === 'water_heater' ? 'Water heater' : 'Heating system'
  const year = asset.manufactureDate?.year
  const month = asset.manufactureDate?.month
  const currentYear = now.getUTCFullYear()
  const validYear = typeof year === 'number' && Number.isInteger(year) && year >= 1900 && year <= currentYear
  const validMonth = typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12
  const made = validYear ? `${validMonth ? MONTHS[month! - 1] + ' ' : ''}${year}` : null
  // A year-only plate still supports an approximate age; it does not establish a month.
  const extractedAge = asset.fields.approximateAge.value
  const age = validYear ? currentYear - year! - (validMonth && now.getUTCMonth() + 1 < month! ? 1 : 0)
    : typeof extractedAge === 'number' && Number.isFinite(extractedAge) && extractedAge >= 0 && extractedAge <= 150 ? extractedAge : null
  return { label, made, age, ...(/serial|date code|decoded/i.test(asset.fields.approximateAge.basis ?? '') ? { serialEstimated: true } : {}) }
}

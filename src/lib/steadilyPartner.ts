import { placePropertyAddressFields } from '@shared/onboarding/typedDocumentExtract/placeFields'

export const STEADILY_EMBED_SCRIPT_DEFAULT =
  'https://app.staging.steadily.com/partner/v3.js?ref=ulo-staging'

const SCRIPT_ATTR = 'data-ulo-steadily-partner'

declare global {
  interface Window {
    SteadilyWidget?: {
      init: () => boolean | void
      destroy: () => void
    }
    steadilyV3loaded?: boolean | null
    __STEADILY_V3_CONFIG__?: {
      publicApiKey?: string
      apiUrl?: string
    }
  }
}

export type SteadilyQuoteAddress = {
  streetAddress: string
  city: string
  state: string
  zipCode: string
  yearBuilt: number | null
}

export function steadilyQuoteAddressFromBuilding(
  building: string,
  yearBuilt: number | null = null,
): SteadilyQuoteAddress {
  return steadilyQuoteAddressFromParts({
    building,
    streetAddress: building,
    yearBuilt,
  })
}

export function steadilyQuoteAddressFromParts(input: {
  building?: string | null
  streetAddress?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  yearBuilt?: number | null
}): SteadilyQuoteAddress {
  const placed = placePropertyAddressFields({
    name: input.building,
    streetAddress: input.streetAddress || input.building,
    city: input.city,
    state: input.state,
    zipCode: input.zipCode,
  })
  return {
    streetAddress: placed.streetAddress || placed.name,
    city: placed.city,
    state: placed.state,
    zipCode: placed.zipCode,
    yearBuilt: input.yearBuilt ?? null,
  }
}

const QUOTE_PREFILL_FIELDS: Array<{
  attr: string
  name: string
  value: (address: SteadilyQuoteAddress) => string
}> = [
  {
    attr: 'street_address',
    name: 'street_address',
    value: (address) => address.streetAddress,
  },
  { attr: 'city', name: 'city', value: (address) => address.city },
  { attr: 'state', name: 'state', value: (address) => address.state },
  { attr: 'postal_code', name: 'postal_code', value: (address) => address.zipCode },
  {
    attr: 'property_details__street_address',
    name: 'property_details__street_address',
    value: (address) => address.streetAddress,
  },
  { attr: 'property_details__city', name: 'property_details__city', value: (address) => address.city },
  { attr: 'property_details__state', name: 'property_details__state', value: (address) => address.state },
  {
    attr: 'property_details__zip_code',
    name: 'property_details__zip_code',
    value: (address) => address.zipCode,
  },
]

export function applySteadilyQuotePrefill(
  root: HTMLElement | null,
  address: SteadilyQuoteAddress,
): void {
  const button = root?.querySelector<HTMLElement>('.steadily-quote-button')
  if (!button) return

  for (const field of QUOTE_PREFILL_FIELDS) {
    const value = field.value(address).trim()
    if (value) button.setAttribute(`data-${field.attr}`, value)
    else button.removeAttribute(`data-${field.attr}`)
  }
  if (address.yearBuilt != null) {
    const year = String(address.yearBuilt)
    button.setAttribute('data-year_built', year)
    button.setAttribute('data-property_details__year_built', year)
  }

  const form = button.querySelector<HTMLFormElement>('form[target="steadily-iframe-v3"]')
  if (!form) return
  const hidden: Array<readonly [string, string]> = [
    ...QUOTE_PREFILL_FIELDS.map((field) => [field.name, field.value(address)] as const),
    ...(address.yearBuilt != null
      ? ([
          ['year_built', String(address.yearBuilt)],
          ['property_details__year_built', String(address.yearBuilt)],
        ] as const)
      : []),
  ]
  for (const [name, raw] of hidden) {
    const value = raw.trim()
    if (!value) continue
    let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)
    if (!input) {
      input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.className = name
      form.appendChild(input)
    }
    input.value = value
  }
}

export function steadilyEmbedScriptUrl(): string {
  const fromEnv = String(import.meta.env.VITE_STEADILY_EMBED_SCRIPT_URL ?? '').trim()
  return fromEnv || STEADILY_EMBED_SCRIPT_DEFAULT
}

export async function loadSteadilyPartnerScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.SteadilyWidget) return

  const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`)
  if (existing) {
    if (window.SteadilyWidget) return
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Steadily did not load')), {
        once: true,
      })
    })
    return
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = steadilyEmbedScriptUrl()
    script.async = true
    script.setAttribute(SCRIPT_ATTR, '1')
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Steadily did not load'))
    document.head.appendChild(script)
  })
}

export function formatSteadilyPremium(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

export async function fetchSteadilyAnnualPremium(
  address: SteadilyQuoteAddress,
): Promise<number | null> {
  if (!address.streetAddress || !address.city || !address.state || !address.zipCode) return null
  await loadSteadilyPartnerScript()
  const apiUrl = (window.__STEADILY_V3_CONFIG__?.apiUrl ?? '').replace(/\/$/, '')
  const apiKey = window.__STEADILY_V3_CONFIG__?.publicApiKey?.trim() ?? ''
  if (!apiUrl || !apiKey) return null

  const response = await fetch(
    `${apiUrl}/quote/estimate?X-Steadily-ApiKey=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        properties: [
          {
            property_id: `ulo-${Math.random().toString(36).slice(2, 10)}`,
            address: {
              street_address: address.streetAddress,
              city: address.city,
              state: address.state,
              zip_code: address.zipCode,
            },
            property_details: {
              year_built: address.yearBuilt,
              property_type: 'SINGLE_FAMILY',
            },
          },
        ],
      }),
    },
  )
  if (!response.ok) return null
  const json = (await response.json()) as {
    estimates?: Array<{ estimate?: { dp_3?: number; dp_1?: number } }>
  }
  const estimate = json.estimates?.[0]?.estimate
  const annual = estimate?.dp_3 ?? estimate?.dp_1
  return typeof annual === 'number' && Number.isFinite(annual) ? annual : null
}

export function refreshSteadilyPartnerWidgets(): void {
  if (!window.SteadilyWidget) return
  window.SteadilyWidget.destroy()
  window.SteadilyWidget.init()
}

export function submitSteadilyQuoteButton(
  root: HTMLElement | null,
  address?: SteadilyQuoteAddress,
): boolean {
  if (address) applySteadilyQuotePrefill(root, address)
  const form = root?.querySelector<HTMLFormElement>('form[target="steadily-iframe-v3"]')
  if (!form) return false
  if (address) applySteadilyQuotePrefill(root, address)
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.submit()
  return true
}

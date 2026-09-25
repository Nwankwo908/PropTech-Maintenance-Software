import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { loadGoogleMapsApi, resolveGoogleMapsApiKey } from '@/lib/googleMapsLoader'
import {
  parseAddressSuggestionLabel,
  parseGooglePlaceAddress,
  type ParsedStreetAddress,
} from '@/lib/parseGooglePlaceAddress'

type StreetAddressAutocompleteProps = {
  value: string
  onChange: (street: string) => void
  onPlaceResolved: (parsed: ParsedStreetAddress) => void
  className: string
  placeholder?: string
  'aria-label'?: string
}

type AddressSuggestion = {
  placeId: string
  label: string
  mainText: string
}

const SUGGEST_DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 3

function mapsPlacesReady(g: typeof google): boolean {
  return Boolean(g.maps.places?.AutocompleteService)
}

function fetchPredictions(
  g: typeof google,
  query: string,
): Promise<AddressSuggestion[]> {
  const service = new g.maps.places.AutocompleteService()
  return new Promise((resolve) => {
    service.getPlacePredictions(
      {
        input: query,
        types: ['address'],
        componentRestrictions: { country: 'us' },
      },
      (results, status) => {
        if (status !== g.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([])
          return
        }
        resolve(
          results.map((row) => ({
            placeId: row.place_id,
            label: row.description,
            mainText: row.structured_formatting?.main_text ?? '',
          })),
        )
      },
    )
  })
}

function mergeParsedAddress(
  base: ParsedStreetAddress | null,
  extra: ParsedStreetAddress | null,
): ParsedStreetAddress | null {
  if (!base && !extra) return null
  return {
    street: extra?.street || base?.street || '',
    city: extra?.city || base?.city || '',
    state: extra?.state || base?.state || '',
    zipCode: extra?.zipCode || base?.zipCode || '',
  }
}

async function fetchPlaceDetailsParsed(
  g: typeof google,
  placeId: string,
): Promise<ParsedStreetAddress | null> {
  const Place = g.maps.places.Place
  if (typeof Place !== 'function') return null
  try {
    const place = new Place({ id: placeId })
    await place.fetchFields({ fields: ['addressComponents', 'displayName'] })
    const components = (place.addressComponents ?? []).map((part) => ({
      long_name: part.longText ?? '',
      short_name: part.shortText ?? '',
      types: [...part.types],
    }))
    return parseGooglePlaceAddress({
      address_components: components,
      name: place.displayName ?? undefined,
    })
  } catch {
    return null
  }
}

export function StreetAddressAutocomplete({
  value,
  onChange,
  onPlaceResolved,
  className,
  placeholder,
  'aria-label': ariaLabel,
}: StreetAddressAutocompleteProps) {
  const listId = useId()
  const onPlaceResolvedRef = useRef(onPlaceResolved)
  onPlaceResolvedRef.current = onPlaceResolved
  const suppressFetchRef = useRef(false)

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [maps, setMaps] = useState<typeof google | null>(null)
  /** Only fetch/show suggestions while the user is typing — not for prepopulated values. */
  const typingRef = useRef(false)

  useEffect(() => {
    const apiKey = resolveGoogleMapsApiKey()
    if (!apiKey) return
    let cancelled = false
    void loadGoogleMapsApi(apiKey)
      .then(async (g) => {
        if (typeof g.maps.importLibrary === 'function') {
          await g.maps.importLibrary('places')
        }
        if (cancelled || !mapsPlacesReady(g)) return
        setMaps(g)
      })
      .catch(() => {
        /* Keep a normal text field if Places fails to load. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!maps) return
    if (suppressFetchRef.current || !typingRef.current) {
      setOpen(false)
      setSuggestions([])
      return
    }
    const query = value.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setOpen(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void fetchPredictions(maps, query).then((rows) => {
        if (cancelled || suppressFetchRef.current || !typingRef.current) return
        setSuggestions(rows)
        setActiveIndex(0)
        setOpen(rows.length > 0)
      })
    }, SUGGEST_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [maps, value])

  function closeSuggestions() {
    typingRef.current = false
    setOpen(false)
    setSuggestions([])
  }

  function applyParsed(parsed: ParsedStreetAddress | null, fallbackStreet: string) {
    if (!parsed) {
      onChange(fallbackStreet)
      return
    }
    onPlaceResolvedRef.current({
      ...parsed,
      street: parsed.street || fallbackStreet,
    })
  }

  function selectSuggestion(suggestion: AddressSuggestion) {
    suppressFetchRef.current = true
    closeSuggestions()

    const fromLabel = parseAddressSuggestionLabel(suggestion.label)
    const parsed = mergeParsedAddress(
      fromLabel,
      suggestion.mainText ? { street: suggestion.mainText, city: '', state: '', zipCode: '' } : null,
    )
    applyParsed(parsed, suggestion.mainText || suggestion.label)

    if (!maps) return
    void fetchPlaceDetailsParsed(maps, suggestion.placeId).then((details) => {
      if (!details) return
      applyParsed(mergeParsedAddress(parsed, details), suggestion.mainText || suggestion.label)
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectSuggestion(suggestions[activeIndex] ?? suggestions[0])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSuggestions()
    }
  }

  function handleSuggestionPointerDown(
    event: PointerEvent<HTMLButtonElement>,
    suggestion: AddressSuggestion,
  ) {
    event.preventDefault()
    event.stopPropagation()
    selectSuggestion(suggestion)
  }

  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        onChange={(event) => {
          suppressFetchRef.current = false
          typingRef.current = true
          onChange(event.target.value)
        }}
        onBlur={() => {
          // Delay so suggestion pointerdown can select before the list unmounts.
          window.setTimeout(() => {
            closeSuggestions()
          }, 150)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-[8px] border border-[#e5e7eb] bg-white py-1 shadow-[0px_8px_24px_rgba(16,24,40,0.12)]"
        >
          {suggestions.map((suggestion, index) => {
            const active = index === activeIndex
            return (
              <li key={suggestion.placeId} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`block w-full px-3 py-2 text-left text-[14px] leading-5 ${
                    active ? 'bg-[#f3f4f6] text-[#101828]' : 'bg-white text-[#364153]'
                  }`}
                  onPointerDown={(event) => handleSuggestionPointerDown(event, suggestion)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  {suggestion.label}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

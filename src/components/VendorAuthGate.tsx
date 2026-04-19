function extractPortalKey(search: string): string | null {
  const params = new URLSearchParams(search)

  const top = params.get('k')
  if (top && top.trim() !== '') return top.trim()

  const redirect = params.get('redirect')
  if (!redirect) return null

  try {
    const decoded = decodeURIComponent(redirect.replace(/\+/g, ' '))
    const idx = decoded.indexOf('?')
    const queryPart = idx >= 0 ? decoded.slice(idx + 1) : ''
    const nested = new URLSearchParams(queryPart).get('k')
    if (nested && nested.trim() !== '') return nested.trim()
  } catch {
    return null
  }

  return null
}

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [checked, setChecked] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const key = extractPortalKey(location.search)

    if (key) {
      console.log('🔥 Vendor key detected, bypassing login')
      setAllowed(true)
      setChecked(true)
      return
    }

    // prevent redirect loop
    if (location.pathname.startsWith('/vendor/login')) {
      setChecked(true)
      return
    }

    const dest = `/vendor/login?redirect=${encodeURIComponent(
      location.pathname + location.search,
    )}`

    navigate(dest, { replace: true })
    setChecked(true)
  }, [location.pathname, location.search, navigate])

  if (!checked) return null
  if (!allowed) return null

  return <>{children}</>
}
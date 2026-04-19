import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

/** Ensure `k` is set on the destination path (preserves other query params). */
function vendorPathWithPortalKey(pathWithOptionalQuery: string, k: string): string {
  const qi = pathWithOptionalQuery.indexOf("?")
  const pathOnly = qi >= 0 ? pathWithOptionalQuery.slice(0, qi) : pathWithOptionalQuery
  const qs = qi >= 0 ? pathWithOptionalQuery.slice(qi + 1) : ""
  const sp = new URLSearchParams(qs)
  sp.set("k", k)
  return `${pathOnly}?${sp.toString()}`
}

export function VendorLoginPage() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const topK = params.get("k")?.trim()
    const redirectRaw = params.get("redirect")

    // New shape: `/vendor/login?k=…&redirect=/vendor/ticket/…` (k never nested inside redirect)
    if (topK) {
      if (redirectRaw) {
        try {
          const decoded = decodeURIComponent(redirectRaw)
          navigate(vendorPathWithPortalKey(decoded, topK), { replace: true })
        } catch {
          navigate(`/vendor?k=${encodeURIComponent(topK)}`, { replace: true })
        }
        return
      }
      navigate(`/vendor?k=${encodeURIComponent(topK)}`, { replace: true })
      return
    }

    // Legacy: `redirect` contained `/vendor?k=` (nested) — normalize to `/vendor?k=` or ticket path + k
    if (redirectRaw) {
      try {
        const decoded = decodeURIComponent(redirectRaw)
        const qi = decoded.indexOf("?")
        const pathOnly = qi >= 0 ? decoded.slice(0, qi) : decoded
        const q = qi >= 0 ? decoded.slice(qi + 1) : ""
        const nestedK = new URLSearchParams(q).get("k")?.trim()
        if (nestedK) {
          const sp = new URLSearchParams(q)
          sp.delete("k")
          const rest = sp.toString()
          const base = rest ? `${pathOnly}?${rest}` : pathOnly
          navigate(vendorPathWithPortalKey(base, nestedK), { replace: true })
        }
      } catch {
        /* ignore */
      }
    }
  }, [location.search, navigate])

  return (
    <div>
      <h2>Vendor Portal Login</h2>
      <p>We’ll email you a magic link to sign in.</p>
    </div>
  )
}

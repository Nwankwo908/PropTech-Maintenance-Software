import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

export function VendorLoginPage() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(location.search)

    const redirect = params.get("redirect")

    if (redirect) {
      const decoded = decodeURIComponent(redirect)

      // extract query part after ?
      const queryPart = decoded.includes("?") ? decoded.split("?")[1] : ""

      const k = new URLSearchParams(queryPart).get("k")

      console.log("🔥 extracted k:", k)

      if (k) {
        // send them to proper route WITH k
        navigate(`/vendor?k=${k}`, { replace: true })
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

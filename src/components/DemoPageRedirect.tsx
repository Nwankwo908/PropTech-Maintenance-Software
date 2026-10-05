import { Navigate, useSearchParams } from 'react-router-dom'
import {
  prepareDemoLandlordScope,
  prepareTryDemoLandlordScope,
} from '@/lib/activeLandlord'

/** Public entry: scope admin to Demo Property Management, then open the overview. */
export function DemoPageRedirect() {
  const [searchParams] = useSearchParams()
  const fromTryDemo = searchParams.get('from') === 'try-demo'
  const welcome = searchParams.get('welcome') === '1'

  // Set scope during render so /admin mounts under Demo (layout effect can lose the race to Navigate).
  if (fromTryDemo) {
    prepareTryDemoLandlordScope()
  } else {
    prepareDemoLandlordScope()
  }

  const adminTo =
    fromTryDemo || welcome
      ? `/admin?${new URLSearchParams({
          ...(fromTryDemo ? { from: 'try-demo' } : {}),
          welcome: '1',
        }).toString()}`
      : '/admin'

  return <Navigate to={adminTo} replace />
}

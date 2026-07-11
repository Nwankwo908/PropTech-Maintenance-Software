import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { VendorIntakeWizard } from '@/components/VendorIntakeWizard'
import { resolveVendorIntakeSession } from '@/lib/vendorIntakeForm'

function InvalidLinkView() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f9fafb] px-6 py-12">
      <div className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-8 text-center shadow-[0px_8px_24px_rgba(0,0,0,0.06)]">
        <h1 className="text-[20px] font-bold text-[#0a0a0a]">Link unavailable</h1>
        <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">
          This link isn&apos;t working anymore. Text or call the property manager and ask for a new
          form link.
        </p>
      </div>
    </div>
  )
}

export function VendorIntakePortal() {
  const { token } = useParams<{ token: string }>()
  const session = useMemo(() => resolveVendorIntakeSession(token ?? ''), [token])

  if (!session) return <InvalidLinkView />
  return <VendorIntakeWizard session={session} />
}

export default VendorIntakePortal

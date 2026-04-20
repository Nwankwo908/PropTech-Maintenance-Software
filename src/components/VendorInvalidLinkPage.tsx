import { Link } from 'react-router-dom'

/** Shown when the vendor portal is opened without a valid email link token. */
export function VendorInvalidLinkPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#f8fafc] px-6 py-12 text-center">
      <h1 className="text-xl font-semibold text-[#0f172a]">Link required</h1>
      <p className="max-w-md text-sm leading-relaxed text-[#475569]">
        Open the vendor portal using the secure link from your maintenance assignment email. If the link
        expired or was lost, ask your property contact to resend the notification.
      </p>
      <Link
        to="/"
        className="text-sm font-medium text-[#3342aa] underline underline-offset-2 hover:text-[#1e2a8a]"
      >
        Back to home
      </Link>
    </div>
  )
}

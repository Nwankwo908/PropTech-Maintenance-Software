import { useEffect, useMemo, useState } from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  sendVendorInvite,
  type SendVendorInviteResult,
  type VendorInviteChannel,
} from '@/api/vendorVerification'

export type InviteVendorPrefill = {
  vendorId?: string | null
  businessName?: string
  contactName?: string
  email?: string
  phone?: string
  propertyName?: string
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] font-medium text-[#364153]">{children}</span>
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1.5 w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2.5 text-[14px] text-[#0a0a0a] outline-none transition-colors focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
    />
  )
}

export function InviteVendorModal({
  open,
  onClose,
  onInvited,
  prefill,
}: {
  open: boolean
  onClose: () => void
  onInvited?: (result: SendVendorInviteResult) => void
  prefill?: InviteVendorPrefill
}) {
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [propertyName, setPropertyName] = useState('')
  const [channel, setChannel] = useState<VendorInviteChannel>('both')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SendVendorInviteResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setBusinessName(prefill?.businessName ?? '')
      setContactName(prefill?.contactName ?? '')
      setEmail(prefill?.email ?? '')
      setPhone(prefill?.phone ?? '')
      setPropertyName(prefill?.propertyName ?? '')
      setChannel('both')
      setError(null)
      setResult(null)
      setCopied(false)
    }
  }, [open, prefill])

  const canSend = useMemo(() => {
    const hasName = businessName.trim() || contactName.trim()
    const hasContact =
      (channel === 'sms' && phone.trim()) ||
      (channel === 'email' && email.trim()) ||
      (channel === 'both' && (phone.trim() || email.trim()))
    return Boolean(hasName && hasContact)
  }, [businessName, contactName, email, phone, channel])

  if (!open) return null

  async function handleSend() {
    setSaving(true)
    setError(null)
    try {
      const res = await sendVendorInvite({
        landlordId: getActiveLandlordId(),
        vendorId: prefill?.vendorId ?? null,
        businessName: businessName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        propertyName: propertyName.trim(),
        channel,
      })
      setResult(res)
      onInvited?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invite.')
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    if (!result?.link) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="w-full max-w-[480px] rounded-[16px] bg-white p-6 shadow-[0px_20px_60px_rgba(0,0,0,0.2)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-[#0a0a0a]">Invite a vendor</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
              We&apos;ll text or email a secure link to a quick verification (about 5 minutes).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#6a7282] hover:bg-[#f3f4f6]"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {result ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3">
              <p className="text-[14px] font-medium text-[#008236]">
                {result.ok ? 'Invite sent' : 'Invite created'}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-[#166534]">
                {[
                  result.delivery.sms === 'sent' ? 'Text delivered' : null,
                  result.delivery.email === 'sent' ? 'Email delivered' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Share the link below with the vendor.'}
              </p>
            </div>
            {result.delivery.smsError || result.delivery.emailError ? (
              <p className="rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]">
                {result.delivery.smsError ? `Text: ${result.delivery.smsError}. ` : ''}
                {result.delivery.emailError ? `Email: ${result.delivery.emailError}.` : ''}
              </p>
            ) : null}
            <div>
              <Label>Verification link</Label>
              <div className="mt-1.5 flex gap-2">
                <input
                  readOnly
                  value={result.link}
                  className="w-full rounded-[10px] border border-[#d1d5dc] bg-[#f9fafb] px-3 py-2.5 text-[13px] text-[#364153]"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="shrink-0 rounded-[10px] border border-[#186179] px-3 py-2.5 text-[13px] font-semibold text-[#186179] hover:bg-[#186179]/5"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-[10px] bg-[#186179] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#134e60]"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {error ? (
              <p className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                {error}
              </p>
            ) : null}
            <label className="block">
              <Label>Business name</Label>
              <TextInput value={businessName} onChange={setBusinessName} placeholder="Acme Plumbing" />
            </label>
            <label className="block">
              <Label>Contact name</Label>
              <TextInput value={contactName} onChange={setContactName} placeholder="Jordan Rivera" />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <Label>Mobile phone</Label>
                <TextInput value={phone} onChange={setPhone} placeholder="(555) 123-4567" type="tel" />
              </label>
              <label className="block">
                <Label>Email</Label>
                <TextInput value={email} onChange={setEmail} placeholder="vendor@email.com" type="email" />
              </label>
            </div>
            <label className="block">
              <Label>Property (optional)</Label>
              <TextInput value={propertyName} onChange={setPropertyName} placeholder="Maple Court" />
            </label>
            <div>
              <Label>Send via</Label>
              <div className="mt-2 flex gap-2">
                {(['both', 'sms', 'email'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setChannel(opt)}
                    className={`flex-1 rounded-[10px] px-3 py-2 text-[13px] font-medium capitalize transition-colors ${
                      channel === opt
                        ? 'bg-[#186179] text-white'
                        : 'bg-[#f3f4f6] text-[#364153] hover:bg-[#e5e7eb]'
                    }`}
                  >
                    {opt === 'both' ? 'Text + Email' : opt}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={!canSend || saving}
              onClick={() => void handleSend()}
              className="w-full rounded-[10px] bg-[#186179] px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#134e60] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default InviteVendorModal

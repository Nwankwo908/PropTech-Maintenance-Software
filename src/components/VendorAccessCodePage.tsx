import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  VENDOR_INVALID_ACCESS_CODE_FLAG,
  VENDOR_TOKEN_STORAGE_KEY,
} from '@/lib/vendorToken'

export function VendorAccessCodePage() {
  const navigate = useNavigate()
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(VENDOR_INVALID_ACCESS_CODE_FLAG) === '1') {
        sessionStorage.removeItem(VENDOR_INVALID_ACCESS_CODE_FLAG)
        setError('Invalid access code')
      }
    } catch {
      /* ignore */
    }
  }, [])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const value = code.trim()
    if (!value) {
      setError('Enter your access code')
      return
    }
    try {
      localStorage.setItem(VENDOR_TOKEN_STORAGE_KEY, value)
    } catch {
      setError('Could not save code. Check browser storage settings.')
      return
    }
    navigate('/vendor', { replace: true })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#f8fafc] px-6 py-12">
      <div className="w-full max-w-sm rounded-xl border border-[#e5e7eb] bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-semibold text-[#0f172a]">Enter Access Code</h1>
        <p className="mt-2 text-center text-sm text-[#64748b]">
          Use the access code from your property manager to open your work orders.
        </p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor={inputId} className="sr-only">
              Access code
            </label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-[#d1d5db] px-3 py-2.5 text-[15px] text-[#101828] outline-none ring-[#3342aa] focus:border-[#3342aa] focus:ring-2"
              placeholder="Access code"
            />
          </div>
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="rounded-lg bg-[#3342aa] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2a368f]"
          >
            Access Dashboard
          </button>
        </form>
      </div>
    </div>
  )
}

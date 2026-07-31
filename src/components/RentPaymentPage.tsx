import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  completeRentPaymentCheckout,
  createRentPaymentCheckout,
} from '@/api/rentPaymentCheckout'
import { getErrorMessage } from '@/lib/errorMessage'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f9fafb] px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-[480px] rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_8px_24px_rgba(0,0,0,0.06)] sm:p-8">
        {children}
      </div>
    </div>
  )
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

export function RentPaymentPage() {
  const [params] = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'cancel' | 'error'>(
    'loading',
  )
  const [message, setMessage] = useState('Opening secure payment…')
  const [amountPaid, setAmountPaid] = useState<number | null>(null)

  useEffect(() => {
    let active = true

    const run = async () => {
      const rentPayment = (params.get('rent_payment') ?? '').trim()
      const sessionId = (params.get('session_id') ?? '').trim()
      const runId = (params.get('run') ?? '').trim()
      const residentId = (params.get('resident') ?? '').trim()

      if (rentPayment === 'success' && sessionId) {
        try {
          const result = await completeRentPaymentCheckout({ sessionId })
          if (!active) return
          setAmountPaid(result.amountPaid)
          setStatus('success')
          setMessage(
            result.alreadyCompleted
              ? 'This rent payment was already recorded. Thank you.'
              : 'Thanks — your rent payment was received.',
          )
        } catch (err) {
          if (!active) return
          setStatus('error')
          setMessage(
            getErrorMessage(err, 'We could not confirm your payment yet. Please try again or contact your property manager.'),
          )
        }
        return
      }

      if (rentPayment === 'cancel') {
        setStatus('cancel')
        setMessage(
          'Payment was cancelled. You can return to this link anytime to finish paying rent.',
        )
        return
      }

      if (runId && residentId) {
        try {
          const { url } = await createRentPaymentCheckout({ runId, residentId })
          if (!active) return
          window.location.assign(url)
        } catch (err) {
          if (!active) return
          setStatus('error')
          setMessage(
            getErrorMessage(err, 'Could not open rent payment. Contact your property manager.'),
          )
        }
        return
      }

      setStatus('error')
      setMessage(
        'This payment link is missing details. Ask your property manager for a new rent payment link.',
      )
    }

    void run()
    return () => {
      active = false
    }
  }, [params])

  return (
    <Shell>
      {status === 'loading' ? (
        <>
          <h1 className="text-[20px] font-bold text-[#0a0a0a]">Pay rent</h1>
          <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">{message}</p>
        </>
      ) : null}

      {status === 'success' ? (
        <>
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#dbfce7]">
            <span className="text-[28px]" aria-hidden>
              ✓
            </span>
          </div>
          <h1 className="mt-4 text-center text-[20px] font-bold text-[#0a0a0a]">
            Payment received
          </h1>
          <p className="mt-2 text-center text-[14px] leading-6 text-[#6a7282]">
            {message}
          </p>
          {amountPaid != null && amountPaid > 0 ? (
            <p className="mt-4 text-center text-[16px] font-semibold text-[#0a0a0a]">
              {formatMoney(amountPaid)}
            </p>
          ) : null}
        </>
      ) : null}

      {status === 'cancel' ? (
        <>
          <h1 className="text-[20px] font-bold text-[#0a0a0a]">Payment cancelled</h1>
          <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">{message}</p>
        </>
      ) : null}

      {status === 'error' ? (
        <>
          <h1 className="text-[20px] font-bold text-[#0a0a0a]">Unable to pay</h1>
          <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">{message}</p>
        </>
      ) : null}
    </Shell>
  )
}

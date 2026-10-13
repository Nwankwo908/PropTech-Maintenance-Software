import { useEffect, useState } from 'react'
import { ProfileSetupPointingArrow } from '@/components/ProfileSetupPointingArrow'
import {
  clearSetupSuccessCardDismissed,
  setProfileSetupNavPointed,
} from '@/lib/setupSuccessChecklist'

/** Copy shown when Property Health has no score to chart (0 or not ready). */
export function PropertyHealthUnavailableNote() {
  const [pointing, setPointing] = useState(false)

  const stopPointing = () => {
    setPointing(false)
    setProfileSetupNavPointed(false)
  }

  const startPointing = () => {
    setPointing(true)
    setProfileSetupNavPointed(true)
  }

  useEffect(() => {
    return () => setProfileSetupNavPointed(false)
  }, [])

  return (
    <>
      <div
        className={[
          'sa-surface min-w-0 rounded-[8px] p-1 -m-1 outline-none focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2',
          pointing ? 'bg-[#E0F2EF]/70' : 'bg-transparent',
        ].join(' ')}
        tabIndex={0}
        onMouseEnter={startPointing}
        onMouseLeave={stopPointing}
        onFocus={startPointing}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          stopPointing()
        }}
      >
        <p className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
          Not Available
        </p>
        <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
          Complete your profile set up to unlock this metric
        </p>
        <button
          type="button"
          onClick={() => {
            stopPointing()
            clearSetupSuccessCardDismissed()
          }}
          className="sa-link mt-2 text-[12px] font-semibold leading-4 text-[#186179]"
        >
          Profile setup →
        </button>
      </div>
      <ProfileSetupPointingArrow active={pointing} />
    </>
  )
}

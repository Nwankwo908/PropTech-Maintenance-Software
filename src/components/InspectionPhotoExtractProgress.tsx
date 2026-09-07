import { useEffect, useState } from 'react'
import {
  clampExtractDisplayPercent,
  inspectionExtractPercent,
} from '@/lib/inspectionExtractProgress'

type InspectionPhotoExtractProgressProps = {
  photoId: string
  complete?: boolean
}

export function InspectionPhotoExtractProgress({
  photoId,
  complete = false,
}: InspectionPhotoExtractProgressProps) {
  const [percent, setPercent] = useState(() => (complete ? 100 : 0))

  useEffect(() => {
    if (complete) {
      setPercent(100)
      return
    }
    setPercent(0)
    const started = Date.now()
    const tick = window.setInterval(() => {
      setPercent(inspectionExtractPercent(Date.now() - started))
    }, 80)
    return () => window.clearInterval(tick)
  }, [photoId, complete])

  const display = clampExtractDisplayPercent(percent, complete)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-[#186179]">Still analysing</p>
        <p className="text-[12px] font-semibold tabular-nums text-[#186179]">{display}%</p>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]"
        role="progressbar"
        aria-label="Still analysing"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={display}
      >
        <div
          className="sa-bar h-full rounded-full bg-[#186179]"
          style={{ width: `${display}%` }}
        />
      </div>
    </div>
  )
}

export default InspectionPhotoExtractProgress

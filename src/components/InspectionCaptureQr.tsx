type InspectionCaptureQrProps = {
  url: string
}

/** QR image for the phone capture URL (Copy link remains the offline fallback). */
export function InspectionCaptureQr({ url }: InspectionCaptureQrProps) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&ecc=M&margin=12&data=${encodeURIComponent(url)}`
  return (
    <img
      src={src}
      width={240}
      height={240}
      alt="Scan with your phone"
      className="size-[240px] rounded-[10px] bg-white"
    />
  )
}

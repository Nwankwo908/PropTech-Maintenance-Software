const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image'))
    }
    img.src = url
  })
}

/** Resize image to ~1600px longest edge; returns JPEG blob + data URL base64. */
export async function compressImageForVision(file: File): Promise<{
  blob: Blob
  base64: string
  contentType: string
  fileName: string
}> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return {
      blob: file,
      base64: btoa(binary),
      contentType: 'application/pdf',
      fileName: file.name,
    }
  }

  try {
    const img = await loadImage(file)
    const longest = Math.max(img.width, img.height)
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Compress failed'))),
        'image/jpeg',
        JPEG_QUALITY,
      )
    })
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'inspection-photo'
    return {
      blob,
      base64: btoa(binary),
      contentType: 'image/jpeg',
      fileName: `${baseName}.jpg`,
    }
  } catch {
    // HEIC / unsupported decode — send original bytes
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return {
      blob: file,
      base64: btoa(binary),
      contentType: file.type || 'image/jpeg',
      fileName: file.name,
    }
  }
}

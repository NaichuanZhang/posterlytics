import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  value: string
  size?: number
  dark?: string
  light?: string
}

// Renders a QR code (for a placement's view URL) as a crisp <img> data URL.
export function QrCode({ value, size = 132, dark = '#000000', light = '#ffffff' }: Props) {
  const [src, setSrc] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      color: { dark, light },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc('')
      })
    return () => {
      cancelled = true
    }
  }, [value, size, dark, light])

  if (!src) return <div style={{ width: size, height: size, background: light, borderRadius: 8 }} />
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QR code"
      style={{ display: 'block', borderRadius: 8 }}
    />
  )
}

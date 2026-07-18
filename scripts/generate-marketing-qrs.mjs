import { mkdir } from 'node:fs/promises'
import QRCode from 'qrcode'

const outputDirectory = 'public/marketing/qr'
const placements = [
  ['field', 'product-wall'],
  ['routes', 'city-window'],
  ['signal', 'launch-lobby'],
]

await mkdir(outputDirectory, { recursive: true })

await Promise.all(placements.map(([name, placement]) =>
  QRCode.toFile(
    `${outputDirectory}/${name}.png`,
    `https://posterlytics.insforge.site/?placement=${placement}`,
    {
      width: 184,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#151719', light: '#ffffff' },
    },
  )
))

console.log(`Marketing QR assets written to ${outputDirectory}`)

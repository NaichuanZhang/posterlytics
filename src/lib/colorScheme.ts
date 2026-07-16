export type DeviceColorScheme = 'light' | 'dark'

export function getDeviceColorScheme(): DeviceColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

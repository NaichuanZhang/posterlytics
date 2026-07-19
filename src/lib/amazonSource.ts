const AMAZON_SOURCE_HOSTS = new Set([
  'amazon.com',
  'www.amazon.com',
  'a.co',
  'amzn.to',
  'amzn.asia',
  'amzn.eu',
])

export function isAmazonSourceUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (
      (url.protocol === 'https:' || url.protocol === 'http:')
      && AMAZON_SOURCE_HOSTS.has(url.hostname)
    )
  } catch {
    return false
  }
}

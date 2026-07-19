import type {
  CreatableUseCaseId,
  UseCaseSourceKind,
} from './useCases'

const AMAZON_SOURCE_HOSTS = new Set([
  'amazon.com',
  'www.amazon.com',
  'a.co',
  'amzn.to',
  'amzn.asia',
  'amzn.eu',
])

export type ProductSourceUrlKind = 'empty' | 'invalid' | 'website' | 'amazon'

export function classifyProductSourceUrl(value: string): ProductSourceUrlKind {
  const trimmed = value.trim()
  if (!trimmed) return 'empty'

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid'
    return AMAZON_SOURCE_HOSTS.has(url.hostname) ? 'amazon' : 'website'
  } catch {
    return 'invalid'
  }
}

export function isAmazonSourceUrl(value: string): boolean {
  return classifyProductSourceUrl(value) === 'amazon'
}

export function getSourceUseCaseSwitchTarget(
  expectedSource: UseCaseSourceKind,
  actualSource: ProductSourceUrlKind,
): CreatableUseCaseId | null {
  if (expectedSource === 'website' && actualSource === 'amazon') return 'amazon_listing'
  if (expectedSource === 'amazon' && actualSource === 'website') return 'website_product'
  return null
}

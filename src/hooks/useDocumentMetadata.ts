import { useEffect } from 'react'

export interface DocumentMetadata {
  /** Full <title> text for the route. */
  readonly title: string
  /** Route-specific meta description; omit to leave the document default. */
  readonly description?: string
  /** Absolute canonical URL for the route. */
  readonly canonical?: string
}

function setMetaContent(selector: string, content: string): (() => void) | null {
  const element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector)
  if (!element) return null
  const attribute = element instanceof HTMLLinkElement ? 'href' : 'content'
  const previous = element.getAttribute(attribute)
  element.setAttribute(attribute, content)
  return () => {
    if (previous === null) element.removeAttribute(attribute)
    else element.setAttribute(attribute, previous)
  }
}

/**
 * Gives a route its own document title, description, and canonical URL.
 *
 * Every route previously inherited index.html's landing metadata, so /signin,
 * /terms and /privacy all announced as the landing page (WCAG 2.4.2 Level A —
 * a screen-reader user cannot tell the views apart) and each declared the
 * homepage as its canonical, telling crawlers the legal pages *are* the
 * homepage. Restores the previous values on unmount so navigating away from a
 * route that sets metadata does not leave its title behind.
 */
export function useDocumentMetadata({ title, description, canonical }: DocumentMetadata): void {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    const restores = [
      description === undefined
        ? null
        : setMetaContent('meta[name="description"]', description),
      description === undefined
        ? null
        : setMetaContent('meta[property="og:description"]', description),
      title === undefined ? null : setMetaContent('meta[property="og:title"]', title),
      canonical === undefined ? null : setMetaContent('link[rel="canonical"]', canonical),
      canonical === undefined ? null : setMetaContent('meta[property="og:url"]', canonical),
    ].filter((restore): restore is () => void => restore !== null)

    return () => {
      document.title = previousTitle
      for (const restore of restores) restore()
    }
  }, [title, description, canonical])
}

import type { BeforeSendEvent } from '@vercel/analytics/react'

/**
 * Lets only page views through, reduced to the page address without query string or hash.
 * Notes never appear in the URL anyway; this makes sure nothing else can ride along.
 */
export function pageViewOnly(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== 'pageview') return null
  const url = new URL(event.url)
  return { type: 'pageview', url: url.origin + url.pathname }
}

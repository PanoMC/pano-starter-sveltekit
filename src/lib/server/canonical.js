import { env } from '#lib/server/env.js'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * On a local machine `localhost` and `127.0.0.1` are the same server but two origins, and SvelteKit refuses a form
 * post whose origin is not ORIGIN. A page opened through the other loopback name is sent on to ORIGIN, so forms work.
 * Only loopback names with ORIGIN's own port are redirected; a public host is never touched (a proxy may rewrite Host).
 * @param {import('@sveltejs/kit').RequestEvent} event
 * @returns {Response | null}
 */
export function loopbackRedirect(event) {
  return loopbackTarget(
    env.ORIGIN,
    event.request?.method ?? 'GET',
    event.request?.headers?.get?.('host') ?? null,
    event.url
  )
}

/**
 * @param {string | undefined} origin  ORIGIN of the app
 * @param {string} method
 * @param {string | null} host  the Host header of the request
 * @param {URL} url
 * @returns {Response | null}
 */
export function loopbackTarget(origin, method, host, url) {
  if (!origin || !host || (method !== 'GET' && method !== 'HEAD')) return null

  /** @type {URL} */
  let canonical

  try {
    canonical = new URL(origin)
  } catch {
    return null
  }

  if (host === canonical.host) return null

  const at = host.lastIndexOf(':')
  const name = at > 0 && !host.endsWith(']') ? host.slice(0, at) : host
  const port = at > 0 && !host.endsWith(']') ? host.slice(at + 1) : ''

  if (!LOOPBACK.has(name) || !LOOPBACK.has(canonical.hostname) || port !== canonical.port) return null

  return new Response(null, {
    status: 307,
    headers: { location: canonical.origin + url.pathname + url.search }
  })
}

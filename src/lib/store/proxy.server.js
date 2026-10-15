// The /pano proxy (BFF): browser code (the cart and checkout controllers, widgets) talks to Pano through this server.
// The browser never holds the front-end key or the session token: they are added here, on the way out.
import { env } from '#lib/server/env.js'
import { SESSION_COOKIE, clientIpOf, panoOrigin } from '#lib/server/pano.js'

/** Largest request body we forward. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024

const UPSTREAM_TIMEOUT_MS = 30_000
const API_PREFIX = ['api', 'v1']
const PLUGINS_PREFIX = ['api', 'plugins']

/** Request headers that go to Pano. Everything else (Cookie, Authorization, Origin, key headers, ...) is dropped. */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
  'x-order-token',
  'if-none-match',
  'if-modified-since'
]

/** Response headers that go back to the browser. Set-Cookie and the rest are dropped. */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'retry-after',
  'referrer-policy',
  'x-ratelimit-limit',
  'x-ratelimit-remaining'
]

const NO_BODY_STATUSES = new Set([101, 204, 205, 304])

/** Same JSON error body Pano sends: `{ error: { code, message? } }`. @param {number} status @param {string} code @param {string} [message] */
export function errorResponse(status, code, message) {
  return Response.json(
    { error: { code, ...(message ? { message } : {}) } },
    { status, headers: { 'cache-control': 'no-store' } }
  )
}

/**
 * Which path may be forwarded: `api/v1/...` but not `api/v1/panel` (the admin panel API is never reachable through the site)
 * and not `api/v1/auth/...` (sign-in goes through this server's form actions, so the session token cannot reach browser JS);
 * and a plugin's site endpoints `api/plugins/<pluginId>/...` but not its panel ones `api/plugins/<pluginId>/panel/...`.
 * @param {string|undefined} path the rest parameter of /pano/[...path]
 * @returns {{ ok: true, segments: string[] } | { ok: false, status: number, code: string, message?: string }}
 */
export function checkPath(path) {
  const raw = path ?? ''
  const segments = raw.split('/')

  // Dot segments, backslashes, control characters and empty segments are how a prefix check is walked around.
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..')
      return { ok: false, status: 404, code: 'NOT_FOUND' }
    if (/[\\\u0000-\u001f\u007f]/.test(segment)) return { ok: false, status: 404, code: 'NOT_FOUND' }
  }

  if (segments[0] === PLUGINS_PREFIX[0] && segments[1] === PLUGINS_PREFIX[1]) {
    // api/plugins/<pluginId>/<relative>: the relative part is the plugin's own; its first segment `panel` is the panel API.
    if (segments.length < 4) return { ok: false, status: 404, code: 'NOT_FOUND' }
    if (segments[3].toLowerCase() === 'panel')
      return {
        ok: false,
        status: 403,
        code: 'PATH_NOT_PROXIED',
        message: 'The panel API is not reachable through this site.'
      }

    return { ok: true, segments }
  }

  if (segments.length < 3 || segments[0] !== API_PREFIX[0] || segments[1] !== API_PREFIX[1]) {
    return { ok: false, status: 404, code: 'NOT_FOUND' }
  }

  const area = segments[2].toLowerCase()

  if (area === 'panel')
    return {
      ok: false,
      status: 403,
      code: 'PATH_NOT_PROXIED',
      message: 'The panel API is not reachable through this site.'
    }
  if (area === 'auth')
    return {
      ok: false,
      status: 403,
      code: 'PATH_NOT_PROXIED',
      message: 'Sign in through this site, not through the proxy.'
    }

  return { ok: true, segments }
}

/** The origins a browser request may come from: this request's own and the configured site address. @param {URL} url */
function siteOrigins(url) {
  const origins = new Set([url.origin])

  try {
    if (env.PANO_SITE_URL) origins.add(new URL(env.PANO_SITE_URL).origin)
  } catch {
    // an unusable PANO_SITE_URL only means one origin fewer
  }

  return origins
}

class BodyTooLarge extends Error {}

/**
 * The request body as bytes, refusing more than MAX_BODY_BYTES (declared or actually streamed).
 * @param {Request} request
 * @returns {Promise<Uint8Array|undefined>}
 */
async function readBody(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BodyTooLarge()
  if (!request.body) return undefined

  const reader = request.body.getReader()
  /** @type {Uint8Array[]} */
  const chunks = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLarge()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

/**
 * Forward one request to Pano.
 * @param {import('@sveltejs/kit').RequestEvent} event
 * @returns {Promise<Response>}
 */
export async function proxyToPano(event) {
  const { request, url } = event
  const method = request.method.toUpperCase()

  const checked = checkPath(event.params.path)
  if (!checked.ok) return errorResponse(checked.status, checked.code, checked.message)

  // A browser sends Origin on every non-GET request. Anything else is a cross-site form, a script or a stranger.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin')
    if (!origin || !siteOrigins(url).has(origin)) {
      return errorResponse(403, 'ORIGIN_MISMATCH', 'This request does not come from this site.')
    }
  }

  /** @type {Uint8Array|undefined} */
  let body
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = await readBody(request)
    } catch (error) {
      if (error instanceof BodyTooLarge)
        return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 5 MB.')
      return errorResponse(400, 'BAD_REQUEST')
    }
  }

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }

  // Key and visitor IP travel together or not at all (Pano only believes the IP of a keyed request).
  const key = env.PANO_FRONTEND_KEY
  if (key) {
    headers.set('x-pano-frontend-key', key)
    const ip = clientIpOf(event)
    if (ip) headers.set('x-pano-client-ip', ip)
  }

  const token = event.cookies.get(SESSION_COOKIE)
  if (token) headers.set('authorization', `Bearer ${token}`)

  const target = `${panoOrigin()}/${checked.segments.map(encodeURIComponent).join('/')}${url.search}`

  /** @type {Response} */
  let upstream
  try {
    // Not `event.fetch`: for a Pano on the same host name SvelteKit adds the visitor's Cookie and Authorization to it.
    upstream = await fetch(target, {
      method,
      headers,
      credentials: 'omit',
      body: /** @type {any} */ (body),
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    })
  } catch (error) {
    const timedOut = /** @type {any} */ (error)?.name === 'TimeoutError'
    return errorResponse(
      timedOut ? 504 : 502,
      timedOut ? 'GATEWAY_TIMEOUT' : 'BAD_GATEWAY',
      'Pano did not answer.'
    )
  }

  const out = new Headers()
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) out.set(name, value)
  }

  // Answers depend on the visitor's session, which is a cookie to the browser.
  out.append('vary', 'Cookie')

  if (upstream.status >= 300 && upstream.status < 400) {
    // Only GET and HEAD pass a redirect on (Pano's avatar redirect to the image host): the Location header, no body.
    // A redirect inside Pano's API goes back through this proxy; the path allow-list already ran on the request.
    const location = upstream.headers.get('location')
    if ((method !== 'GET' && method !== 'HEAD') || !location)
      return errorResponse(502, 'BAD_GATEWAY', 'Pano answered with a redirect.')
    out.set(
      'location',
      /^\/api\/(?:v1\/(?!panel|auth)|plugins\/[^/]+\/(?!panel(?:[/?#]|$)))/i.test(location)
        ? `/pano${location}`
        : location
    )
    await upstream.body?.cancel().catch(() => {})
    return new Response(null, { status: upstream.status, headers: out })
  }

  return new Response(NO_BODY_STATUSES.has(upstream.status) || method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: out
  })
}

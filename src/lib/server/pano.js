// Everything that talks to Pano from this server: the client, the visitor's IP, the session cookie, the plugin list.
// Server only. The front-end key and the session token never go to the browser.
import { isIP } from 'node:net'
import { env } from '#lib/server/env.js'
import { createClient } from '@panomc/client'
import { getPluginPackages } from '#lib/pano/core/index.js'

export const SESSION_COOKIE = 'pano_session'

export const KEY_MESSAGE =
  'Create a front-end key in Panel → Appearance → Themes → gear button (Site display settings) → Site connection keys and put it in .env as PANO_FRONTEND_KEY'

const DEFAULT_API_URL = 'http://localhost:8088/api'
const PLUGINS_TTL_MS = 60_000
const PLUGINS_RETRY_MS = 10_000

/** What precedes "/api/v1": Pano's origin. `API_URL` may end in "/api" or "/api/v1". */
export function panoOrigin() {
  const url = env.PANO_API_URL || env.API_URL || DEFAULT_API_URL
  return url.replace(/\/+$/, '').replace(/\/api(\/v1)?$/, '')
}

/** True when a front-end key is configured. Without one only public pages work. */
export function hasFrontendKey() {
  return Boolean(env.PANO_FRONTEND_KEY)
}

/** Is `ip` loopback or private (Pano's own reverse proxy sits there)? @param {string} ip */
function isPrivateAddress(ip) {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (v4) ip = v4[1]

  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    )
  }

  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80')
  )
}

/**
 * The visitor's IP: the first X-Forwarded-For hop when the socket peer is loopback or private (Pano's proxy),
 * else the peer itself. adapter-node's `getClientAddress()` returns Pano's loopback peer unless `ADDRESS_HEADER`
 * is set, and Pano does not set it. A direct visitor cannot choose their IP through the header.
 * @param {Pick<import('@sveltejs/kit').RequestEvent, 'request' | 'getClientAddress'>} event
 * @returns {string|undefined}
 */
export function clientIpOf(event) {
  let peer
  try {
    peer = event.getClientAddress()
  } catch {
    peer = undefined
  }

  if (peer && !isPrivateAddress(peer)) return peer

  const forwarded = event.request.headers.get('x-forwarded-for')
  const hop = forwarded?.split(',')[0]?.trim()
  if (hop && isIP(hop)) return hop

  return peer || undefined
}

/**
 * The Pano client for this request: key, visitor IP, session token and language.
 * Without PANO_FRONTEND_KEY both key headers are left out.
 * @param {Pick<import('@sveltejs/kit').RequestEvent, 'request' | 'getClientAddress' | 'cookies' | 'fetch'>} event
 * @returns {import('@panomc/client').PanoClient}
 */
export function panoFor(event) {
  return buildClient(event, event.cookies.get(SESSION_COOKIE) || undefined)
}

/**
 * @param {Pick<import('@sveltejs/kit').RequestEvent, 'request' | 'getClientAddress' | 'fetch'>} event
 * @param {string|undefined} sessionToken
 */
function buildClient(event, sessionToken) {
  return createClient({
    baseUrl: panoOrigin(),
    // The global fetch, never event.fetch: with the site on Pano's own origin SvelteKit would answer the call itself and recurse.
    fetch: (input, init) => globalThis.fetch(input, init),
    frontendKey: env.PANO_FRONTEND_KEY || undefined,
    sessionToken,
    clientIp: clientIpOf(event),
    locale: event.request.headers.get('accept-language') ?? undefined
  })
}

/** Is the site served over https? Decides the cookie's Secure flag. @param {Pick<import('@sveltejs/kit').RequestEvent, 'url'>} event */
function isSecure(event) {
  return event.url.protocol === 'https:' || (env.PANO_SITE_URL ?? '').startsWith('https:')
}

/**
 * Store the session token Pano put in the login body: HttpOnly, SameSite=Lax, Secure on https.
 * @param {Pick<import('@sveltejs/kit').RequestEvent, 'cookies' | 'url'>} event
 * @param {{ sessionToken: string, expiresAt?: number }} session
 */
export function setSession(event, session) {
  /** @type {import('cookie').SerializeOptions & { path: string }} */
  const options = { path: '/', httpOnly: true, secure: isSecure(event), sameSite: 'lax' }

  if (typeof session.expiresAt === 'number' && session.expiresAt > 0) {
    // Pano sends milliseconds; accept seconds too.
    options.expires = new Date(session.expiresAt < 1e11 ? session.expiresAt * 1000 : session.expiresAt)
  }

  event.cookies.set(SESSION_COOKIE, session.sessionToken, options)
}

/** @param {Pick<import('@sveltejs/kit').RequestEvent, 'cookies'>} event */
export function clearSession(event) {
  event.cookies.delete(SESSION_COOKIE, { path: '/' })
}

/**
 * Only same-site paths: "/profile" yes, "//evil.test" and "https://evil.test" no.
 * @param {FormDataEntryValue|string|null|undefined} next
 */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/'
}

/** @type {{ at: number, ttl: number, origin: string, value: Set<string> } | null} */
let pluginsCache = null

/** Forget the cached plugin list (tests). */
export function resetPluginsCache() {
  pluginsCache = null
}

/**
 * Namespaces of the plugins whose UI package is installed (`market`, ...), from `/api/v1/plugin-packages`.
 * Cached for 60 seconds; an unreachable Pano gives an empty set for 10 seconds. Never throws.
 * @param {Pick<import('@sveltejs/kit').RequestEvent, 'request' | 'getClientAddress' | 'fetch'>} event
 * @returns {Promise<Set<string>>}
 */
export async function plugins(event) {
  const origin = panoOrigin()
  const now = Date.now()

  if (pluginsCache && pluginsCache.origin === origin && now - pluginsCache.at < pluginsCache.ttl) {
    return pluginsCache.value
  }

  // The list is public: ask without the visitor's session.
  const result = await getPluginPackages(buildClient(event, undefined), { signal: AbortSignal.timeout(3000) })
  /** @type {Set<string>} */
  const value = new Set()

  if (result.ok) {
    for (const [pluginId, info] of Object.entries(result.data?.plugins ?? {})) {
      value.add(info?.namespace || pluginId.replace(/^pano-plugin-/, ''))
    }
  }

  pluginsCache = { at: now, ttl: result.ok ? PLUGINS_TTL_MS : PLUGINS_RETRY_MS, origin, value }
  return value
}

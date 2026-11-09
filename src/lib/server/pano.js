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

/** Is `ip` a loopback address? @param {string} ip */
function isLoopback(ip) {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (v4) ip = v4[1]
  return ip === '::1' || (isIP(ip) === 4 && ip.startsWith('127.'))
}

/** `::ffff:1.2.3.4` and `1.2.3.4` are the same address. @param {string} ip */
const plainIp = (ip) => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1').toLowerCase()

/**
 * The proxies whose X-Forwarded-For is believed: `TRUSTED_PROXIES` (comma separated IPs, plus the words `loopback`
 * and `private`). Unset, it is `loopback` when Pano runs the site as a custom app (PANO_API_URL is set; Pano's proxy
 * connects from loopback and sends a single X-Forwarded-For value), else nothing.
 */
function trustedProxies() {
  const raw = env.TRUSTED_PROXIES ?? (env.PANO_API_URL ? 'loopback' : '')
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

/** @param {string} ip @param {string[]} trusted */
function isTrusted(ip, trusted) {
  if (trusted.includes('loopback') && isLoopback(ip)) return true
  if (trusted.includes('private') && isPrivateAddress(ip)) return true
  return trusted.includes(plainIp(ip))
}

/**
 * The visitor's IP. X-Forwarded-For is read only when the socket peer is a trusted proxy (see trustedProxies), and
 * then from the right: the first hop that is not a trusted proxy is the visitor, the same rule as Pano's own
 * resolver. A hop the visitor wrote themselves sits further left and is never reached. Otherwise the peer itself.
 * adapter-node's `getClientAddress()` returns the proxy's peer unless `ADDRESS_HEADER` is set.
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
  if (!peer) return undefined

  const trusted = trustedProxies()
  if (!isTrusted(peer, trusted)) return peer

  const hops = (event.request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)

  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isIP(hops[i])) return peer
    if (!isTrusted(hops[i], trusted)) return hops[i]
  }

  return hops[0] ?? peer
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
 * Only same-site paths: "/profile" yes, "//evil.test", "https://evil.test" and "/<tab>/evil.test" no. Control
 * characters and whitespace are refused: browsers drop a tab or newline in Location, so "/<tab>/x" would become "//x".
 * @param {FormDataEntryValue|string|null|undefined} next
 */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) && !UNSAFE_IN_PATH.test(next) ? next : '/'
}

// ASCII control characters (0x00-0x1f, 0x7f) and any whitespace
const UNSAFE_IN_PATH = new RegExp('[\\x00-\\x1f\\x7f\\s]')

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

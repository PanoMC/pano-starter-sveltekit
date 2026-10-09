// Browser side of the store: market's compiled controllers (cart, checkout draft, api) driven through the /pano proxy.
// No Svelte in here: components wrap `subscribe` in `$state` themselves. Call these from `onMount` or an event handler,
// never during server rendering (the cart lives in the browser).
import { create, createHost } from '$lib/pano/plugins/market/controllers/controllers.mjs'

/** Where the proxy of src/routes/pano/[...path] is mounted: the controllers add `/api/v1/...` themselves. */
export const BASE_URL = '/pano'

/** Texts of the toasts market's controllers raise (they send only keys). */
const MESSAGES = {
  'plugins.pano-plugin-market.theme.store.added-to-cart': 'Added to cart.',
  'plugins.pano-plugin-market.theme.cart.too-many-lines': 'Your cart is full. Remove something first.',
  'plugins.pano-plugin-market.theme.cart.merge-dropped': 'Some items in your cart were no longer available.',
  'plugins.pano-plugin-market.theme.errors.NETWORK': 'Pano did not answer. Try again in a moment.',
  'plugins.pano-plugin-market.theme.errors.GENERIC': 'Something went wrong. Try again.'
}

/** Page features the controllers may ask for. This starter builds its own markup, so it announces none of the meta ones. */
/** @type {string[]} */
const FEATURES = []

/** @type {Set<(message: string) => void>} */
const toastListeners = new Set()

/** Listen for toast messages. Returns the unsubscribe. @param {(message: string) => void} listener */
export function onToast(listener) {
  toastListeners.add(listener)
  return () => toastListeners.delete(listener)
}

/** @param {'local'|'session'} kind @returns {Storage|null} */
function browserStorage(kind) {
  try {
    const storage = kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage
    return storage ?? memoryStorage(kind)
  } catch {
    return memoryStorage(kind)
  }
}

/** @type {Record<string, Storage>} */
const memory = {}

/** A Storage that lives as long as the page (private mode, blocked storage, tests). @param {string} kind @returns {Storage} */
function memoryStorage(kind) {
  if (!memory[kind]) {
    const map = new Map()
    memory[kind] = /** @type {any} */ ({
      getItem: (/** @type {string} */ key) => (map.has(key) ? map.get(key) : null),
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => void map.set(key, String(value)),
      removeItem: (/** @type {string} */ key) => void map.delete(key),
      clear: () => map.clear(),
      key: (/** @type {number} */ index) => [...map.keys()][index] ?? null,
      get length() {
        return map.size
      }
    })
  }
  return memory[kind]
}

/** @type {{ user: { username: string } | null, host: any }} */
const session = { user: null, host: null }

/**
 * The controllers of this page. One host per page life; the signed-in user is read from `user` on every call, so a
 * login or logout (which reloads the page data) is seen by the next call.
 * @param {{ username: string } | null} user the visitor, from the layout data
 * @param {{ fetch?: typeof fetch, locale?: string, navigate?: (url: string) => void }} [options] for tests and for SvelteKit's own `fetch`
 */
export function getMarket(user, options = {}) {
  session.user = user ?? null

  if (!session.host) {
    session.host = createHost({
      baseUrl: BASE_URL,
      browser: true,
      fetch: options.fetch,
      getSession: () => ({ user: session.user }),
      locale: () =>
        options.locale ?? globalThis.document?.documentElement?.lang ?? globalThis.navigator?.language,
      messages: MESSAGES,
      features: FEATURES,
      storage: browserStorage,
      onToast: (/** @type {string} */ _key, /** @type {{ message?: string }} */ toast) => {
        if (toast?.message) for (const listener of toastListeners) listener(toast.message)
      },
      onNavigate: options.navigate ?? ((/** @type {string} */ url) => globalThis.location?.assign(url))
    })
  }

  const host = session.host

  /** @type {import('$lib/pano/plugins/market/controllers/controllers.types.js').Controller<any, any>} */
  const cart = create('cart', host)

  // Guest or server cart, by the user. Idempotent per user, so every caller may ask.
  void cart.actions.init()

  return {
    host,
    cart,
    api: /** @type {{ actions: { call: Function, apiGet: Function, post: Function } }} */ (
      create('api', host)
    ),
    settings: /** @type {{ actions: { set: Function } }} */ (create('settings', host))
  }
}

/** Forget the shared host (tests). */
export function resetMarket() {
  session.host = null
  session.user = null
}

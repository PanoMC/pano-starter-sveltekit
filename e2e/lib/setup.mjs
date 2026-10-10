// Bring a fresh instance to the state the scenarios need, over the panel's own API (the same calls the panel pages make).
import { readFileSync } from 'node:fs'
import { Api, must } from './api.mjs'
import { adminLogin } from './instance.mjs'

const MARKET = '/api/plugins/pano-plugin-market/panel'

/** Sign in as the instance's admin. @param {string} panoOrigin */
export async function adminSession(panoOrigin) {
  const admin = new Api(panoOrigin)
  const { user, password } = adminLogin()
  const res = await admin.loginPanel(user, password)

  if (res.status !== 200 || !admin.csrfToken)
    throw new Error(`admin login failed: HTTP ${res.status} ${res.text.slice(0, 200)}`)
  return admin
}

/**
 * Make `address` the website address (where visitors are; market builds its return links from it).
 * @param {Api} admin @param {string} address
 */
export async function useAddressAsSite(admin, address) {
  must(
    await admin.multipart('PUT', '/api/v1/panel/settings', {
      websiteUrl: address,
      password: adminLogin().password
    }),
    'settings: website address'
  )
}

/**
 * The origins a browser page may call Pano from with its cookie (panel: Appearance -> Themes -> gear button -> Origins).
 * @param {Api} admin @param {string[]} origins
 */
export async function setAllowedOrigins(admin, origins) {
  must(
    await admin.put('/api/v1/panel/frontend/origins', { origins }),
    `allow the origins ${origins.join(', ') || '(none)'}`
  )
}

/** Registering needs no mail round trip, and the instance sends no mail. @param {Api} admin */
export async function openRegistration(admin) {
  must(
    await admin.multipart('PUT', '/api/v1/panel/settings', { requireEmailVerification: 'false' }),
    'settings: no email verification'
  )
  must(
    await admin.multipart('PUT', '/api/v1/panel/settings', {
      email: JSON.stringify({
        enabled: false,
        hostname: '',
        port: 587,
        ssl: false,
        starttls: 'DISABLED',
        username: '',
        password: '',
        sender: ''
      })
    }),
    'settings: mail off'
  )
}

/** One published post for the home page. @param {Api} admin @param {string} title */
export async function createPost(admin, title) {
  let categories = must(await admin.get('/api/v1/panel/post/categories'), 'post categories').json
  let list = categories?.items ?? categories?.categories ?? []

  if (!list.length) {
    must(
      await admin.post('/api/v1/panel/post/categories', {
        title: 'News',
        description: 'News',
        url: 'news',
        color: '#336699'
      }),
      'create post category'
    )
    categories = must(await admin.get('/api/v1/panel/post/categories'), 'post categories').json
    list = categories?.items ?? categories?.categories ?? []
  }

  const category = list[0]?.id
  if (!category) throw new Error(`no post category: ${JSON.stringify(categories).slice(0, 200)}`)

  must(
    await admin.multipart('POST', '/api/v1/panel/post', {
      title,
      category,
      text: '<p>Written by the starter end-to-end run.</p>',
      publish: true
    }),
    'create post'
  )
}

/**
 * The store: settings, the fake payment methods pointed at the run's gateway, one product.
 * @param {Api} admin @param {{ baseUrl: string, secret: string }} gateway @param {string} tag
 */
export async function prepareStore(admin, gateway, tag) {
  must(
    await admin.post(`${MARKET}/settings`, {
      testMode: true,
      currency: 'EUR',
      statsCurrency: 'EUR',
      vatPercent: 20,
      showVatInPrice: true,
      allowGuestCheckout: true,
      allowGiftPurchase: true,
      orderExpiryMinutes: 60,
      checkoutRateLimitPerMinute: 100000,
      quoteRateLimitPerMinute: 100000,
      couponLockThreshold: 1000,
      invoiceEnabled: true,
      sendEmailAfterPurchase: false,
      storeTimeZone: 'UTC',
      storeEnabled: true,
      minimumOrderAmount: 0
    }),
    'market settings'
  )

  for (const id of ['fake', 'fake-eur']) {
    must(
      await admin.post(`${MARKET}/payment-methods/${id}`, {
        settings: { gatewayUrl: gateway.baseUrl, secret: gateway.secret }
      }),
      `configure ${id}`
    )
    must(await admin.post(`${MARKET}/payment-methods/${id}/toggle`, { enabled: true }), `enable ${id}`)
  }

  const name = `Starter VIP ${tag}`
  const slug = `starter-vip-${tag}`
  const created = must(
    await admin.multipart('POST', `${MARKET}/products`, {
      name,
      slug,
      price: '10.00',
      status: 'ACTIVE',
      shortDescription: 'Bought in the starter end-to-end run'
    }),
    'create product'
  )

  // The goal widget shows nothing until the store has a goal to show.
  must(
    await admin.post(`${MARKET}/goals`, {
      name: `Starter goal ${tag}`,
      metric: 'ORDERS',
      target: 25,
      period: 'ONE_TIME',
      showOnStore: true
    }),
    'create a store goal'
  )

  return { name, slug, id: created.json?.id }
}

/** A front-end key, the way the panel makes one. Returns the key (shown once). @param {Api} admin @param {string} name */
export async function createFrontendKey(admin, name) {
  const created = must(await admin.post('/api/v1/panel/frontend/keys', { name }), 'create front-end key').json
  const key = created?.key ?? created?.data?.key

  if (typeof key !== 'string' || !key.startsWith('pfk_'))
    throw new Error(`the front-end key answer holds no key: ${JSON.stringify(created).slice(0, 200)}`)
  return key
}

/** Upload a custom app zip (multipart field `file`). @param {Api} admin @param {string} zipFile */
export async function uploadCustomApp(admin, zipFile) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(zipFile)], { type: 'application/zip' }), 'pano-starter.zip')

  return must(
    await admin.request('POST', '/api/v1/panel/frontend/custom-apps', form),
    'upload the custom app'
  )
}

/** Select the front-end. @param {Api} admin @param {Record<string, unknown>} body */
export async function setFrontend(admin, body) {
  return must(await admin.put('/api/v1/panel/frontend', body), `set the front-end ${JSON.stringify(body)}`)
}

/** Pano fetches the front-end's descriptor (/.well-known/pano-frontend.json: its page addresses) again. @param {Api} admin */
export async function refreshDescriptor(admin) {
  const res = must(
    await admin.post('/api/v1/panel/frontend/descriptor/refresh', {}),
    'refresh the front-end descriptor'
  )
  return res.json
}

/** The order the panel sees for a public id, or null. @param {Api} admin @param {string} publicId */
export async function findOrder(admin, publicId) {
  const res = must(await admin.get(`${MARKET}/orders?search=${encodeURIComponent(publicId)}`), 'list orders')
  const items = res.json?.items ?? res.json?.orders ?? []

  return items.find((/** @type {any} */ order) => order.publicId === publicId) ?? null
}

/** The id of the user `username`, as the panel knows it. @param {Api} admin @param {string} username */
export async function userIdOf(admin, username) {
  const res = must(
    await admin.get(`/api/v1/panel/players/${encodeURIComponent(username)}`),
    `find user ${username}`
  )
  const id = res.json?.player?.id ?? res.json?.id

  if (typeof id !== 'number') throw new Error(`no id for ${username}: ${res.text.slice(0, 200)}`)
  return id
}

/** Give a user one permission node (read, add, write back: the snapshot route replaces the whole grid). @param {Api} admin @param {number} userId @param {string} node */
export async function grantUserNode(admin, userId, node) {
  const snapshot = must(await admin.get('/api/v1/panel/permission/snapshot'), 'permission snapshot').json
  const nodes = snapshot.nodes ?? []

  if (
    nodes.some((/** @type {any} */ n) => n.holderType === 'USER' && n.holderId === userId && n.node === node)
  )
    return

  nodes.push({ holderType: 'USER', holderId: userId, node, active: true, context: {} })
  must(
    await admin.post('/api/v1/panel/permission/snapshot', {
      groups: snapshot.groups ?? [],
      tracks: snapshot.tracks ?? [],
      nodes
    }),
    'save permission snapshot'
  )
}

/** The node that lets a buyer use a test-mode payment method such as market's fake gateway. */
export const PAYMENTS_NODE = 'pano.plugin.pano-plugin-market.manage.market.payments'

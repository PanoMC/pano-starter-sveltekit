import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { handle } from '../../src/hooks.server.js'
import { load as layoutLoad } from '../../src/routes/(site)/store/+layout.server.js'
import { load as storeLoad } from '../../src/routes/(site)/store/+page.server.js'
import { load as productLoad } from '../../src/routes/(site)/store/[slug]/+page.server.js'
import { load as checkoutLoad } from '../../src/routes/(site)/store/checkout/+page.server.js'
import { load as orderLoad } from '../../src/routes/(site)/store/order/[id]/+page.server.js'
import StoreLayout from '../../src/routes/(site)/store/+layout.svelte'
import StorePage from '../../src/routes/(site)/store/+page.svelte'
import ProductPage from '../../src/routes/(site)/store/[slug]/+page.svelte'
import CheckoutPage from '../../src/routes/(site)/store/checkout/+page.svelte'
import OrderPage from '../../src/routes/(site)/store/order/[id]/+page.svelte'
import { SESSION_COOKIE, resetPluginsCache } from '../../src/lib/server/pano.js'
import { NOT_INSTALLED } from '../../src/lib/store/load.server.js'
import { render } from 'svelte/server'
import { makeEvent, renderPage, runHandle, thrown } from '../helpers.js'
import { startMarketStub } from './stub.js'

let withMarket
let withoutMarket

beforeAll(() => {
  withMarket = startMarketStub({ market: true })
  withoutMarket = startMarketStub({ market: false })
})

afterAll(() => {
  withMarket.stop()
  withoutMarket.stop()
})

beforeEach(() => {
  withMarket.clear()
  withoutMarket.clear()
  resetPluginsCache()
  delete process.env.PANO_API_URL
  delete process.env.PANO_FRONTEND_KEY
  delete process.env.PANO_SITE_URL
})

/** An event that went through hooks (locals.pano, locals.user, locals.plugins), like a real request. */
async function request(stub, options) {
  process.env.API_URL = `${stub.url}/api`
  resetPluginsCache()
  const { event } = await runHandle(handle, makeEvent(options))
  return event
}

/** The data a page gets: its own load merged over the layouts' (the root layout gives `user`). */
async function pageData(event, load) {
  const own = (await load(event)) ?? {}
  const layout = (await layoutLoad(event)) ?? {}
  const user = event.locals.user ? { username: event.locals.user.username, panelAccess: false } : null
  return { user, ...layout, ...own }
}

describe('with the market plugin', () => {
  test('the store lists products and links to them', async () => {
    const event = await request(withMarket, { url: 'http://site.test/store' })
    const data = await pageData(event, storeLoad)

    expect(data.missing).toBe(false)
    expect(data.items.map((p) => p.slug)).toEqual(['vip-rank', 'coins'])
    expect(data.categories.map((c) => c.name)).toEqual(['Ranks', 'Currency'])

    const html = await renderPage(StorePage, { data })
    expect(html).toContain('Block Shop')
    expect(html).toContain('VIP Rank')
    expect(html).toContain('href="/store/vip-rank"')
    expect(html).toContain('$9.99')
    expect(html).toContain('$14.99')
    expect(html).toContain('Out of stock')
    expect(html).toContain('/pano/api/plugins/pano-plugin-market/products/image/vip.png')
    expect(html).toContain('Featured')
    expect(html).not.toContain(NOT_INSTALLED)
  })

  test('a category and a search go to the products endpoint', async () => {
    const event = await request(withMarket, { url: 'http://site.test/store?category=2&search=coin&page=1' })
    const data = await pageData(event, storeLoad)

    expect(data.items.map((p) => p.slug)).toEqual(['coins'])
    expect(data.featured).toEqual([])
    expect(data.filter).toEqual({ page: 1, category: 2, search: 'coin', sort: '' })

    const call = withMarket.requests.find((r) => r.path.includes('/store/products'))
    expect(call.path).toBe('/api/plugins/pano-plugin-market/store/products?page=1&category=2&search=coin')

    const html = await renderPage(StorePage, { data })
    expect(html).toContain('Coin pack')
    expect(html).not.toContain('VIP Rank')
  })

  test('the layout shows the cart link', async () => {
    const event = await request(withMarket, { url: 'http://site.test/store' })
    const data = await pageData(event, storeLoad)
    const html = await renderPage(StoreLayout, { data, children: () => {} })

    expect(data.market).toBe(true)
    expect(html).toContain('href="/store/checkout"')
    expect(html).toContain('Cart')
  })

  test('a product page shows its price, description and the add button', async () => {
    const event = await request(withMarket, {
      url: 'http://site.test/store/vip-rank',
      params: { slug: 'vip-rank' }
    })
    const data = await pageData(event, productLoad)

    expect(data.product.name).toBe('VIP Rank')

    const html = await renderPage(ProductPage, { data })
    expect(render(ProductPage, { props: { data } }).head).toContain('<title>VIP Rank</title>')
    expect(html).toContain('$9.99')
    expect(html).toContain('Be <b>very</b> important')
    expect(html).toContain('Add to cart')
    expect(html).toContain('Ranks')
  })

  test('an unknown product is a 404', async () => {
    const event = await request(withMarket, { url: 'http://site.test/store/nope', params: { slug: 'nope' } })
    const error = await thrown(() => productLoad(event))

    expect(error.status).toBe(404)
  })

  test('the checkout page renders with the checkout config (the cart is filled in the browser)', async () => {
    const event = await request(withMarket, { url: 'http://site.test/store/checkout' })
    const data = await pageData(event, checkoutLoad)

    expect(data.config.guestCheckout).toBe(true)

    const html = await renderPage(CheckoutPage, { data })
    expect(html).toContain('Checkout')
    expect(html).toContain('Pay')
    expect(html).not.toContain(NOT_INSTALLED)
  })

  test('an order shows its status; the server asks for the limited view and never sends a token', async () => {
    withMarket.state.orders.k = { publicId: 'ord1', token: 'secret', quote: { total: 10, lines: [] } }
    const event = await request(withMarket, {
      url: 'http://site.test/store/order/ord1?token=secret',
      params: { id: 'ord1' }
    })
    const data = await pageData(event, orderLoad)

    expect(data.order.limited).toBe(true)

    const html = await renderPage(OrderPage, { data })
    expect(html).toContain('Order ord1')
    expect(html).toContain('Waiting for payment')

    const call = withMarket.requests.find((r) =>
      r.path.startsWith('/api/plugins/pano-plugin-market/orders/')
    )
    expect(call.path).toBe('/api/plugins/pano-plugin-market/orders/ord1')
    expect(call.headers['x-order-token']).toBeUndefined()
  })

  test('an unknown order is a 404', async () => {
    const event = await request(withMarket, {
      url: 'http://site.test/store/order/zzz',
      params: { id: 'zzz' }
    })

    expect((await thrown(() => orderLoad(event))).status).toBe(404)
  })

  test('a signed-in visitor is asked for with the session token and the key', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_test'
    const event = await request(withMarket, {
      url: 'http://site.test/store',
      cookies: { [SESSION_COOKIE]: 'tok-1' },
      headers: { 'x-forwarded-for': '203.0.113.9' }
    })
    await storeLoad(event)

    const call = withMarket.requests.find((r) => r.path === '/api/plugins/pano-plugin-market/store')
    expect(call.headers.authorization).toBe('Bearer tok-1')
    expect(call.headers['x-pano-frontend-key']).toBe('pfk_test')
    expect(event.locals.user.username).toBe('steve')
  })

  test('store routes do not fail the build or the request when Pano is down: a down Pano is a 502', async () => {
    const event = await request(withMarket, { url: 'http://site.test/store' })
    process.env.API_URL = 'http://127.0.0.1:1/api'
    event.locals.pano = (
      await request({ url: 'http://127.0.0.1:1' }, { url: 'http://site.test/store' })
    ).locals.pano
    // locals.plugins still says market is installed (cached)
    event.locals.plugins = new Set(['market'])

    expect((await thrown(() => storeLoad(event))).status).toBe(502)
  })
})

describe('without the market plugin', () => {
  test('every store route says so and asks Pano for nothing from the market', async () => {
    const urls = [
      ['/store', storeLoad, StorePage, {}],
      ['/store/vip-rank', productLoad, ProductPage, { slug: 'vip-rank' }],
      ['/store/checkout', checkoutLoad, CheckoutPage, {}],
      ['/store/order/ord1', orderLoad, OrderPage, { id: 'ord1' }]
    ]

    for (const [path, load, Page, params] of urls) {
      withoutMarket.clear()
      const event = await request(withoutMarket, { url: `http://site.test${path}`, params })
      const data = await pageData(event, load)

      expect(data.missing).toBe(true)
      expect(data.market).toBe(false)

      const html = await renderPage(Page, { data })
      expect(html).toContain(NOT_INSTALLED)

      // only the plugin list was asked for
      expect(
        withoutMarket.requests.filter((r) => r.path.includes('/plugins/pano-plugin-market'))
      ).toHaveLength(0)
    }
  })

  test('the layout hides the cart link', async () => {
    const event = await request(withoutMarket, { url: 'http://site.test/store' })
    const data = await pageData(event, storeLoad)
    const html = await renderPage(StoreLayout, { data, children: () => {} })

    expect(html).not.toContain('/store/checkout')
  })
})

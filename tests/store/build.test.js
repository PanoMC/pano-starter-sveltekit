// The production build against the Pano stub: real HTTP, real SvelteKit routing, the /pano proxy and the store pages.
// Skipped until `bun run build` has produced build/index.js.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { startMarketStub } from './stub.js'
import { stageEntry } from '../helpers.js'

// the entry applies ORIGIN (adapter-node 6 has no ORIGIN variable of its own); the build must exist
const built = existsSync(resolve(import.meta.dir, '../../build/index.js'))

const entry = built ? stageEntry() : ''

describe.skipIf(!built)('production build: store and proxy', () => {
  /** @type {ReturnType<typeof startMarketStub>} */
  let withMarket
  /** @type {ReturnType<typeof startMarketStub>} */
  let withoutMarket
  /** @type {import('bun').Subprocess[]} */
  const children = []

  /** Start the built server against `stub`; returns its origin. */
  async function startSite(stub, extraEnv = {}) {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = probe.port
    probe.stop(true)

    const origin = `http://127.0.0.1:${port}`
    const child = Bun.spawn(['bun', entry], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        ORIGIN: origin,
        API_URL: `${stub.url}/api`,
        PANO_SITE_URL: origin,
        ...extraEnv
      },
      stdout: 'ignore',
      stderr: 'ignore'
    })
    children.push(child)

    for (let i = 0; i < 100; i++) {
      try {
        await fetch(origin)
        return origin
      } catch {
        await Bun.sleep(100)
      }
    }
    throw new Error('the built site did not start')
  }

  beforeAll(() => {
    withMarket = startMarketStub({ market: true })
    withoutMarket = startMarketStub({ market: false })
  })

  afterAll(() => {
    for (const child of children) child.kill()
    withMarket.stop()
    withoutMarket.stop()
  })

  test('the store, a product, the checkout and an order render from Pano', async () => {
    const site = await startSite(withMarket, { PANO_FRONTEND_KEY: 'pfk_test' })

    const store = await (await fetch(`${site}/store`)).text()
    expect(store).toContain('Block Shop')
    expect(store).toContain('VIP Rank')
    expect(store).toContain('href="/store/vip-rank"')

    const product = await fetch(`${site}/store/vip-rank`)
    expect(product.status).toBe(200)
    expect(await product.text()).toContain('Add to cart')

    expect((await fetch(`${site}/store/nope`)).status).toBe(404)

    const checkout = await fetch(`${site}/store/checkout`)
    expect(checkout.status).toBe(200)
    expect(await checkout.text()).toContain('Checkout')

    withMarket.state.orders.k = { publicId: 'ord1', token: 'secret', quote: { total: 10, lines: [] } }
    const order = await (await fetch(`${site}/store/order/ord1`)).text()
    expect(order).toContain('Waiting for payment')
    // the access token is never in the page
    expect(order).not.toContain('secret')
  })

  test('/pano forwards api/v1, refuses the panel API and checks the origin of a write', async () => {
    withMarket.clear()
    const site = await startSite(withMarket, { PANO_FRONTEND_KEY: 'pfk_test' })

    const packages = await fetch(`${site}/pano/api/v1/plugin-packages`)
    expect(packages.status).toBe(200)
    expect((await packages.json()).plugins['pano-plugin-market'].namespace).toBe('market')
    const seen = withMarket.requests.findLast((r) => r.path === '/api/v1/plugin-packages')
    expect(seen.headers['x-pano-frontend-key']).toBe('pfk_test')

    const panel = await fetch(`${site}/pano/api/v1/panel/basicData`)
    expect(panel.status).toBe(403)
    expect(withMarket.requests.some((r) => r.path.includes('/panel/'))).toBe(false)

    expect((await fetch(`${site}/pano/setup/anything`)).status).toBe(404)

    const quote = (headers) =>
      fetch(`${site}/pano/api/plugins/pano-plugin-market/checkout/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ items: [{ productId: 11, quantity: 1 }] })
      })

    const noOrigin = await quote({})
    expect(noOrigin.status).toBe(403)
    expect((await noOrigin.json()).error.code).toBe('ORIGIN_MISMATCH')

    expect((await quote({ origin: 'https://evil.test' })).status).toBe(403)

    const ok = await quote({ origin: site })
    expect(ok.status).toBe(200)
    expect((await ok.json()).quote.total).toBe(9.99)
  })

  test('the browser cookie is not forwarded and the session becomes a Bearer token', async () => {
    withMarket.clear()
    const site = await startSite(withMarket, { PANO_FRONTEND_KEY: 'pfk_test' })

    await fetch(`${site}/pano/api/plugins/pano-plugin-market/store`, {
      headers: { cookie: 'pano_session=tok-77; theme=dark' }
    })

    const seen = withMarket.requests.findLast((r) => r.path.endsWith('/pano-plugin-market/store'))
    expect(seen.headers.authorization).toBe('Bearer tok-77')
    expect(seen.headers.cookie).toBeUndefined()
  })

  test('on a Pano without the market plugin every store page says so', async () => {
    const site = await startSite(withoutMarket)

    for (const path of ['/store', '/store/vip-rank', '/store/checkout', '/store/order/ord1']) {
      const response = await fetch(`${site}${path}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('The market plugin is not installed on this Pano')
    }
  })
})

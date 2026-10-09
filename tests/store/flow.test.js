// The browser half of the store, end to end without a browser: market's compiled controllers call `/pano/...`,
// the proxy handler answers them from the Pano stub. Cart, quote, checkout, order.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { DELETE, GET, PATCH, POST, PUT } from '../../src/routes/pano/[...path]/+server.js'
import { SESSION_COOKIE } from '../../src/lib/server/pano.js'
import { displayLines } from '../../src/lib/store/cart.js'
import { placeOrder, requestQuote } from '../../src/lib/store/checkout.js'
import { getMarket, resetMarket } from '../../src/lib/store/market.js'
import { afterCheckout, orderPagePath, readOrderToken } from '../../src/lib/store/payment.js'
import { makeEvent } from '../helpers.js'
import { PRODUCTS, startMarketStub } from './stub.js'

const SITE = 'http://site.test'
const HANDLERS = { GET, POST, PUT, PATCH, DELETE }

let stub

beforeAll(() => {
  stub = startMarketStub()
})
afterAll(() => stub.stop())

beforeEach(() => {
  stub.clear()
  stub.state.orders = {}
  stub.state.cart = []
  stub.state.checkoutError = null
  resetMarket()
  process.env.API_URL = `${stub.url}/api`
  process.env.PANO_FRONTEND_KEY = 'pfk_test'
  delete process.env.PANO_API_URL
  delete process.env.PANO_SITE_URL
})

/** A `fetch` that behaves like the browser on the site: relative `/pano/...` URLs, same-origin, the session cookie. */
function browserFetch(cookies = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input), SITE)
    const event = makeEvent({
      url: url.href,
      params: { path: url.pathname.replace(/^\/pano\//, '') },
      cookies
    })
    event.request = new Request(url, {
      method: init.method ?? 'GET',
      headers: { origin: SITE, ...init.headers },
      body: init.body
    })
    return HANDLERS[event.request.method](event)
  }
}

const vip = PRODUCTS[0]
const vipMeta = {
  id: vip.id,
  name: vip.name,
  slug: vip.slug,
  price: vip.price,
  imageFileName: vip.imageFileName
}

function market(user, cookies, navigated = []) {
  return getMarket(user, { fetch: browserFetch(cookies), navigate: (url) => navigated.push(url) })
}

describe('a guest', () => {
  test('adds to the cart, gets a quote, pays, and lands on the gateway; the order token is kept for the tab', async () => {
    const navigated = []
    const m = market(null, {}, navigated)
    await m.cart.actions.init()
    expect(m.cart.get().mode).toBe('GUEST')

    expect(await m.cart.actions.add({ productId: vip.id, quantity: 2 }, vipMeta)).toBe(true)
    expect(m.cart.get().count).toBe(2)
    expect(displayLines(m.cart.get())[0]).toMatchObject({ name: 'VIP Rank', quantity: 2, unitPrice: 9.99 })

    // quote with a payment method: the fee is in the total
    const input = { user: null, lines: m.cart.get().lines, email: 'a@b.test', methodId: 'card' }
    const quoted = await requestQuote(m, input)
    expect(quoted.ok).toBe(true)
    expect(quoted.quote.total).toBe(20.28)
    expect(quoted.quote.paymentMethods.map((p) => p.id)).toEqual(['card', 'bank', 'broken'])

    // the request that reached Pano: through the proxy, no browser cookies, no session
    const call = stub.requests.find((r) => r.path.endsWith('/checkout/quote'))
    expect(call.body).toEqual({
      items: [{ productId: vip.id, quantity: 2 }],
      guest: { email: 'a@b.test' },
      paymentMethodId: 'card'
    })
    expect(call.headers.authorization).toBeUndefined()
    expect(call.headers['x-pano-frontend-key']).toBe('pfk_test')

    const idempotency = { body: null, key: null }
    const placed = await placeOrder(m, { ...input, quote: quoted.quote, legal: null }, idempotency)

    expect(placed).toEqual({ ok: true, to: 'https://pay.example/checkout/abc' })
    expect(m.cart.get().lines).toEqual([])
    expect(readOrderToken(m.host.storage('session'), 'ord1')).toBe('token-1')

    const order = stub.requests.find((r) => r.method === 'POST' && r.path.endsWith('/checkout'))
    expect(order.headers['idempotency-key']).toBe(idempotency.key)
    expect(order.body.expectedTotal).toBe(20.28)
  })

  test('the same body is sent with the same Idempotency-Key, a changed body with a new one', async () => {
    const m = market(null)
    await m.cart.actions.init()
    await m.cart.actions.add({ productId: vip.id, quantity: 1 }, vipMeta)

    const input = { user: null, lines: m.cart.get().lines, email: 'a@b.test', methodId: 'bank' }
    const { quote } = await requestQuote(m, input)
    const idempotency = { body: null, key: null }

    stub.state.checkoutError = { status: 503, code: 'NETWORK' }
    const first = await placeOrder(m, { ...input, quote }, idempotency)
    const key = idempotency.key

    stub.state.checkoutError = { status: 429, code: 'TOO_MANY_REQUESTS' }
    await placeOrder(m, { ...input, quote }, idempotency)

    expect(first.ok).toBe(false)
    expect(idempotency.key).toBe(key)

    // a failure that settles the question drops the key
    stub.state.checkoutError = { status: 400, code: 'EMAIL_REQUIRED' }
    const refused = await placeOrder(m, { ...input, quote }, idempotency)
    expect(refused).toMatchObject({ ok: false, code: 'EMAIL_REQUIRED', message: 'Enter your email address.' })
    expect(idempotency.key).toBeNull()

    stub.state.checkoutError = null
    await placeOrder(m, { ...input, quote }, idempotency)
    expect(idempotency.key).not.toBe(key)
    expect(m.cart.get().lines).toEqual([])
  })

  test('a price that changed asks for a new quote instead of charging', async () => {
    const m = market(null)
    await m.cart.actions.init()
    await m.cart.actions.add({ productId: vip.id, quantity: 1 }, vipMeta)

    const input = { user: null, lines: m.cart.get().lines, email: 'a@b.test', methodId: 'bank' }
    const { quote } = await requestQuote(m, input)
    const stale = { ...quote, total: quote.total + 1 }

    const result = await placeOrder(m, { ...input, quote: stale }, { body: null, key: null })

    expect(result).toMatchObject({ ok: false, code: 'QUOTE_CHANGED', requote: true })
    expect(m.cart.get().lines).toHaveLength(1)
  })

  test('the order page can be opened with the token: the proxy forwards it', async () => {
    const m = market(null)
    await m.cart.actions.init()
    await m.cart.actions.add({ productId: vip.id, quantity: 1 }, vipMeta)
    const input = { user: null, lines: m.cart.get().lines, email: 'a@b.test', methodId: 'bank' }
    const { quote } = await requestQuote(m, input)
    await placeOrder(m, { ...input, quote }, { body: null, key: null })

    const token = readOrderToken(m.host.storage('session'), 'ord1')
    const limited = await m.api.actions.call('GET', '/orders/ord1')
    const full = await m.api.actions.call('GET', '/orders/ord1', { headers: { 'X-Order-Token': token } })

    expect(limited.order.limited).toBe(true)
    expect(full.order).toMatchObject({ status: 'COMPLETED', number: 7 })
    expect(full.order.items[0].name).toBe('VIP Rank')
  })
})

describe('a signed-in buyer', () => {
  test('the server cart is used; the browser never holds the token, the proxy adds it', async () => {
    const m = market({ username: 'steve' }, { [SESSION_COOKIE]: 'tok-1' })
    await m.cart.actions.init()
    expect(m.cart.get().mode).toBe('SERVER')

    await m.cart.actions.add({ productId: vip.id, quantity: 1 }, vipMeta)

    const added = stub.requests.find((r) => r.method === 'POST' && r.path.endsWith('/me/cart/items'))
    expect(added.headers.authorization).toBe('Bearer tok-1')
    expect(added.headers['x-pano-frontend-key']).toBe('pfk_test')
    expect(added.body).toMatchObject({ productId: vip.id, quantity: 1 })
    expect(m.cart.get().count).toBe(1)

    // a signed-in quote does not send the lines: they are on the server
    const quoted = await requestQuote(m, {
      user: { username: 'steve' },
      lines: m.cart.get().lines,
      methodId: 'bank'
    })
    expect(quoted.ok).toBe(true)
    const call = stub.requests.filter((r) => r.path.endsWith('/checkout/quote')).at(-1)
    expect(call.body).toEqual({ paymentMethodId: 'bank' })
  })
})

describe('after the checkout', () => {
  test('where the browser goes', () => {
    const order = { publicId: 'ord1' }

    expect(afterCheckout({ kind: 'REDIRECT', url: 'https://pay.example/x' }, order)).toEqual({
      type: 'ASSIGN',
      url: 'https://pay.example/x'
    })
    expect(afterCheckout({ kind: 'REDIRECT', url: 'javascript:alert(1)' }, order)).toEqual({
      type: 'GOTO',
      path: '/store/order/ord1'
    })
    expect(afterCheckout({ kind: 'REDIRECT', url: 'http://a b.test' }, order).type).toBe('GOTO')

    // the market's own attempt page is served through the proxy; any other path is not followed
    expect(
      afterCheckout(
        {
          kind: 'FORM_POST',
          url: 'https://pano.test/api/plugins/pano-plugin-market/payments/attempts/tok/page'
        },
        order
      )
    ).toEqual({ type: 'ASSIGN', url: '/pano/api/plugins/pano-plugin-market/payments/attempts/tok/page' })
    expect(afterCheckout({ kind: 'HTML', url: 'https://evil.test/steal' }, order).type).toBe('GOTO')

    expect(afterCheckout({ kind: 'INSTRUCTIONS' }, order)).toEqual({
      type: 'GOTO',
      path: '/store/order/ord1'
    })
    expect(afterCheckout(null, order)).toEqual({ type: 'GOTO', path: '/store/order/ord1' })
    expect(orderPagePath('../x')).toBe('/store')
  })
})

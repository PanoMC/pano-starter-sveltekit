import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GET, POST, DELETE } from '../../src/routes/pano/[...path]/+server.js'
import { MAX_BODY_BYTES, checkPath } from '../../src/lib/store/proxy.server.js'
import { SESSION_COOKIE } from '../../src/lib/server/pano.js'
import { makeEvent } from '../helpers.js'
import { startMarketStub } from './stub.js'

let stub

beforeAll(() => {
  stub = startMarketStub()
})
afterAll(() => stub.stop())

beforeEach(() => {
  stub.clear()
  process.env.API_URL = `${stub.url}/api`
  delete process.env.PANO_API_URL
  delete process.env.PANO_FRONTEND_KEY
  delete process.env.PANO_SITE_URL
})

const SITE = 'http://site.test'

/** An event for `/pano/<path>` with a real request body and headers. */
function proxyEvent(path, { method = 'GET', headers = {}, body, cookies = {}, peer, search = '' } = {}) {
  const event = makeEvent({ url: `${SITE}/pano/${path}${search}`, params: { path }, cookies, peer })
  event.request = new Request(event.url, { method, headers, body })
  // SvelteKit's fetch adds the visitor's Cookie and Authorization for a Pano on the same host name.
  event.fetch = () => {
    throw new Error('the proxy must not use event.fetch')
  }
  return event
}

describe('path allow-list', () => {
  test('api/v1 paths pass', () => {
    expect(checkPath('api/v1/posts').ok).toBe(true)
    expect(checkPath('api/plugins/pano-plugin-market/store/products').ok).toBe(true)
    expect(checkPath('api/v1/widgets/loader.js').ok).toBe(true)
  })

  test('the panel API is refused, in any spelling', () => {
    for (const path of ['api/v1/panel', 'api/v1/panel/basicData', 'api/v1/PANEL/x', 'api/v1/Panel']) {
      const checked = checkPath(path)
      expect(checked).toMatchObject({ ok: false, status: 403 })
    }
  })

  test('sign-in endpoints are refused (the session token must not reach browser JS)', () => {
    expect(checkPath('api/v1/auth/login')).toMatchObject({ ok: false, status: 403 })
    expect(checkPath('api/v1/auth/register')).toMatchObject({ ok: false, status: 403 })
  })

  test('anything outside api/v1 is not found', () => {
    for (const path of [
      '',
      'api',
      'api/v1',
      'api/v2/posts',
      'foo/api/v1/posts',
      'setup/x',
      'api/market/store'
    ]) {
      expect(checkPath(path)).toMatchObject({ ok: false, status: 404 })
    }
  })

  test('dot segments, empty segments and backslashes do not walk around the prefix', () => {
    for (const path of [
      'api/v1/../v1/panel/x',
      'api/v1/./panel',
      'api/v1//panel',
      'api/v1/a\\..\\panel',
      'api/v1/x/',
      'api/v1/a\u0000b'
    ]) {
      expect(checkPath(path).ok).toBe(false)
    }
  })

  test('the handler refuses a panel path without calling Pano', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_test'
    const response = await GET(proxyEvent('api/v1/panel/basicData'))

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('PATH_NOT_PROXIED')
    expect(stub.requests).toHaveLength(0)
  })

  test('the handler answers 404 outside api/v1 without calling Pano', async () => {
    const response = await GET(proxyEvent('admin/secret'))

    expect(response.status).toBe(404)
    expect(stub.requests).toHaveLength(0)
  })
})

describe('what is forwarded', () => {
  test('key, visitor IP and session token are added; Cookie, Authorization and Origin are not forwarded', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_test'

    const response = await GET(
      proxyEvent('api/v1/ping', {
        headers: {
          cookie: 'pano_session=tok-abc; other=1',
          authorization: 'Bearer attacker',
          'x-pano-frontend-key': 'pfk_attacker',
          'x-pano-client-ip': '6.6.6.6',
          origin: SITE,
          'accept-language': 'tr',
          'x-forwarded-for': '203.0.113.9'
        },
        cookies: { [SESSION_COOKIE]: 'tok-abc' },
        peer: '127.0.0.1'
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pong: true })

    const seen = stub.requests[0]
    expect(seen.path).toBe('/api/v1/ping')
    expect(seen.headers['x-pano-frontend-key']).toBe('pfk_test')
    expect(seen.headers['x-pano-client-ip']).toBe('203.0.113.9')
    expect(seen.headers.authorization).toBe('Bearer tok-abc')
    expect(seen.headers['accept-language']).toBe('tr')
    expect(seen.headers.cookie).toBeUndefined()
    expect(seen.headers.origin).toBeUndefined()
  })

  test('a browser-sent Authorization is dropped even when the visitor has no session', async () => {
    await GET(proxyEvent('api/v1/ping', { headers: { authorization: 'Bearer attacker' } }))

    expect(stub.requests[0].headers.authorization).toBeUndefined()
  })

  test('without a key neither key header is sent', async () => {
    await GET(proxyEvent('api/v1/ping', { headers: { 'x-forwarded-for': '203.0.113.9' }, peer: '127.0.0.1' }))

    expect(stub.requests[0].headers['x-pano-frontend-key']).toBeUndefined()
    expect(stub.requests[0].headers['x-pano-client-ip']).toBeUndefined()
  })

  test('Set-Cookie and unknown headers are stripped from the answer; the status and body pass', async () => {
    const response = await GET(proxyEvent('api/v1/ping'))

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-internal')).toBeNull()
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
  })

  test('the query string and the status of an error pass through', async () => {
    const found = await GET(
      proxyEvent('api/plugins/pano-plugin-market/store/products', { search: '?category=2&page=1' })
    )
    expect(found.status).toBe(200)
    expect(stub.requests[0].path).toBe('/api/plugins/pano-plugin-market/store/products?category=2&page=1')
    expect((await found.json()).items.map((p) => p.slug)).toEqual(['coins'])

    const missing = await GET(proxyEvent('api/plugins/pano-plugin-market/products/nope'))
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe('PRODUCT_NOT_FOUND')
  })

  test('the order access token header is forwarded', async () => {
    stub.state.orders.k1 = { publicId: 'ordx', token: 'secret-token', quote: { total: 1, lines: [] } }
    const response = await GET(
      proxyEvent('api/plugins/pano-plugin-market/orders/ordx', {
        headers: { 'x-order-token': 'secret-token' }
      })
    )

    expect((await response.json()).order.limited).toBe(false)
    delete stub.state.orders.k1
  })

  test('a redirect of Pano (avatar to the image host) is passed on with its Location and no body, not followed', async () => {
    const response = await GET(proxyEvent('api/v1/redirect'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://evil.test/')
    expect(await response.text()).toBe('')
    expect(stub.requests).toHaveLength(1)
  })

  test('an unreachable Pano gives 502 with the error envelope', async () => {
    process.env.API_URL = 'http://127.0.0.1:1/api'
    const response = await GET(proxyEvent('api/v1/ping'))

    expect(response.status).toBe(502)
    expect((await response.json()).error.code).toBe('BAD_GATEWAY')
  })
})

describe('origin check', () => {
  const body = JSON.stringify({ items: [{ productId: 11, quantity: 1 }] })
  const post = (headers, extra = {}) =>
    POST(
      proxyEvent('api/plugins/pano-plugin-market/checkout/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
        ...extra
      })
    )

  test('a POST without Origin is refused and never reaches Pano', async () => {
    const response = await post({})

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('ORIGIN_MISMATCH')
    expect(stub.requests).toHaveLength(0)
  })

  test('a POST from another origin is refused', async () => {
    for (const origin of ['https://evil.test', 'null', 'http://site.test.evil.test', 'https://site.test']) {
      const response = await post({ origin })
      expect(response.status).toBe(403)
    }
    expect(stub.requests).toHaveLength(0)
  })

  test('a POST from the site itself is forwarded with its body and Idempotency-Key', async () => {
    const response = await post({ origin: SITE, 'idempotency-key': 'abc-123' })

    expect(response.status).toBe(200)
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0].method).toBe('POST')
    expect(stub.requests[0].body).toEqual({ items: [{ productId: 11, quantity: 1 }] })
    expect(stub.requests[0].headers['idempotency-key']).toBe('abc-123')
    expect(stub.requests[0].headers['content-type']).toBe('application/json')
  })

  test('the configured site address counts as the site too', async () => {
    process.env.PANO_SITE_URL = 'https://shop.example.com/'

    expect((await post({ origin: 'https://shop.example.com' })).status).toBe(200)
    expect((await post({ origin: 'https://other.example.com' })).status).toBe(403)
  })

  test('DELETE needs the origin as well; GET does not', async () => {
    const del = await DELETE(proxyEvent('api/plugins/pano-plugin-market/cart', { method: 'DELETE' }))
    expect(del.status).toBe(403)

    const read = await GET(proxyEvent('api/v1/ping'))
    expect(read.status).toBe(200)
  })
})

describe('body limit', () => {
  const upload = (size, headers = {}) =>
    POST(
      proxyEvent('api/plugins/pano-plugin-market/checkout/quote', {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/octet-stream', ...headers },
        body: new Uint8Array(size)
      })
    )

  test('5 MB exactly is forwarded, one byte more is refused with 413', async () => {
    expect(MAX_BODY_BYTES).toBe(5 * 1024 * 1024)

    const refused = await upload(MAX_BODY_BYTES + 1)
    expect(refused.status).toBe(413)
    expect((await refused.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(stub.requests).toHaveLength(0)

    const allowed = await upload(MAX_BODY_BYTES)
    expect(allowed.status).not.toBe(413)
    expect(stub.requests).toHaveLength(1)
  })

  test('a declared Content-Length over the limit is refused before the body is read', async () => {
    const response = await upload(10, { 'content-length': String(MAX_BODY_BYTES + 1) })

    expect(response.status).toBe(413)
    expect(stub.requests).toHaveLength(0)
  })
})

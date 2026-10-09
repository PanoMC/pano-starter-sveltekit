// A Bun.serve stand-in for Pano with the market plugin's site API. Records every request it gets.
const PLUGIN = '/api/plugins/pano-plugin-market'

export const PRODUCTS = [
  {
    id: 11,
    slug: 'vip-rank',
    name: 'VIP Rank',
    shortDescription: 'Fly and colours',
    categoryId: 1,
    kind: 'STANDARD',
    price: 9.99,
    compareAtPrice: 14.99,
    currency: 'USD',
    inStock: true,
    imageFileName: 'vip.png',
    hasVariants: false,
    featured: true
  },
  {
    id: 12,
    slug: 'coins',
    name: 'Coin pack',
    shortDescription: null,
    categoryId: 2,
    kind: 'STANDARD',
    price: 4.5,
    currency: 'USD',
    inStock: false,
    imageFileName: null,
    hasVariants: false,
    featured: false
  }
]

const SETTINGS = {
  storeName: 'Block Shop',
  storeDescription: 'Ranks and coins',
  currency: 'USD',
  allowGuestCheckout: true
}
const CATEGORIES = [
  { id: 1, name: 'Ranks', parentId: null, productCount: 1, children: [] },
  { id: 2, name: 'Currency', parentId: null, productCount: 1, children: [] }
]

const page = (items) => ({ number: 1, size: 24, totalItems: items.length, totalPages: 1 })

/**
 * @param {{ market?: boolean }} [options] market: false = a Pano without the market plugin
 */
export function startMarketStub({ market = true } = {}) {
  /** @type {{ method: string, path: string, headers: Record<string, string>, body: any }[]} */
  const requests = []
  const state = {
    market,
    /** orders created by POST /checkout, by idempotency key */
    orders: /** @type {Record<string, any>} */ ({}),
    /** answer of the next POST /checkout, instead of creating an order */
    checkoutError: /** @type {{ status: number, code: string, details?: object } | null} */ (null),
    /** the server-side cart of a signed-in buyer */
    cart: /** @type {any[]} */ ([])
  }

  const json = (status, body, headers = {}) => Response.json(body, { status, headers })
  const error = (status, code, details) => json(status, { error: { code, ...(details ? { details } : {}) } })

  const quoteFor = (items, paymentMethodId) => {
    const lines = items.map((item) => {
      const product = PRODUCTS.find((p) => p.id === item.productId)
      return {
        productId: item.productId,
        variantId: item.variantId ?? 0,
        fieldValues: item.fieldValues ?? {},
        targetServerId: item.targetServerId ?? null,
        name: product?.name ?? 'Unknown',
        variantName: null,
        quantity: item.quantity,
        unitPrice: product?.price ?? 0,
        lineTotal: Math.round((product?.price ?? 0) * item.quantity * 100) / 100,
        kind: 'PRODUCT',
        errors: []
      }
    })
    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100
    const fee = paymentMethodId === 'card' ? 0.3 : 0

    return {
      currency: 'USD',
      lines,
      subtotal,
      discountTotal: 0,
      paymentFee: fee,
      total: Math.round((subtotal + fee) * 100) / 100,
      requiresShipping: false,
      requiredBuyerFields: [],
      paymentMethods: [
        { id: 'card', label: 'Card', feeAmount: 0.3, available: true },
        { id: 'bank', label: 'Bank transfer', feeAmount: 0, available: true },
        { id: 'broken', label: 'Broken gateway', feeAmount: 0, available: false }
      ],
      legal: null,
      messages: [],
      canCheckout: lines.length > 0
    }
  }

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }

      const headers = Object.fromEntries(request.headers)
      requests.push({ method: request.method, path: url.pathname + url.search, headers, body })

      const key = headers['x-pano-frontend-key']
      if (key && key !== 'pfk_test') return error(401, 'INVALID_FRONTEND_KEY')

      const path = url.pathname
      const bearer = headers.authorization?.replace(/^Bearer /, '')
      const get = request.method === 'GET'

      if (get && path === '/api/v1/plugin-packages') {
        return json(200, { plugins: state.market ? { 'pano-plugin-market': { namespace: 'market' } } : {} })
      }

      if (get && path === '/api/v1/auth/credentials') {
        if (!bearer?.startsWith('tok-')) return error(401, 'NOT_LOGGED_IN')
        return json(200, {
          username: 'steve',
          email: 's@x.test',
          panelAccess: false,
          permissions: [],
          admin: false
        })
      }

      if (get && path === '/api/v1/ping') {
        return json(
          200,
          { pong: true },
          { 'set-cookie': 'upstream=1; Path=/', 'x-internal': 'secret', 'cache-control': 'no-store' }
        )
      }

      if (get && path === '/api/v1/redirect') {
        return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } })
      }

      if (!path.startsWith(PLUGIN) || !state.market) return error(404, 'NOT_FOUND')

      const rest = path.slice(PLUGIN.length)

      if (get && rest === '/store') {
        return json(200, {
          items: PRODUCTS,
          page: page(PRODUCTS),
          settings: SETTINGS,
          categories: CATEGORIES,
          featured: PRODUCTS.filter((p) => p.featured),
          bestsellers: [],
          comparisons: [],
          comparisonProducts: []
        })
      }

      if (get && rest === '/store/products') {
        const category = Number(url.searchParams.get('category') || 0)
        const search = (url.searchParams.get('search') || '').toLowerCase()
        const items = PRODUCTS.filter(
          (p) =>
            (!category || p.categoryId === category) && (!search || p.name.toLowerCase().includes(search))
        )
        return json(200, { items, page: page(items) })
      }

      if (get && rest.startsWith('/products/') && !rest.startsWith('/products/image/')) {
        const product = PRODUCTS.find((p) => p.slug === decodeURIComponent(rest.slice('/products/'.length)))
        if (!product) return error(404, 'PRODUCT_NOT_FOUND')
        return json(200, {
          product: {
            ...product,
            description: '<p>Be <b>very</b> important</p>',
            categoryName: 'Ranks',
            variants: [],
            fields: [],
            purchasable: { ok: true, reason: null }
          }
        })
      }

      if (get && rest === '/checkout/config') {
        return json(200, {
          guestCheckout: true,
          giftPurchase: false,
          creditsEnabled: false,
          currencies: ['USD'],
          legal: null
        })
      }

      if (request.method === 'POST' && rest === '/checkout/quote') {
        const items = body?.items ?? state.cart
        return json(200, { quote: quoteFor(items, body?.paymentMethodId) })
      }

      if (request.method === 'POST' && rest === '/checkout') {
        if (state.checkoutError)
          return error(state.checkoutError.status, state.checkoutError.code, state.checkoutError.details)
        const idem = headers['idempotency-key']
        if (!idem) return error(400, 'IDEMPOTENCY_KEY_REQUIRED')
        const quote = quoteFor(body?.items ?? state.cart, body?.paymentMethodId)
        if (Math.abs(quote.total - body.expectedTotal) > 0.001) return error(409, 'QUOTE_CHANGED')

        state.orders[idem] ??= {
          publicId: `ord${Object.keys(state.orders).length + 1}`,
          token: `token-${Object.keys(state.orders).length + 1}`,
          quote
        }
        const made = state.orders[idem]
        return json(200, {
          order: { publicId: made.publicId, status: 'PENDING' },
          orderToken: made.token,
          payment: { kind: 'REDIRECT', url: 'https://pay.example/checkout/abc' }
        })
      }

      if (get && rest === '/me/cart') {
        if (!bearer) return error(401, 'NOT_LOGGED_IN')
        return json(200, {
          cart: { items: state.cart },
          quote: state.cart.length ? quoteFor(state.cart) : null
        })
      }

      if (request.method === 'POST' && rest === '/me/cart/items') {
        if (!bearer) return error(401, 'NOT_LOGGED_IN')
        state.cart.push({ itemId: state.cart.length + 1, ...body })
        return json(200, { cart: { items: state.cart }, quote: quoteFor(state.cart) })
      }

      if (get && rest.startsWith('/orders/')) {
        const publicId = rest.slice('/orders/'.length)
        const made = Object.values(state.orders).find((o) => o.publicId === publicId)
        if (!made) return error(404, 'ORDER_NOT_FOUND')
        const owner = headers['x-order-token'] === made.token || bearer?.startsWith('tok-')
        return json(200, {
          order: owner
            ? {
                publicId,
                number: 7,
                status: 'COMPLETED',
                limited: false,
                currency: 'USD',
                totals: { total: made.quote.total },
                items: made.quote.lines.map((l, i) => ({
                  id: i + 1,
                  name: l.name,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  lineTotal: l.lineTotal
                }))
              }
            : { publicId, status: 'PENDING', limited: true, currency: 'USD' }
        })
      }

      return error(404, 'NOT_FOUND')
    }
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    state,
    clear: () => (requests.length = 0),
    stop: () => server.stop(true)
  }
}

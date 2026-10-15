// Small presentation helpers for the store pages. Pure; amounts are the decimal numbers market sends (19.99).

/** @param {number|null|undefined} amount @param {string|null|undefined} currency ISO code */
export function money(amount, currency) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return ''

  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD' }).format(
      Number(amount)
    )
  } catch {
    // an unknown currency code
    return `${Number(amount).toFixed(2)} ${currency ?? ''}`.trim()
  }
}

/** Where a product image is served: Pano's file endpoint, through the proxy. @param {string|null|undefined} fileName */
export function imageUrl(fileName) {
  return fileName ? `/pano/api/plugins/pano-plugin-market/products/image/${encodeURIComponent(fileName)}` : ''
}

/** `/store?...` with the filter in the query. Empty values are left out. @param {Record<string, string|number|null|undefined>} query */
export function storeUrl(query = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `/store?${text}` : '/store'
}

/** Category tree -> flat list with depth, for a simple list. @param {{ id: number, name: string, productCount?: number, children?: any[] }[]} tree */
export function flattenCategories(tree, depth = 0) {
  /** @type {{ id: number, name: string, depth: number, productCount?: number }[]} */
  const out = []
  for (const category of tree ?? []) {
    out.push({ id: category.id, name: category.name, depth, productCount: category.productCount })
    out.push(...flattenCategories(category.children ?? [], depth + 1))
  }
  return out
}

/** Text of an order status for a visitor. @param {string|undefined} status */
export function orderStatusText(status) {
  /** @type {Record<string, string>} */
  const texts = {
    PENDING: 'Waiting for payment',
    REVIEW: 'Payment is being reviewed',
    COMPLETED: 'Paid',
    PARTIALLY_REFUNDED: 'Partly refunded',
    REFUNDED: 'Refunded',
    CHARGEBACK: 'Charged back',
    FAILED: 'Payment failed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired'
  }
  return (status && texts[status]) || status || ''
}

/** Error code of the market -> a sentence a buyer can act on. @param {string|undefined} code @param {string} [fallback] */
export function checkoutMessage(code, fallback = 'The checkout could not be completed. Try again.') {
  /** @type {Record<string, string>} */
  const texts = {
    NETWORK: 'Pano did not answer. Try again in a moment.',
    STORE_DISABLED: 'The store is closed right now.',
    GUEST_CHECKOUT_DISABLED: 'Sign in to check out.',
    EMAIL_REQUIRED: 'Enter your email address.',
    LEGAL_NOT_ACCEPTED: 'Accept the terms to continue.',
    QUOTE_CHANGED: 'The price changed. Check the total and try again.',
    STALE_QUOTE: 'The price changed. Check the total and try again.',
    EMPTY_CART: 'Your cart is empty.',
    PAYMENT_METHOD_REQUIRED: 'Choose a payment method.',
    PAYMENT_PROVIDER_ERROR:
      'The payment provider did not answer. Your order was created; open it to pay again.',
    TOO_MANY_REQUESTS: 'Too many tries. Wait a moment and try again.'
  }
  return (code && texts[code]) || fallback
}

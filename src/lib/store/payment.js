// What the browser does after the checkout said yes. Pure: the page performs the navigation this returns.
// Nothing here trusts a URL blindly: a redirect target is http(s) only, and the payment attempt page must be the
// market's own (it is served through /pano, same origin).

/** Where the market serves the page that posts the buyer to a gateway (kinds FORM_POST and HTML). */
export const ATTEMPT_PREFIX = '/api/plugins/pano-plugin-market/payments/attempts/'

/** sessionStorage key prefix of an order's access token, the same one market's own pages use. */
export const ORDER_TOKEN_PREFIX = 'pano-plugin-market-order:'

const PUBLIC_ID = /^[A-Za-z0-9_-]{1,64}$/

/** `/store/order/<id>`, or `/store` when the id is not a plain id. @param {unknown} publicId */
export function orderPagePath(publicId) {
  return typeof publicId === 'string' && PUBLIC_ID.test(publicId) ? `/store/order/${publicId}` : '/store'
}

/** @param {unknown} value */
function isSafeExternalUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) return false
  if (/[\u0000- \u007f]/.test(value) || !/^https?:\/\//i.test(value)) return false

  try {
    return new URL(value).hostname !== ''
  } catch {
    return false
  }
}

/**
 * `{ type: 'ASSIGN', url }` (leave the page) or `{ type: 'GOTO', path }` (the order page, which shows the state).
 * @param {{ kind?: string, url?: string }|null|undefined} payment `payment` of the checkout answer
 * @param {{ publicId?: string }|null|undefined} order
 * @returns {{ type: 'ASSIGN', url: string } | { type: 'GOTO', path: string }}
 */
export function afterCheckout(payment, order) {
  const orderPage = /** @type {const} */ ({ type: 'GOTO', path: orderPagePath(order?.publicId) })
  const kind = payment?.kind

  if (kind === 'REDIRECT') {
    return isSafeExternalUrl(payment?.url)
      ? { type: 'ASSIGN', url: /** @type {string} */ (payment?.url) }
      : orderPage
  }

  if (kind === 'FORM_POST' || kind === 'HTML') {
    const value = payment?.url
    if (typeof value !== 'string' || /[\u0000- \u007f\\]/.test(value)) return orderPage

    try {
      const url = new URL(value, 'http://pano.invalid')
      // Absolute or relative, only the market's attempt page: served to the browser through the proxy.
      if (url.pathname.startsWith(ATTEMPT_PREFIX) && url.pathname.length > ATTEMPT_PREFIX.length) {
        return { type: 'ASSIGN', url: `/pano${url.pathname}${url.search}` }
      }
    } catch {
      // fall through to the order page
    }
  }

  return orderPage
}

/** Remember the order's access token for this tab (a guest's only way back into their order). */
export function saveOrderToken(
  /** @type {Storage|null|undefined} */ storage,
  /** @type {string} */ publicId,
  /** @type {unknown} */ token
) {
  if (!storage || !PUBLIC_ID.test(publicId) || typeof token !== 'string' || !token) return false

  try {
    storage.setItem(`${ORDER_TOKEN_PREFIX}${publicId}`, token)
    return true
  } catch {
    return false
  }
}

/** @param {Storage|null|undefined} storage @param {string} publicId */
export function readOrderToken(storage, publicId) {
  try {
    return storage?.getItem(`${ORDER_TOKEN_PREFIX}${publicId}`) || null
  } catch {
    return null
  }
}

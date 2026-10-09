// Pure helpers over market's cart state and quote (what `market/cart` holds), for the store pages.

const isBlank = (/** @type {any} */ value) => value === '' || value === null || value === undefined

/** Same identity market's cart gives a line: `productId|variantId|fieldValues|targetServerId`. @param {any} line */
export function lineKey(line) {
  const l = line || {}
  /** @type {Record<string, any>} */
  const fields = {}
  const source = l.fieldValues && typeof l.fieldValues === 'object' ? l.fieldValues : {}
  for (const key of Object.keys(source).sort()) if (!isBlank(source[key])) fields[key] = source[key]

  return `${l.productId}|${l.variantId || 0}|${JSON.stringify(fields)}|${l.targetServerId || ''}`
}

/**
 * The lines to show: each cart line with the price and name the quote gave it (when a quote exists), else the
 * display data the cart kept when the item was added.
 * @param {any} cart the `market/cart` state
 */
export function displayLines(cart) {
  const quoteLines = /** @type {any[]} */ (cart?.quote?.lines ?? []).filter((l) => l.kind !== 'BUNDLE_CHILD')
  const byKey = new Map(quoteLines.map((l) => [lineKey(l), l]))

  return /** @type {any[]} */ (cart?.lines ?? []).map((line) => {
    const quoted = byKey.get(lineKey(line))
    return {
      key: lineKey(line),
      productId: line.productId,
      quantity: line.quantity,
      name: quoted?.name ?? line.meta?.name ?? `Product ${line.productId}`,
      variantName: quoted?.variantName ?? line.meta?.variantName ?? '',
      unitPrice: quoted?.unitPrice ?? line.meta?.price ?? null,
      lineTotal: quoted?.lineTotal ?? null,
      maxQuantity: quoted?.maxQuantity ?? null,
      errors: /** @type {string[]} */ (quoted?.errors ?? [])
    }
  })
}

/** The part of a cart line the quote request needs (no display data, no local keys). @param {any} line */
export function toWire(line) {
  /** @type {Record<string, any>} */
  const out = { productId: line.productId, quantity: line.quantity }
  if (line.variantId) out.variantId = line.variantId
  if (line.fieldValues && Object.keys(line.fieldValues).length) out.fieldValues = { ...line.fieldValues }
  if (line.targetServerId) out.targetServerId = line.targetServerId
  return out
}

/**
 * Body of `POST /checkout/quote` (and, plus `expectedTotal`, of `POST /checkout`).
 * A signed-in buyer's lines are on the server; a guest sends them.
 * @param {{ user: any, lines: any[], email?: string, paymentMethodId?: string|null, locale?: string }} input
 */
export function quoteBody({ user, lines, email, paymentMethodId, locale }) {
  /** @type {Record<string, any>} */
  const body = {}
  if (!user) {
    body.items = lines.map(toWire)
    if (email) body.guest = { email }
  }
  if (paymentMethodId) body.paymentMethodId = paymentMethodId
  if (locale) body.locale = locale
  return body
}

/** Item count shown on the cart link. @param {any} cart */
export function countOf(cart) {
  return Number(cart?.count) > 0 ? Number(cart.count) : 0
}

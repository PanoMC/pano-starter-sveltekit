// The checkout calls, without the page: ask for a quote, place the order. Browser side, over market's controllers.
import { quoteBody } from './cart.js'
import { checkoutMessage } from './format.js'
import { afterCheckout, saveOrderToken } from './payment.js'

/** Failures where the same body may be sent again with the same Idempotency-Key (nothing was decided yet). */
const KEEP_KEY = new Set(['NETWORK', 'STORE_BUSY', 'TOO_MANY_REQUESTS'])

/** @typedef {{ body: string|null, key: string|null }} IdempotencyState */

/**
 * @typedef {Object} CheckoutInput
 * @property {{ username: string } | null} user
 * @property {any[]} lines the cart lines (`market/cart` state)
 * @property {string} [email] a guest's email
 * @property {string|null} [methodId] the chosen payment method
 * @property {string} [locale]
 */

/**
 * `POST /checkout/quote`: what this cart would cost, which payment methods are on offer, whether it can be paid.
 * @param {ReturnType<import('./market.js').getMarket>} market
 * @param {CheckoutInput} input
 * @returns {Promise<{ ok: true, quote: any } | { ok: false, code: string, message: string }>}
 */
export async function requestQuote(market, input) {
  const result = await market.api.actions.post('/checkout/quote', {
    body: quoteBody({ ...input, paymentMethodId: input.methodId })
  })

  if (result.ok && result.quote) return { ok: true, quote: result.quote }

  const code = result.code ?? 'GENERIC'
  return { ok: false, code, message: checkoutMessage(code, 'The total could not be worked out. Try again.') }
}

/**
 * `POST /checkout`: place the order for the quote the buyer is looking at (`expectedTotal`), then clear the cart,
 * remember the order token and say where to go (a gateway page, or the order page).
 * The same body replays with the same Idempotency-Key, so a lost answer cannot create two orders.
 * @param {ReturnType<import('./market.js').getMarket>} market
 * @param {CheckoutInput & { quote: any, legal?: { required?: boolean, id?: number }|null, accepted?: boolean }} input
 * @param {IdempotencyState} idempotency kept by the page between attempts
 * @returns {Promise<{ ok: true, to: string } | { ok: false, code: string, message: string, requote: boolean }>}
 */
export async function placeOrder(market, input, idempotency) {
  const body = {
    ...quoteBody({ ...input, paymentMethodId: input.methodId }),
    expectedTotal: input.quote.total,
    ...(input.legal?.required ? { acceptLegal: input.accepted === true, legalTextId: input.legal.id } : {})
  }

  const text = JSON.stringify(body)
  if (text !== idempotency.body || !idempotency.key) {
    idempotency.body = text
    idempotency.key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  }

  const result = await market.api.actions.post('/checkout', {
    body,
    headers: { 'Idempotency-Key': idempotency.key }
  })

  // PAYMENT_PROVIDER_ERROR still created the order: it can be paid again from its page.
  const created = result.ok || (result.code === 'PAYMENT_PROVIDER_ERROR' && result.order?.publicId)

  if (created) {
    saveOrderToken(market.host.storage('session'), result.order.publicId, result.orderToken)
    market.cart.actions.afterCheckout()
    const next = afterCheckout(result.ok ? result.payment : null, result.order)

    return { ok: true, to: next.type === 'ASSIGN' ? next.url : next.path }
  }

  const code = result.code ?? 'GENERIC'
  if (!KEEP_KEY.has(code)) idempotency.key = null

  return {
    ok: false,
    code,
    message: checkoutMessage(code),
    requote: code === 'QUOTE_CHANGED' || code === 'STALE_QUOTE'
  }
}

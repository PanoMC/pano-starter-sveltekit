<script>
  import { onMount } from 'svelte'
  import { displayLines } from './cart.js'
  import { placeOrder, requestQuote } from './checkout.js'
  import { checkoutMessage, money } from './format.js'
  import { getMarket } from './market.js'

  /** @type {{ config: import('#lib/pano/plugins/market/types.js').GetCheckoutConfigResponse, user: { username: string } | null }} */
  let { config, user } = $props()

  /** @type {any} */
  let cart = $state(null)
  /** @type {any} */
  let quote = $state(null)
  let ready = $state(false)
  let quoting = $state(false)
  let submitting = $state(false)
  let email = $state('')
  /** @type {string|null} */
  let chosenMethod = $state(null)
  let accepted = $state(false)
  /** @type {string|null} */
  let message = $state(null)

  /** @type {ReturnType<typeof getMarket> | null} */
  let market = null
  let quoteSeq = 0
  /** Kept between attempts so the same order is never created twice. */
  /** @type {import('./checkout.js').IdempotencyState} */
  const idempotency = { body: null, key: null }

  const lines = $derived(displayLines(cart))
  const methods = $derived(/** @type {any[]} */ (quote?.paymentMethods ?? []))
  const available = $derived(methods.filter((m) => m.available))
  // The buyer's choice if it can still be used, else the first method on offer.
  const methodId = $derived(
    chosenMethod && available.some((m) => m.id === chosenMethod) ? chosenMethod : (available[0]?.id ?? null)
  )
  const legal = $derived(quote?.legal ?? config.legal ?? null)
  const guest = $derived(!user)
  const needsEmail = $derived(guest && !/^\S+@\S+$/.test(email.trim()))
  const needsMore = $derived(
    Boolean(quote?.requiresShipping) || (quote?.requiredBuyerFields ?? []).length > 0
  )
  const canPay = $derived(
    ready &&
      !submitting &&
      !quoting &&
      Boolean(quote?.canCheckout) &&
      !needsMore &&
      !needsEmail &&
      methodId !== null &&
      (!legal?.required || accepted)
  )
  const signInNeeded = $derived(guest && config.guestCheckout === false)

  /** What a quote or an order is made from. */
  function input() {
    return {
      user,
      lines: cart?.lines ?? [],
      email: guest && !needsEmail ? email.trim() : '',
      methodId,
      locale: globalThis.document?.documentElement?.lang || undefined
    }
  }

  onMount(() => {
    market = getMarket(user)
    const off = market.cart.subscribe((state) => (cart = state))
    market.cart.actions.init().then(() => (ready = true))

    return off
  })

  // Ask for a quote whenever the lines, the email or the payment method change.
  $effect(() => {
    if (!ready || !market || !cart || cart.mode === 'NONE' || cart.status === 'LOADING') return

    if (cart.lines.length === 0) {
      quote = null
      return
    }

    // Read here so the effect reruns when they change.
    void [cart.lines, email, methodId]
    const timer = setTimeout(requote, 300)

    return () => clearTimeout(timer)
  })

  async function requote() {
    if (!market) return
    const seq = ++quoteSeq
    quoting = true

    const result = await requestQuote(market, input())

    if (seq !== quoteSeq) return
    quoting = false

    if (result.ok) {
      quote = result.quote
      message = null
    } else {
      quote = null
      message = result.message
    }
  }

  async function submit() {
    if (!market || !canPay || !quote) return
    submitting = true
    message = null

    try {
      const result = await placeOrder(market, { ...input(), quote, legal, accepted }, idempotency)

      if (result.ok) {
        market.host.navigate(result.to)
        return
      }

      message = result.message
      if (result.requote) await requote()
    } finally {
      submitting = false
    }
  }

  /** @param {string} key @param {Event} event */
  function setQuantity(key, event) {
    const value = Number(/** @type {HTMLInputElement} */ (event.currentTarget).value)
    market?.cart.actions.setQuantity(key, value)
  }
</script>

<svelte:head>
  <title>Checkout</title>
</svelte:head>

<h1>Checkout</h1>

{#if signInNeeded}
  <p class="note">
    This store needs an account to check out. <a href="/login?next=/store/checkout">Log in</a> or
    <a href="/register">register</a>.
  </p>
{:else if ready && lines.length === 0}
  <p class="note">Your cart is empty. <a href="/store">Browse the store</a></p>
{:else}
  <ul class="lines">
    {#each lines as line (line.key)}
      <li>
        <div class="what">
          <strong>{line.name}</strong>
          {#if line.variantName}<span class="muted">{line.variantName}</span>{/if}
          {#each line.errors as code (code)}<span class="problem">{checkoutMessage(code, code)}</span>{/each}
        </div>
        <input
          type="number"
          min="0"
          max={line.maxQuantity ?? 99}
          value={line.quantity}
          aria-label="Quantity of {line.name}"
          onchange={(event) => setQuantity(line.key, event)}
        />
        <span class="amount">{line.lineTotal !== null ? money(line.lineTotal, quote?.currency) : ''}</span>
        <button type="button" class="plain" onclick={() => market?.cart.actions.remove(line.key)}
          >Remove</button
        >
      </li>
    {/each}
  </ul>

  {#if guest}
    <label>
      <span>Email address</span>
      <input type="email" autocomplete="email" bind:value={email} placeholder="you@example.com" />
    </label>
  {/if}

  {#if methods.length}
    <fieldset>
      <legend>Payment</legend>
      {#each methods as method (method.id)}
        <label class="method">
          <input
            type="radio"
            name="payment"
            value={method.id}
            checked={methodId === method.id}
            disabled={!method.available}
            onchange={() => (chosenMethod = method.id)}
          />
          {method.label}
          {#if method.feeAmount > 0}<span class="muted">(+{money(method.feeAmount, quote?.currency)})</span
            >{/if}
          {#if !method.available}<span class="muted">not available</span>{/if}
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if quote}
    <dl class="totals">
      <dt>Subtotal</dt>
      <dd>{money(quote.subtotal, quote.currency)}</dd>
      {#if quote.discountTotal > 0}
        <dt>Discounts</dt>
        <dd>-{money(quote.discountTotal, quote.currency)}</dd>
      {/if}
      {#if quote.paymentFee > 0}
        <dt>Payment fee</dt>
        <dd>{money(quote.paymentFee, quote.currency)}</dd>
      {/if}
      <dt class="total">Total</dt>
      <dd class="total">{money(quote.total, quote.currency)}</dd>
    </dl>

    {#each quote.messages ?? [] as note (`${note.code}${note.lineKey ?? ''}`)}
      <p class="problem">{checkoutMessage(note.code, note.code)}</p>
    {/each}
  {/if}

  {#if needsMore}
    <p class="note">
      This cart needs details this checkout does not collect yet (a shipping address or more buyer details).
      Use a cart without those items.
    </p>
  {/if}

  {#if legal?.required}
    <label class="legal">
      <input type="checkbox" bind:checked={accepted} />
      I accept {legal.title || 'the terms'}
    </label>
  {/if}

  {#if message}<p class="problem" role="alert">{message}</p>{/if}

  <button type="button" class="pay" disabled={!canPay} onclick={submit}>
    {submitting ? 'Working...' : quote ? `Pay ${money(quote.total, quote.currency)}` : 'Pay'}
  </button>
{/if}

<style>
  .lines {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }

  li {
    display: grid;
    grid-template-columns: 1fr 5rem 6rem auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 0.5rem;
  }

  .what {
    display: flex;
    flex-direction: column;
  }

  .amount {
    text-align: right;
  }

  input[type='number'],
  input[type='email'] {
    font: inherit;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--card);
    color: inherit;
  }

  input[type='email'] {
    width: 100%;
  }

  label {
    display: block;
    margin: 1rem 0;
  }

  label span {
    display: block;
    font-size: 0.9rem;
    margin-bottom: 0.2rem;
  }

  fieldset {
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    margin: 1rem 0;
  }

  .method {
    margin: 0.4rem 0;
  }

  .method span,
  .muted,
  .note {
    display: inline;
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0;
  }

  .totals {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 1rem;
    margin: 1rem 0;
  }

  dt,
  dd {
    margin: 0;
  }

  dd {
    text-align: right;
  }

  .total {
    font-weight: 700;
  }

  .problem {
    color: var(--danger);
    font-size: 0.9rem;
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  .plain {
    background: none;
    border: 0;
    color: var(--accent);
    text-decoration: underline;
  }

  .pay {
    padding: 0.6rem 1.25rem;
    border: 0;
    border-radius: 0.4rem;
    background: var(--accent);
    color: #fff;
  }

  .pay:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

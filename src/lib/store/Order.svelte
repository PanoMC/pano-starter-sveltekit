<script>
  import { onMount } from 'svelte'
  import { money, orderStatusText } from './format.js'
  import { getMarket } from './market.js'
  import { afterCheckout, readOrderToken } from './payment.js'

  /** @type {{ order: import('$lib/pano/plugins/market/types.js').MarketOrder, user: { username: string } | null }} */
  let { order: initial, user } = $props()

  /** Statuses that still change by themselves (the payment is on its way). */
  const OPEN = new Set(['PENDING', 'REVIEW'])
  const POLL_MS = 5000
  const POLL_LIMIT = 60

  /** @type {import('$lib/pano/plugins/market/types.js').MarketOrder|null} */
  let fetched = $state(null)
  const order = $derived(fetched ?? initial)
  /** The documented line has no id and total yet; the answer carries both. */
  const items = $derived(/** @type {any[]} */ (order.items ?? []))
  const next = $derived(order.status === 'PENDING' ? afterCheckout(order.payment?.start, order) : null)

  onMount(() => {
    const market = getMarket(user)
    const id = initial.publicId
    // A mail link carries the token in the query; right after checkout it is in this tab's storage.
    const token =
      new URLSearchParams(globalThis.location?.search).get('token') ||
      readOrderToken(market.host.storage('session'), id)
    let polls = 0
    let stopped = false
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer

    async function refresh() {
      const result = await market.api.actions.call('GET', `/orders/${encodeURIComponent(id)}`, {
        headers: token ? { 'X-Order-Token': token } : undefined
      })
      if (stopped) return
      if (result.ok && result.order) fetched = result.order

      polls++
      const status = (result.ok && result.order ? result.order : (fetched ?? initial)).status
      if (OPEN.has(status) && polls < POLL_LIMIT) timer = setTimeout(refresh, POLL_MS)
    }

    // The server rendered the limited view; a holder of the token (or a polling pending order) asks again.
    if (token || OPEN.has(initial.status)) refresh()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  })
</script>

<svelte:head>
  <title>Order {order.number ?? order.publicId}</title>
</svelte:head>

<h1>Order {order.number ? `#${order.number}` : order.publicId}</h1>

<p class="status" role="status" data-status={order.status}>{orderStatusText(order.status)}</p>

{#if items.length}
  <ul class="items">
    {#each items as item (item.id)}
      <li>
        <span>{item.quantity} x {item.name}{item.variantName ? ` (${item.variantName})` : ''}</span>
        <span>{money(item.lineTotal, order.currency)}</span>
      </li>
    {/each}
  </ul>
{/if}

{#if order.totals}
  <p class="total">Total <strong>{money(order.totals.total, order.currency)}</strong></p>
{:else if order.limited}
  <p class="note">
    Open this page with the link from your email, or in the browser you ordered with, to see the details.
  </p>
{/if}

{#if next?.type === 'ASSIGN'}
  <p><a class="button" href={next.url}>Continue to payment</a></p>
{/if}

<p><a href="/store">Back to the store</a></p>

<style>
  .status {
    display: inline-block;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--card);
  }

  .items {
    list-style: none;
    padding: 0;
  }

  li {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
  }

  .note {
    color: var(--muted);
  }

  .button {
    display: inline-block;
    padding: 0.5rem 1rem;
    border-radius: 0.4rem;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
  }
</style>

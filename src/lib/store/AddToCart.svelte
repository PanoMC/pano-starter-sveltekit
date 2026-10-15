<script>
  import { onMount } from 'svelte'
  import { getMarket } from './market.js'

  /** @type {{ product: import('#lib/pano/plugins/market/types.js').MarketProductDetail, user: { username: string } | null }} */
  let { product, user } = $props()

  const variants = $derived(product.variants ?? [])
  const fields = $derived(product.fields ?? [])
  // The documented product has no per-order limit yet; the answer carries it.
  const maxQuantity = $derived(/** @type {any} */ (product).maxQuantityPerOrder ?? 99)
  const blocked = $derived(product.purchasable?.ok === false)

  /** @type {number|undefined} */
  let chosen = $state(undefined)
  // Until the buyer picks one, the first variant that can be bought.
  const variantId = $derived(chosen ?? variants.find((v) => v.inStock)?.id ?? variants[0]?.id ?? 0)
  let quantity = $state(1)
  /** @type {Record<string, string>} */
  let fieldValues = $state({})
  let busy = $state(false)
  let added = $state(false)
  /** @type {{ line: any, product: any } | null} */
  let replaceRequest = $state(null)

  onMount(() => getMarket(user).cart.subscribe((cart) => (replaceRequest = cart.replaceRequest)))

  async function add() {
    busy = true
    added = false

    try {
      const { cart } = getMarket(user)
      const variant = variants.find((v) => v.id === variantId)
      added = await cart.actions.add(
        {
          productId: product.id,
          variantId: variant?.id ?? 0,
          quantity,
          fieldValues: Object.fromEntries(Object.entries(fieldValues).filter(([, v]) => v !== ''))
        },
        { ...product, variantName: variant?.name ?? '' }
      )
    } finally {
      busy = false
    }
  }
</script>

<form
  onsubmit={(event) => {
    event.preventDefault()
    add()
  }}
>
  {#if variants.length}
    <label>
      <span>Option</span>
      <select value={variantId} onchange={(event) => (chosen = Number(event.currentTarget.value))}>
        {#each variants as variant (variant.id)}
          <option value={variant.id} disabled={!variant.inStock}>{variant.name}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#each fields as field (field.fieldKey)}
    <label>
      <span>{field.label}{field.required ? ' *' : ''}</span>
      <input
        name={field.fieldKey}
        required={field.required}
        placeholder={field.placeholder ?? ''}
        bind:value={fieldValues[field.fieldKey]}
      />
      {#if field.helpText}<small>{field.helpText}</small>{/if}
    </label>
  {/each}

  <label>
    <span>Quantity</span>
    <input type="number" min="1" max={maxQuantity} bind:value={quantity} />
  </label>

  <button type="submit" disabled={busy || blocked || !product.inStock}>
    {product.inStock ? 'Add to cart' : 'Out of stock'}
  </button>

  {#if blocked && product.purchasable?.reason}<p class="note">{product.purchasable.reason}</p>{/if}
  {#if added}<p class="note" role="status">Added. <a href="/store/checkout">Go to checkout</a></p>{/if}
</form>

{#if replaceRequest}
  <div class="replace" role="alertdialog" aria-label="Replace your cart">
    <p>This item cannot be bought together with what is in your cart. Replace the cart with it?</p>
    <button type="button" onclick={() => getMarket(user).cart.actions.confirmReplace()}>Replace cart</button>
    <button type="button" class="plain" onclick={() => getMarket(user).cart.actions.cancelReplace()}
      >Keep my cart</button
    >
  </div>
{/if}

<style>
  label {
    display: block;
    margin-bottom: 0.75rem;
  }

  label span {
    display: block;
    font-size: 0.9rem;
    margin-bottom: 0.2rem;
  }

  input,
  select {
    font: inherit;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--card);
    color: inherit;
  }

  button {
    font: inherit;
    padding: 0.5rem 1rem;
    border: 0;
    border-radius: 0.4rem;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .plain {
    background: none;
    color: var(--accent);
  }

  small,
  .note {
    color: var(--muted);
  }

  .replace {
    margin-top: 1rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--card);
  }
</style>

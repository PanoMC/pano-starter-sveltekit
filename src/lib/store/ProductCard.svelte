<script>
  import { imageUrl, money } from './format.js'

  /** @type {{ product: import('$lib/pano/plugins/market/types.js').MarketProductCard }} */
  let { product } = $props()
</script>

<a class="card" href="/store/{encodeURIComponent(product.slug)}">
  {#if product.imageFileName}
    <img src={imageUrl(product.imageFileName)} alt="" loading="lazy" />
  {/if}
  <span class="name">{product.name}</span>
  {#if product.shortDescription}<span class="short">{product.shortDescription}</span>{/if}
  <span class="price">
    {#if product.priceFrom}from
    {/if}{money(product.price, product.currency)}
    {#if product.compareAtPrice && product.compareAtPrice > product.price}
      <s>{money(product.compareAtPrice, product.currency)}</s>
    {/if}
  </span>
  {#if !product.inStock}<span class="stock">Out of stock</span>{/if}
  {#if product.owned}<span class="stock">You own this</span>{/if}
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    color: inherit;
    text-decoration: none;
  }

  img {
    width: 100%;
    max-height: 9rem;
    object-fit: contain;
  }

  .name {
    font-weight: 600;
  }

  .short,
  .stock {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .price s {
    color: var(--muted);
    margin-left: 0.4rem;
  }
</style>

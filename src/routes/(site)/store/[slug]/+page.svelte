<script>
  import AddToCart from '#lib/store/AddToCart.svelte'
  import NotInstalled from '#lib/store/NotInstalled.svelte'
  import { imageUrl, money } from '#lib/store/format.js'

  /** @type {{ data: any }} */
  let { data } = $props()

  const product = $derived(data.product)
</script>

<svelte:head>
  <title>{product?.name ?? 'Store'}</title>
</svelte:head>

{#if data.missing}
  <NotInstalled />
{:else}
  <article>
    {#if product.imageFileName}
      <img src={imageUrl(product.imageFileName)} alt="" />
    {/if}

    <h1>{product.name}</h1>
    {#if product.categoryName}<p class="muted">{product.categoryName}</p>{/if}

    <p class="price">
      {#if product.priceFrom}from
      {/if}{money(product.price, product.currency)}
      {#if product.compareAtPrice && product.compareAtPrice > product.price}
        <s>{money(product.compareAtPrice, product.currency)}</s>
      {/if}
    </p>

    <!-- The description is sanitised by Pano on every read; it is the store owner's HTML. -->
    {#if product.description}<div class="description">{@html product.description}</div>{/if}

    <AddToCart {product} user={data.user} />
  </article>

  <p><a href="/store">All products</a></p>
{/if}

<style>
  img {
    max-width: 100%;
    max-height: 18rem;
    object-fit: contain;
  }

  .muted {
    color: var(--muted);
  }

  .price {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .price s {
    color: var(--muted);
    font-weight: 400;
    margin-left: 0.4rem;
  }

  .description :global(img) {
    max-width: 100%;
    height: auto;
  }
</style>

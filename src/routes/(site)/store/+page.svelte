<script>
  import NotInstalled from '#lib/store/NotInstalled.svelte'
  import ProductCard from '#lib/store/ProductCard.svelte'
  import { storeUrl } from '#lib/store/format.js'

  /** @type {{ data: any }} */
  let { data } = $props()

  const filter = $derived(data.filter)
  const title = $derived(data.settings?.storeName || 'Store')
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if data.missing}
  <NotInstalled />
{:else if data.disabled}
  <h1>Store</h1>
  <p class="muted">The store is closed right now.</p>
{:else}
  <h1>{title}</h1>
  {#if data.settings?.storeDescription}<p class="muted">{data.settings.storeDescription}</p>{/if}

  <form class="search" method="GET" action="/store">
    <input
      type="search"
      name="search"
      value={filter.search}
      placeholder="Search products"
      aria-label="Search products"
    />
    {#if filter.category}<input type="hidden" name="category" value={filter.category} />{/if}
    <button type="submit">Search</button>
  </form>

  {#if data.categories.length}
    <nav class="categories" aria-label="Categories">
      <a href={storeUrl({ search: filter.search })} class:active={!filter.category}>All</a>
      {#each data.categories as category (category.id)}
        <a
          href={storeUrl({ category: category.id, search: filter.search })}
          class:active={filter.category === category.id}
          style:padding-left="{0.6 + category.depth * 0.8}rem">{category.name}</a
        >
      {/each}
    </nav>
  {/if}

  {#if data.featured.length}
    <h2>Featured</h2>
    <div class="grid">
      {#each data.featured as product (product.id)}<ProductCard {product} />{/each}
    </div>
    <h2>All products</h2>
  {/if}

  {#if data.items.length === 0}
    <p class="muted">No products found.</p>
  {:else}
    <div class="grid">
      {#each data.items as product (product.id)}<ProductCard {product} />{/each}
    </div>
  {/if}

  {#if data.page.totalPages > 1}
    <nav class="pager" aria-label="Pages">
      {#if data.page.number > 1}
        <a href={storeUrl({ ...filter, page: data.page.number - 1 })}>Previous</a>
      {/if}
      <span>{data.page.number} / {data.page.totalPages}</span>
      {#if data.page.number < data.page.totalPages}
        <a href={storeUrl({ ...filter, page: data.page.number + 1 })}>Next</a>
      {/if}
    </nav>
  {/if}
{/if}

<style>
  .muted {
    color: var(--muted);
  }

  .search {
    display: flex;
    gap: 0.5rem;
    margin: 1rem 0;
  }

  .search input {
    flex: 1;
    font: inherit;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--card);
    color: inherit;
  }

  .search button {
    font: inherit;
    padding: 0.4rem 0.9rem;
    border: 0;
    border-radius: 0.4rem;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
  }

  .categories {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin-bottom: 1rem;
  }

  .categories .active {
    font-weight: 700;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 1rem;
  }

  .pager {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 1.5rem;
  }
</style>

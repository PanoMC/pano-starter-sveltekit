<script>
  import CartLink from '#lib/store/CartLink.svelte'
  import Toasts from '#lib/store/Toasts.svelte'

  /** @type {{ data: any, children: import('svelte').Snippet }} */
  let { data, children } = $props()
</script>

{#if data.market}
  <nav class="store-nav" aria-label="Store">
    <a href="/store">Store</a>
    <span class="spacer"></span>
    <CartLink user={data.user} />
  </nav>
  <Toasts />
{/if}

{#if data.market}
  <div class="with-sidebar">
    <div class="content">{@render children()}</div>
    <aside class="sidebar" aria-label="Store widgets">
      <pano-market-goal></pano-market-goal>
      <pano-market-recent-buyers></pano-market-recent-buyers>
    </aside>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .with-sidebar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 15rem;
    gap: 1.5rem;
    align-items: start;
  }

  .sidebar {
    display: grid;
    gap: 1rem;
  }

  @media (max-width: 40rem) {
    .with-sidebar {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .store-nav {
    display: flex;
    gap: 1rem;
    padding-bottom: 0.75rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }

  .spacer {
    flex: 1;
  }
</style>

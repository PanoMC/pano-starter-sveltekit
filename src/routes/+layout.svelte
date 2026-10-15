<script>
  import '../app.css'
  import { onMount } from 'svelte'
  import { widgetUrls } from '#lib/pano/widgets.js'

  let { data, children } = $props()

  // Pano's web-component widgets (<pano-market-goal> ...). The loader comes through this site's /pano proxy, so it works the same
  // wherever the site runs and needs no CORS; `urls` tells a widget where this site keeps its pages.
  onMount(() => {
    const loader = document.createElement('script')
    loader.type = 'module'
    loader.src = '/pano/api/v1/widgets/loader.js'
    loader.onload = () => /** @type {any} */ (globalThis).PanoWidgets?.configure({ urls: widgetUrls })
    // Pano has no widget runtime (or is unreachable): the pages work without widgets.
    document.head.append(loader)

    return () => loader.remove()
  })
</script>

<header>
  <nav>
    <a class="brand" href="/">Pano site</a>
    <span class="spacer"></span>
    {#if data.user}
      <span class="who">{data.user.username}</span>
      <form method="POST" action="/logout">
        <button type="submit">Log out</button>
      </form>
    {:else}
      <a href="/login">Log in</a>
      <a href="/register">Register</a>
    {/if}
  </nav>
</header>

<main>
  {@render children()}
</main>

<style>
  header {
    border-bottom: 1px solid var(--line);
    background: var(--card);
  }

  nav {
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: 44rem;
    margin: 0 auto;
    padding: 0.75rem 1rem;
  }

  .brand {
    font-weight: 700;
    color: inherit;
    text-decoration: none;
  }

  .spacer {
    flex: 1;
  }

  .who {
    color: var(--muted);
  }

  form {
    margin: 0;
  }

  button {
    font: inherit;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>

<script>
  import { categoryOf, formatDate, writerOf } from '$lib/posts.js'

  let { data } = $props()
  let post = $derived(data.post)
  /** @type {{ title: string, url: string } | null} */
  let previous = $derived(/** @type {any} */ (data.previous))
  /** @type {{ title: string, url: string } | null} */
  let next = $derived(/** @type {any} */ (data.next))
</script>

<svelte:head>
  <title>{post.title}</title>
</svelte:head>

<article>
  <h1>{post.title}</h1>
  <p class="meta">
    {formatDate(post.date)}
    {#if writerOf(post)}· {writerOf(post)}{/if}
    {#if categoryOf(post)}· {categoryOf(post)}{/if}
  </p>

  <!-- Post bodies are HTML written by your staff in Pano's panel, so they are trusted. Sanitize here
       (for example with sanitize-html) if staff you do not fully trust can publish. -->
  <div class="body">{@html post.text}</div>
</article>

<nav class="around" aria-label="Other posts">
  {#if previous}<a href="/post/{encodeURIComponent(previous.url)}">← {previous.title}</a>{/if}
  <span class="spacer"></span>
  {#if next}<a href="/post/{encodeURIComponent(next.url)}">{next.title} →</a>{/if}
</nav>

<p><a href="/">All news</a></p>

<style>
  .meta {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .body :global(img) {
    max-width: 100%;
    height: auto;
  }

  .around {
    display: flex;
    gap: 1rem;
    margin: 2rem 0 1rem;
  }

  .spacer {
    flex: 1;
  }
</style>

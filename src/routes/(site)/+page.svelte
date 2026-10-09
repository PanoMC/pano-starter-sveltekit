<script>
  import { categoryOf, excerpt, formatDate, writerOf } from '$lib/posts.js'

  let { data } = $props()
</script>

<svelte:head>
  <title>News</title>
</svelte:head>

<h1>News</h1>

{#if data.items.length === 0}
  <p class="muted">No posts yet.</p>
{:else}
  <ul class="posts">
    {#each data.items as post (post.id)}
      <li>
        <h2><a href="/post/{encodeURIComponent(post.url)}">{post.title}</a></h2>
        <p class="meta">
          {formatDate(post.date)}
          {#if writerOf(post)}· {writerOf(post)}{/if}
          {#if categoryOf(post)}· {categoryOf(post)}{/if}
        </p>
        <p>{excerpt(post.text)}</p>
      </li>
    {/each}
  </ul>

  {#if data.page.totalPages > 1}
    <nav class="pager" aria-label="Pages">
      {#if data.page.number > 1}
        <a href="/?page={data.page.number - 1}">Newer</a>
      {/if}
      <span>{data.page.number} / {data.page.totalPages}</span>
      {#if data.page.number < data.page.totalPages}
        <a href="/?page={data.page.number + 1}">Older</a>
      {/if}
    </nav>
  {/if}
{/if}

<style>
  .posts {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 1rem;
  }

  li {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.25rem;
  }

  .meta,
  .muted {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 0.5rem;
  }

  .pager {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
  }
</style>

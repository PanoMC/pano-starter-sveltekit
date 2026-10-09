<script>
  import { onMount } from 'svelte'
  import { onToast } from './market.js'

  let message = $state('')

  onMount(() => {
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer
    const off = onToast((text) => {
      message = text
      clearTimeout(timer)
      timer = setTimeout(() => (message = ''), 3500)
    })

    return () => {
      off()
      clearTimeout(timer)
    }
  })
</script>

{#if message}
  <p class="toast" role="status">{message}</p>
{/if}

<style>
  .toast {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    margin: 0;
    padding: 0.6rem 0.9rem;
    background: var(--fg);
    color: var(--bg);
    border-radius: 0.4rem;
  }
</style>

<script>
  /** @type {{ message?: string|null, tone?: 'error'|'info' }} */
  let { message = null, tone = 'error' } = $props()
</script>

{#if message}
  <p class="message {tone}" role={tone === 'error' ? 'alert' : 'status'}>{message}</p>
{/if}

<style>
  .message {
    padding: 0.6rem 0.8rem;
    border-radius: 0.4rem;
    border: 1px solid var(--line);
    margin: 0 0 1rem;
  }

  .error {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>

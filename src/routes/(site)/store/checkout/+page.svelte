<script>
  import Checkout from '#lib/store/Checkout.svelte'
  import NotInstalled from '#lib/store/NotInstalled.svelte'

  /** @type {{ data: any }} */
  let { data } = $props()
</script>

{#if data.missing}
  <NotInstalled />
{:else if data.disabled}
  <h1>Checkout</h1>
  <p>The store is closed right now.</p>
{:else}
  <Checkout config={data.config} user={data.user} />
{/if}

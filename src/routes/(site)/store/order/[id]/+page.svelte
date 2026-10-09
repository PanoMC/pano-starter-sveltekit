<script>
  import NotInstalled from '$lib/store/NotInstalled.svelte'
  import Order from '$lib/store/Order.svelte'

  /** @type {{ data: any }} */
  let { data } = $props()
</script>

{#if data.missing}
  <NotInstalled />
{:else}
  <Order order={data.order} user={data.user} />
{/if}

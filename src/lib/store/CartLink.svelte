<script>
  import { onMount } from 'svelte'
  import { countOf } from './cart.js'
  import { getMarket } from './market.js'

  /** @type {{ user: { username: string } | null }} */
  let { user } = $props()

  let count = $state(0)

  onMount(() => {
    // The cart lives in the browser; `subscribe` calls back at once with the current state.
    return getMarket(user).cart.subscribe((cart) => (count = countOf(cart)))
  })
</script>

<a href="/store/checkout"
  >Cart{#if count > 0}&nbsp;({count}){/if}</a
>

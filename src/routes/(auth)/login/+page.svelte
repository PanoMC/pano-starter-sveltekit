<script>
  import { enhance } from '$app/forms'
  import Field from '#lib/components/Field.svelte'
  import FormMessage from '#lib/components/FormMessage.svelte'

  let { data, form } = $props()

  let step = $derived(form?.step ?? null)
  let next = $derived(form?.next ?? data.next)
</script>

<svelte:head>
  <title>Log in</title>
</svelte:head>

<h1>Log in</h1>

{#if data.keyMissing || form?.keyMissing}
  <FormMessage message={form?.message ?? data.keyMessage} />
{:else if form?.message}
  <FormMessage message={form.message} />
{/if}

{#if step === 'pending'}
  <form method="POST" action="?/pending" use:enhance>
    <input type="hidden" name="pendingToken" value={form?.pendingToken ?? ''} />
    <input type="hidden" name="next" value={next} />
    <Field name="totpCode" label="Authentication code" autocomplete="one-time-code" />
    <button type="submit">Continue</button>
  </form>
{:else}
  <form method="POST" action="?/login" use:enhance>
    <input type="hidden" name="next" value={next} />
    <Field
      name="usernameOrEmail"
      label="Username or email"
      value={form?.usernameOrEmail ?? ''}
      autocomplete="username"
      required
    />
    <Field name="password" label="Password" type="password" autocomplete="current-password" required />

    {#if step === 'totp'}
      <Field name="totpCode" label="Authentication code" autocomplete="one-time-code" required />
    {:else if step === 'captcha'}
      <!-- Pano's captcha provider renders its widget on your page; paste its response token here. -->
      <Field name="captchaToken" label="Captcha response" required />
    {:else if step === 'username'}
      <Field name="newUsername" label="Choose a username" autocomplete="username" required />
    {:else if step === 'email'}
      <Field name="registerEmail" label="Email address" type="email" autocomplete="email" required />
    {/if}

    <button type="submit">Log in</button>
  </form>
{/if}

<p>No account yet? <a href="/register">Register</a></p>

<style>
  button {
    font: inherit;
    padding: 0.5rem 1.1rem;
    border: 0;
    border-radius: 0.4rem;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
  }
</style>

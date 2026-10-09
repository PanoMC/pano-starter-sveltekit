<script>
  import { enhance } from '$app/forms'
  import Field from '$lib/components/Field.svelte'
  import FormMessage from '$lib/components/FormMessage.svelte'

  let { data, form } = $props()

  /** @param {string} name */
  const fieldError = (name) => form?.fields?.[name] ?? null
</script>

<svelte:head>
  <title>Register</title>
</svelte:head>

<h1>Register</h1>

{#if form?.verify}
  <FormMessage tone="info" message="We sent a confirmation link to {form.email}. Open it, then log in." />
  <p><a href="/login">Log in</a></p>
{:else if form?.created}
  <FormMessage tone="info" message="Your account is ready." />
  <p><a href="/login">Log in</a></p>
{:else}
  {#if data.keyMissing || form?.keyMissing}
    <FormMessage message={form?.message ?? data.keyMessage} />
  {:else if form?.message}
    <FormMessage message={form.message} />
  {/if}

  <form method="POST" use:enhance>
    <Field
      name="username"
      label="Username"
      value={form?.username ?? ''}
      autocomplete="username"
      error={fieldError('username')}
    />
    <Field
      name="email"
      label="Email"
      type="email"
      value={form?.email ?? ''}
      autocomplete="email"
      required
      error={fieldError('email')}
    />
    <Field
      name="password"
      label="Password"
      type="password"
      autocomplete="new-password"
      required
      error={fieldError('password')}
    />
    <Field
      name="passwordRepeat"
      label="Repeat password"
      type="password"
      autocomplete="new-password"
      required
      error={fieldError('passwordRepeat')}
    />

    <label class="agree">
      <input type="checkbox" name="agreement" required />
      I accept the site rules
    </label>

    <button type="submit">Register</button>
  </form>

  <p>Already registered? <a href="/login">Log in</a></p>
{/if}

<style>
  .agree {
    display: block;
    margin-bottom: 1rem;
  }

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

<script>
  /** @type {{ name: string, label: string, type?: string, value?: string, autocomplete?: import('svelte/elements').FullAutoFill | null, required?: boolean, error?: string|null }} */
  let {
    name,
    label,
    type = 'text',
    value = '',
    autocomplete = null,
    required = false,
    error = null
  } = $props()
</script>

<label>
  <span>{label}</span>
  <input {name} {type} {value} {required} {autocomplete} aria-invalid={error ? 'true' : undefined} />
  {#if error}<small>{error}</small>{/if}
</label>

<style>
  label {
    display: block;
    margin-bottom: 1rem;
  }

  span {
    display: block;
    font-size: 0.9rem;
    margin-bottom: 0.25rem;
  }

  input {
    width: 100%;
    font: inherit;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--card);
    color: inherit;
  }

  small {
    color: var(--danger);
  }
</style>

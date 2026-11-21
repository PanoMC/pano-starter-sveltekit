# Repository notes

Notes for agents and people working in this repository. `AGENTS.md` routes here.

`README.md` is the full description; this file is the short version.

## What this is

`pano-starter-sveltekit` is the official start of a headless Pano site: SvelteKit 3, Svelte 5, `adapter-node`, Bun,
JavaScript with JSDoc. No Bootstrap, no theme-core. Every call to Pano is made by this server (a BFF); the session token
Pano returns at login is kept in an `HttpOnly` cookie. It runs in three modes from one build: own origin, external
upstream proxied by Pano, custom app run by Pano (`bun run package` makes the zip).

## Commands

```bash
bun install && cp .env.example .env   # API_URL, PANO_FRONTEND_KEY
bun run dev
bun run pano:pull                     # regenerate src/lib/pano from a running Pano
bun run check                         # svelte-check + pano-client check
bun test                              # against a Bun.serve stand-in for Pano
bun run build && bun run package
```

`bun run e2e` needs an isolated Pano instance and is not part of `bun test`.

## Where things are

| Path | Content |
| --- | --- |
| `src/hooks.server.js`, `src/lib/server/` | session cookie, the client per request, auth flow |
| `src/lib/pano/core/`, `src/lib/pano/plugins/` | generated client: never edit, run `bun run pano:pull` |
| `src/lib/pano/widgets.js` | the URL map for Pano's widget loader (hand-written) |
| `src/routes/(auth)/`, `src/routes/(site)/`, `src/routes/pano/` | sign-in pages, site pages, the `/pano` proxy |
| `manifest.json` | the custom-app manifest: `type`, `apiLevel`, `urls` |

## Conventions

- Server-to-Pano calls use the global `fetch`, never `event.fetch`.
- This repo is copied by people starting a site: keep it small, with no dependency on a sibling checkout beyond the
  npm packages `@panomc/client` and `@panomc/client-gen` (exact versions; the client is bundled into the server build).

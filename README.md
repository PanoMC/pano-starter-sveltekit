# pano-starter-sveltekit

A headless SvelteKit site for Pano: Svelte 5, SvelteKit 2, `adapter-node`, Bun, JavaScript with JSDoc types. No Bootstrap, no theme-core.

Every call to Pano is made by this server (a BFF). The session token Pano returns at login is stored in an `HttpOnly` cookie and never reaches browser JavaScript.

## Run

```sh
bun install
cp .env.example .env     # API_URL, PANO_FRONTEND_KEY
bun run dev
```

Create the key in Pano: Panel -> Appearance -> Themes -> gear button ("Front-end settings") -> Front-end keys. Without it the public pages (posts) work, and login and register show the instruction to create one. Keys are off while the front-end mode is Theme (a key cannot be created, and a request with a stored key answers `403 FRONTEND_ACCESS_DISABLED`); switch the mode to Custom app, External or None. Stored keys are kept and work again then.

## Three ways to run it

| Mode              | How                                                                                                | Origin                                   |
| ----------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Own origin        | `bun run build && bun start` (or `bun run dev`) on its own host name; Pano is reached by `API_URL` | the site's own, e.g. `https://shop.test` |
| External upstream | run `bun build/index.js` anywhere and let Pano proxy to it; set `ORIGIN` to Pano's public address  | Pano's                                   |
| Custom app        | `bun run package`, upload the zip in Panel -> Appearance -> Themes -> gear button -> Custom apps and select it | Pano's; Pano runs it and sets the env    |

`bun run package` builds and zips `manifest.json`, `index.js` and `build/` into `.open-frontend-run/artifacts/pano-starter.zip` (`--out <file>` changes the path). `bun run e2e` runs the whole scenario against an isolated Pano instance in all three modes; it needs the frozen bundle in `.open-frontend-run/bundle` and a database, so it is not part of `bun test`.

## .env keys

| Key                 | Meaning                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `API_URL`           | Where Pano answers; a trailing `/api` or `/api/v1` is optional. `PANO_API_URL` wins when both are set |
| `PANO_FRONTEND_KEY` | Panel -> Appearance -> Themes -> gear button -> Front-end keys. Without it only public pages work                 |
| `PANO_SITE_URL`     | Public address of this site (decides the cookie `Secure` flag and the allowed form origin)            |
| `ORIGIN`            | adapter-node: the public origin, needed when the site sits behind a proxy                             |
| `PORT`, `HOST`      | adapter-node listen address (Pano sets them in custom-app mode)                                       |

Calls from the server to Pano use the global `fetch`, never SvelteKit's `event.fetch`, so a site served on Pano's own origin does not call itself. The `/pano` proxy passes a redirect of Pano (for example an avatar on its image host) on to the browser for `GET` and `HEAD`.

## Where things are

| Path                          | Content                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `src/hooks.server.js`         | cookie -> `locals.pano` (client), `locals.user`, `locals.plugins` |
| `src/lib/server/pano.js`      | `panoFor`, `clientIpOf`, session cookie helpers, `plugins()`      |
| `src/lib/server/auth-flow.js` | Pano's answers -> form results (2FA, captcha, pending steps)      |
| `src/lib/pano/core/`          | core API operations, written by `bun run pano:pull` (generated)   |
| `src/lib/pano/plugins/`       | per active plugin: its operations, types and served controllers   |
| `src/lib/pano/widgets.js`     | the URL map handed to `PanoWidgets.configure` (hand-written)      |
| `src/routes/(auth)/`          | login, register, logout (form actions)                            |
| `src/routes/(site)/`          | posts list, post page                                             |

## The Pano client

`src/lib/pano` is pulled from a running Pano, never edited: `bun run pano:pull` (Pano at `PANO_URL`, else the origin of `API_URL`, else `http://localhost:8088`) writes the core operations and, for every active plugin, its operations, types and served controllers. `bun run check` runs `svelte-check` and `pano-client check`, which exits 1 listing removed or changed operations and controllers that differ from the Pano it asks (run `bun run pano:pull` again). The root layout loads Pano's widget loader through the `/pano` proxy and the store sidebar embeds `<pano-market-goal>` and `<pano-market-recent-buyers>`.

## Test

```sh
bun test           # against a Bun.serve stand-in for Pano; the build tests run once `bun run build` has produced build/
bun run build
bun run check
```

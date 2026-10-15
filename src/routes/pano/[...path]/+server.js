// BFF proxy: /pano/api/v1/... -> Pano's /api/v1/..., with the front-end key and the visitor's session token added here.
import { proxyToPano } from '#lib/store/proxy.server.js'

/** @type {import('@sveltejs/kit').RequestHandler} */
export const GET = (event) => proxyToPano(event)
export const POST = GET
export const PUT = GET
export const PATCH = GET
export const DELETE = GET

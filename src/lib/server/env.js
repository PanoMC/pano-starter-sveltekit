// The server's environment (declared in src/env.js) as one object. Code reads `env.NAME` at call time, so a test can hand
// in process.env itself (tests/preload.js).
import * as env from '$app/env/private'

export { env }

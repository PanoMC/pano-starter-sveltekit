import { describe, expect, test } from 'bun:test'

import { loopbackTarget } from '../src/lib/server/canonical.js'

const url = new URL('http://127.0.0.1:3005/login?next=%2Fstore')

describe('loopbackTarget', () => {
  test('the other loopback name goes to ORIGIN with path and query', () => {
    const res = loopbackTarget('http://127.0.0.1:3005', 'GET', 'localhost:3005', url)

    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toBe('http://127.0.0.1:3005/login?next=%2Fstore')
  })

  test('ORIGIN itself, a post, another port and a public host are left alone', () => {
    expect(loopbackTarget('http://127.0.0.1:3005', 'GET', '127.0.0.1:3005', url)).toBeNull()
    expect(loopbackTarget('http://127.0.0.1:3005', 'POST', 'localhost:3005', url)).toBeNull()
    expect(loopbackTarget('http://127.0.0.1:3005', 'GET', 'localhost:3000', url)).toBeNull()
    expect(loopbackTarget('https://play.example.com', 'GET', '127.0.0.1:3000', url)).toBeNull()
    expect(loopbackTarget('http://127.0.0.1:3005', 'GET', 'play.example.com', url)).toBeNull()
    expect(loopbackTarget(undefined, 'GET', 'localhost:3005', url)).toBeNull()
  })
})

// Run: node --experimental-strip-types src/auth.check.ts
import assert from 'node:assert/strict'
import { decodeJwt } from './auth.ts'

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fakeJwt = (payload: object) => `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(payload))}.sig`

// A real Google ID token payload, decoded correctly -- including the '-'/'_'
// url-safe alphabet, which trips a naive atob() the moment a name or email
// happens to base64-encode to one of those characters.
const token = fakeJwt({
  name: 'Ada Lovelace', email: 'ada@example.com',
  picture: 'https://example.com/p.jpg', sub: '1234567890', extra_field_should_be_ignored: true,
})
assert.deepEqual(decodeJwt(token), {
  name: 'Ada Lovelace', email: 'ada@example.com', picture: 'https://example.com/p.jpg', sub: '1234567890',
})

// Garbage input must not throw -- a malformed token is "no user", not a crash.
assert.equal(decodeJwt('not-a-jwt'), null)
assert.equal(decodeJwt(''), null)
assert.equal(decodeJwt('a.b'), null)               // only two segments, no payload padding at all

console.log('auth ok')

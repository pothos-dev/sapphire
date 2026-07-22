import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mintWriteJwt } from './jwt';

/** Decode a base64url segment to a UTF-8 string. */
const dec = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

test('mints a three-part HS256 token with the expected header + claims', () => {
  const token = mintWriteJwt(
    { sub: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
    'secret',
    60,
    1_000,
  );
  const [h, p, s] = token.split('.');
  expect(JSON.parse(dec(h))).toEqual({ alg: 'HS256', typ: 'JWT' });
  expect(JSON.parse(dec(p))).toEqual({
    sub: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    iat: 1_000,
    exp: 1_060,
  });
  // Signature is HMAC-SHA256 over `header.payload` with the secret.
  const expected = createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url');
  expect(s).toBe(expected);
});

test('a wrong secret yields a different signature (verifier would reject)', () => {
  const a = mintWriteJwt({ sub: 'u', name: 'n', email: 'e' }, 'right', 60, 1);
  const b = mintWriteJwt({ sub: 'u', name: 'n', email: 'e' }, 'wrong', 60, 1);
  expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
});

test('exp follows iat by the ttl', () => {
  const token = mintWriteJwt({ sub: 'u', name: 'n', email: 'e' }, 's', 120, 5_000);
  const claims = JSON.parse(dec(token.split('.')[1]));
  expect(claims.exp - claims.iat).toBe(120);
});

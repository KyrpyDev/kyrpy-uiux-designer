import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicBaseUrl } from '../interfaces/http/base-url.js';

const req = (headers, encrypted = false) => ({ headers, socket: { encrypted } });

test('publicBaseUrl uses only the first entry of a proxy chain', () => {
  assert.equal(publicBaseUrl(req({ 'x-forwarded-proto': 'https,http', host: 'design.kyrpy.kyrpy.com' })), 'https://design.kyrpy.kyrpy.com');
  assert.equal(publicBaseUrl(req({ 'x-forwarded-proto': ' https , http', 'x-forwarded-host': 'a.example.com, b.internal:8080', host: 'x' })), 'https://a.example.com');
});

test('publicBaseUrl falls back to the socket and Host header', () => {
  assert.equal(publicBaseUrl(req({ host: 'localhost:5180' })), 'http://localhost:5180');
  assert.equal(publicBaseUrl(req({ host: 'localhost:5180' }, true)), 'https://localhost:5180');
  assert.equal(publicBaseUrl(req({ 'x-forwarded-proto': 'javascript', host: 'h:1' })), 'http://h:1');
});

test('publicBaseUrl rejects forged hosts', () => {
  assert.equal(publicBaseUrl(req({ 'x-forwarded-host': 'h"><script>pwn()</script>', host: 'real.host' })), 'http://real.host');
  assert.equal(publicBaseUrl(req({ 'x-forwarded-host': 'evil.com/path?x', host: 'real.host' })), 'http://real.host');
  assert.equal(publicBaseUrl(req({ host: 'bad host' })), 'http://localhost');
});

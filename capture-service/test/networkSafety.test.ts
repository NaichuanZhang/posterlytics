import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPrivateAddress, UnsafeTargetError } from '../src/networkSafety.js';

test('blocks private, link-local, documentation, and mapped addresses', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.20.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.51.100.2',
    '203.0.113.4',
    '::1',
    '::ffff:7f00:1',
    '2001:db8::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(isPrivateAddress(address), true, `expected ${address} to be blocked`);
  }
});

test('allows representative public IPv4 and IPv6 addresses', () => {
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('rejects local targets, credentials, and unsupported protocols', async () => {
  for (const url of [
    'http://localhost',
    'http://service.localhost',
    'http://127.0.0.1',
    'http://[::1]',
    'https://user:password@example.com',
    'file:///etc/passwd',
  ]) {
    await assert.rejects(assertPublicUrl(url), UnsafeTargetError);
  }
});

test('accepts a public HTTP target', async () => {
  const url = await assertPublicUrl('https://8.8.8.8/example');
  assert.equal(url.hostname, '8.8.8.8');
});

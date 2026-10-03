import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../scripts/lib/redact.mjs';

test('common secrets are redacted', () => {
  const samples = [
    'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
    'openai sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    'gh token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'aws AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123',
    'password=hunter2hunter2',
    'postgres://admin:s3cretpass@db.example.com/app',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ];
  for (const s of samples) {
    const out = redact(s);
    assert.match(out, /REDACTED/, s);
  }
  assert.ok(!redact('password=hunter2hunter2').includes('hunter2'));
  assert.ok(!redact('postgres://admin:s3cretpass@db').includes('s3cretpass'));
});

test('ordinary text is unchanged', () => {
  const s = 'Decision: use the token bucket algorithm for rate limiting because it allows bursts.';
  assert.equal(redact(s), s);
});

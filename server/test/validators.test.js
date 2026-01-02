const assert = require('assert');
const { isValidTarget, normalizeTarget } = require('../validators');

const cases = [
  { input: 'example.com', valid: true, normalized: 'example.com' },
  { input: 'http://example.com', valid: true, normalized: 'example.com' },
  { input: 'https://example.com:8443', valid: true, normalized: 'example.com:8443' },
  { input: '192.168.0.1', valid: true, normalized: '192.168.0.1' },
  { input: 'example.com/login', valid: false },
  { input: 'http://example.com/path', valid: false },
  { input: 'example.com?x=1', valid: false },
  { input: 'bad host', valid: false },
  { input: '', valid: false }
];

cases.forEach((c) => {
  assert.strictEqual(isValidTarget(c.input), c.valid, `validity mismatch for ${c.input}`);
  if (c.valid && c.normalized) {
    assert.strictEqual(normalizeTarget(c.input), c.normalized, `normalize mismatch for ${c.input}`);
  }
});

console.log('validators.test.js passed');

/**
 * Smoke test: verifies the server starts and serves the host page.
 * Run: node smoke-test.mjs
 */

import { createTestHostServer } from './dist/index.js';

const server = await createTestHostServer({
  productUrl: 'http://localhost:3001',
  accounts: ['alice', 'bob'],
});

console.log('Server started at:', server.url);

// Fetch the page and check it contains expected content
const res = await fetch(server.url);
const html = await res.text();

const checks = [
  ['has iframe', html.includes('id="product-frame"')],
  ['has config', html.includes('__TEST_HOST_CONFIG__')],
  ['has product URL', html.includes('http://localhost:3001')],
  ['has Alice account', html.includes('Alice')],
  ['has Bob account', html.includes('Bob')],
  ['has bundle script', html.includes('<script>') && html.length > 10000],
  ['has test-host API', html.includes('__TEST_HOST__')],
];

let allPassed = true;
for (const [name, passed] of checks) {
  console.log(passed ? `  PASS: ${name}` : `  FAIL: ${name}`);
  if (!passed) allPassed = false;
}

await server.close();

if (allPassed) {
  console.log('\nAll checks passed!');
  process.exit(0);
} else {
  console.log('\nSome checks failed!');
  process.exit(1);
}

/**
 * ESM compatibility test: verifies import works for both entry points
 * and the server functions correctly when loaded via ESM.
 * Run: node test-exports-esm.mjs
 */

import assert from 'node:assert';
import { describe, it, after } from 'node:test';

describe('ESM import("@parity/host-api-test-sdk")', () => {
  /** @type {import('./dist/index')} */
  let sdk;

  it('can be imported', async () => {
    sdk = await import('./dist/index.js');
  });

  it('exports createTestHostServer', () => {
    assert.strictEqual(typeof sdk.createTestHostServer, 'function');
  });

  it('exports DEV_ACCOUNTS', () => {
    assert.ok(sdk.DEV_ACCOUNTS);
    assert.strictEqual(sdk.DEV_ACCOUNTS.alice.name, 'Alice');
    assert.strictEqual(sdk.DEV_ACCOUNTS.bob.uri, '//Bob');
  });

  it('exports DEV_ACCOUNT_NAMES', () => {
    assert.ok(Array.isArray(sdk.DEV_ACCOUNT_NAMES));
    assert.ok(sdk.DEV_ACCOUNT_NAMES.includes('alice'));
  });

  it('exports chain configs', () => {
    assert.ok(sdk.DEFAULT_CHAIN);
    assert.ok(sdk.PASEO_ASSET_HUB);
    assert.ok(sdk.PREVIEWNET);
    assert.ok(sdk.PREVIEWNET_ASSET_HUB);
    assert.ok(Array.isArray(sdk.SUPPORTED_CHAINS));
    assert.strictEqual(sdk.DEFAULT_CHAIN, sdk.PASEO_ASSET_HUB);
  });

  describe('createTestHostServer (ESM)', () => {
    let server;

    after(async () => {
      if (server) await server.close();
    });

    it('starts a server and serves the host page', async () => {
      server = await sdk.createTestHostServer({
        productUrl: 'http://localhost:3001',
        accounts: ['alice', 'bob'],
      });

      assert.ok(server.url.startsWith('http://127.0.0.1:'));

      const res = await fetch(server.url);
      const html = await res.text();

      assert.ok(html.includes('id="product-frame"'), 'has iframe');
      assert.ok(html.includes('__TEST_HOST_CONFIG__'), 'has config');
      assert.ok(html.includes('http://localhost:3001'), 'has product URL');
      assert.ok(html.includes('Alice'), 'has Alice account');
      assert.ok(html.includes('Bob'), 'has Bob account');
      assert.ok(html.includes('__TEST_HOST__'), 'has test-host API');
      assert.ok(html.length > 10000, 'has bundle script (page > 10KB)');
      assert.ok(
        html.includes('Permission') && html.includes('approved'),
        'has permission handler in bundle',
      );
      assert.ok(
        html.includes('Navigation requested'),
        'has navigation handler in bundle',
      );
      assert.ok(
        html.includes('[test-host] Notification'),
        'has notification handler in bundle',
      );
    });
  });

  describe('productAccounts config', () => {
    let serverWithMap;

    after(async () => {
      if (serverWithMap) await serverWithMap.close();
    });

    it('passes productAccounts to host config when set', async () => {
      serverWithMap = await sdk.createTestHostServer({
        productUrl: 'http://localhost:3001',
        accounts: ['bob'],
        productAccounts: { 'myapp.dot/0': 'bob', 'myapp.dot/2': 'charlie' },
      });

      const res = await fetch(serverWithMap.url);
      const html = await res.text();

      const match = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
      assert.ok(match, 'config found in page');
      const config = JSON.parse(match[1]);
      assert.ok(config.productAccounts, 'productAccounts present');
      assert.strictEqual(config.productAccounts['myapp.dot/0'].uri, '//Bob');
      assert.strictEqual(config.productAccounts['myapp.dot/2'].uri, '//Charlie');
    });

    it('omits productAccounts from config when not set', async () => {
      const server = await sdk.createTestHostServer({
        productUrl: 'http://localhost:3001',
        accounts: ['alice'],
      });

      try {
        const res = await fetch(server.url);
        const html = await res.text();

        const match = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
        const config = JSON.parse(match[1]);
        assert.strictEqual(config.productAccounts, undefined, 'no productAccounts key');
      } finally {
        await server.close();
      }
    });
  });
});

describe('ESM import("@parity/host-api-test-sdk/playwright")', () => {
  /** @type {import('./dist/playwright/index')} */
  let pw;

  it('can be imported', async () => {
    pw = await import('./dist/playwright/index.js');
  });

  it('exports createTestHostFixture', () => {
    assert.strictEqual(typeof pw.createTestHostFixture, 'function');
  });

  it('exports chain configs', () => {
    assert.ok(pw.DEFAULT_CHAIN);
    assert.ok(pw.PASEO_ASSET_HUB);
    assert.ok(pw.PREVIEWNET);
    assert.ok(pw.PREVIEWNET_ASSET_HUB);
  });
});

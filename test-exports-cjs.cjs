/**
 * CJS compatibility test: verifies require() works for both entry points
 * and the server functions correctly when loaded via CJS.
 * Run: node test-exports-cjs.cjs
 */

const assert = require('node:assert');
const { describe, it, after } = require('node:test');

describe('CJS require("@parity/host-api-test-sdk")', () => {
  /** @type {import('./dist/index')} */
  let sdk;

  it('can be required', () => {
    sdk = require('./dist/index.cjs');
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

  describe('createTestHostServer (CJS)', () => {
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
    });
  });

  describe('deriveProductAccounts config (CJS)', () => {
    let serverDefault;
    let serverDerived;

    after(async () => {
      if (serverDefault) await serverDefault.close();
      if (serverDerived) await serverDerived.close();
    });

    it('defaults to deriveProductAccounts: false in host config', async () => {
      serverDefault = await sdk.createTestHostServer({
        productUrl: 'http://localhost:3001',
        accounts: ['alice'],
      });

      const res = await fetch(serverDefault.url);
      const html = await res.text();

      const match = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
      assert.ok(match, 'config found in page');
      const config = JSON.parse(match[1]);
      assert.strictEqual(config.deriveProductAccounts, false, 'default is false');
    });

    it('passes deriveProductAccounts: true when set', async () => {
      serverDerived = await sdk.createTestHostServer({
        productUrl: 'http://localhost:3001',
        accounts: ['bob'],
        deriveProductAccounts: true,
      });

      const res = await fetch(serverDerived.url);
      const html = await res.text();

      const match = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
      assert.ok(match, 'config found in page');
      const config = JSON.parse(match[1]);
      assert.strictEqual(config.deriveProductAccounts, true, 'explicitly true');
    });

    it('bundle contains both code paths for account derivation', async () => {
      const res = await fetch(serverDefault.url);
      const html = await res.text();

      assert.ok(
        html.includes('deriveProductAccounts'),
        'bundle references deriveProductAccounts flag',
      );
    });
  });
});

describe('CJS require("@parity/host-api-test-sdk/playwright")', () => {
  /** @type {import('./dist/playwright/index')} */
  let pw;

  it('can be required', () => {
    pw = require('./dist/playwright.cjs');
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

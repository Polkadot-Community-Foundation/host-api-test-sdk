/**
 * Integration test: verifies that product accounts work end-to-end
 * through the real Spektr protocol (host-container ↔ product-sdk).
 *
 * A minimal product (test-product.ts) runs in the iframe, calls
 * getProductAccount("test-product", 0) via product-sdk, and writes
 * the returned public key to the DOM. These tests read it back
 * and compare against known dev keypairs.
 */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import { createTestHostServer } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Test product server ─────────────────────────────────────────────

async function serveTestProduct(): Promise<{ url: string; close: () => Promise<void> }> {
  const html = readFileSync(join(__dirname, 'test-product.html'), 'utf-8');
  const bundle = readFileSync(join(__dirname, 'test-product-bundle.js'), 'utf-8');

  const server = createServer((req, res) => {
    if (req.url?.endsWith('.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(bundle);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    }
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('no address'));
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Load the test host and wait for the product to connect. */
async function loadHost(page: import('@playwright/test').Page, hostUrl: string) {
  await page.goto(hostUrl);
  await page.waitForFunction(() => !!window.__TEST_HOST__, { timeout: 15_000 });
  return page.frameLocator('#product-frame');
}

/** Get the product iframe as a Frame (supports evaluate, unlike FrameLocator). */
function getProductFrame(page: import('@playwright/test').Page, productUrl: string) {
  const frame = page.frames().find(f => f.url().startsWith(productUrl));
  if (!frame) throw new Error('Product frame not found');
  return frame;
}

/** Load host, wait for product to be ready, return the evaluable product frame. */
async function loadHostAndProduct(page: import('@playwright/test').Page, hostUrl: string, productUrl: string) {
  const frameLocator = await loadHost(page, hostUrl);
  // Wait for root-keys to be ready (product fully initialized)
  await expect(frameLocator.locator('#root-keys[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
  return getProductFrame(page, productUrl);
}

/** Read the public key hex that the test product received from the host. */
async function getProductPublicKey(page: import('@playwright/test').Page, hostUrl: string): Promise<string> {
  const frame = await loadHost(page, hostUrl);
  const pkLocator = frame.locator('#product-key[data-ready="true"]');
  await expect(pkLocator).toBeVisible({ timeout: 15_000 });
  return (await pkLocator.textContent())!;
}

/** Read the root (non-product) account public keys from the test product. */
async function getRootPublicKeys(page: import('@playwright/test').Page, hostUrl: string): Promise<string[]> {
  const frame = await loadHost(page, hostUrl);
  const rootLocator = frame.locator('#root-keys[data-ready="true"]');
  await expect(rootLocator).toBeVisible({ timeout: 15_000 });
  return JSON.parse((await rootLocator.textContent())!);
}

// ── Setup ───────────────────────────────────────────────────────────

let productServer: Awaited<ReturnType<typeof serveTestProduct>>;
let keyring: Keyring;

test.beforeAll(async () => {
  await cryptoWaitReady();
  keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
  productServer = await serveTestProduct();
});

test.afterAll(async () => {
  await productServer?.close();
});

// ── Tests ───────────────────────────────────────────────────────────

test.describe('Product account derivation', () => {

  test('by default, product account is derived (production behavior)', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob'],
    });

    try {
      const bobBaseKey = u8aToHex(keyring.addFromUri('//Bob').publicKey);
      // The product calls getProductAccount("test-product", 0),
      // so the derived path is //Bob//test-product.dot/0
      const bobDerivedKey = u8aToHex(keyring.addFromUri('//Bob//test-product.dot/0').publicKey);
      const productKey = await getProductPublicKey(page, host.url);

      expect(productKey).toBe(bobDerivedKey);
      expect(productKey).not.toBe(bobBaseKey);
    } finally {
      await host.close();
    }
  });

  test('productAccounts maps a product account to a specific dev account', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob'],
      productAccounts: {
        'test-product.dot/0': 'bob',
      },
    });

    try {
      const bobBaseKey = u8aToHex(keyring.addFromUri('//Bob').publicKey);
      const productKey = await getProductPublicKey(page, host.url);

      expect(productKey).toBe(bobBaseKey);
    } finally {
      await host.close();
    }
  });

  test('productAccounts supports custom URIs', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob'],
      productAccounts: {
        'test-product.dot/0': { name: 'Charlie', uri: '//Charlie' },
      },
    });

    try {
      const charlieKey = u8aToHex(keyring.addFromUri('//Charlie').publicKey);
      const productKey = await getProductPublicKey(page, host.url);

      expect(productKey).toBe(charlieKey);
    } finally {
      await host.close();
    }
  });

  test('unmapped product accounts fall back to derivation', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob'],
      productAccounts: {
        'other-app/0': 'alice', // different key, won't match
      },
    });

    try {
      // "test-product.dot/0" is NOT in productAccounts, so it derives
      const bobDerivedKey = u8aToHex(keyring.addFromUri('//Bob//test-product.dot/0').publicKey);
      const productKey = await getProductPublicKey(page, host.url);

      expect(productKey).toBe(bobDerivedKey);
    } finally {
      await host.close();
    }
  });
});

test.describe('Root (non-product) accounts', () => {

  test('dev account names resolve to known public keys', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice', 'bob'],
    });

    try {
      const aliceKey = u8aToHex(keyring.addFromUri('//Alice').publicKey);
      const bobKey = u8aToHex(keyring.addFromUri('//Bob').publicKey);
      const rootKeys = await getRootPublicKeys(page, host.url);

      expect(rootKeys).toEqual([aliceKey, bobKey]);
    } finally {
      await host.close();
    }
  });

  test('custom URI accounts are included in root accounts', async ({ page }) => {
    const customUri = '//Alice//custom/derivation';
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob', { name: 'Custom', uri: customUri }],
    });

    try {
      const bobKey = u8aToHex(keyring.addFromUri('//Bob').publicKey);
      const customKey = u8aToHex(keyring.addFromUri(customUri).publicKey);
      const rootKeys = await getRootPublicKeys(page, host.url);

      expect(rootKeys).toEqual([bobKey, customKey]);
    } finally {
      await host.close();
    }
  });
});

// ── Permission enforcement ──────────────────────────────────────────

test.describe('Permission enforcement', () => {

  test('signing fails without TransactionSubmit permission', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      // Attempt signing without requesting permission first
      const result = await product.evaluate(() => window.__TEST_PRODUCT__.trySignRaw());
      expect(result.ok).toBe(false);
    } finally {
      await host.close();
    }
  });

  test('signing succeeds after requesting TransactionSubmit permission', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      // Request permission first
      const permResult = await product.evaluate(() => window.__TEST_PRODUCT__.requestTransactionSubmit());
      expect(permResult.ok).toBe(true);

      // Now signing should work
      const signResult = await product.evaluate(() => window.__TEST_PRODUCT__.trySignRaw());
      expect(signResult.ok).toBe(true);
      expect(signResult.signature).toBeTruthy();

      // Verify permission was logged on host side
      const log = await page.evaluate(() => window.__TEST_HOST__.getPermissionLog());
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log.some((e: any) => e.tag === 'TransactionSubmit' && e.approved)).toBe(true);
    } finally {
      await host.close();
    }
  });

  test('signing succeeds when enforcement is disabled', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      // Disable enforcement
      await page.evaluate(() => window.__TEST_HOST__.setEnforcePermissions(false));

      // Signing works without permission request
      const result = await product.evaluate(() => window.__TEST_PRODUCT__.trySignRaw());
      expect(result.ok).toBe(true);
    } finally {
      await host.close();
    }
  });

  test('signing succeeds when permission is pre-granted via grantPermission', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      // Pre-grant without product requesting
      await page.evaluate(() => window.__TEST_HOST__.grantPermission('TransactionSubmit'));

      const result = await product.evaluate(() => window.__TEST_PRODUCT__.trySignRaw());
      expect(result.ok).toBe(true);
    } finally {
      await host.close();
    }
  });

  test('signing fails when permission is rejected', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      // Set reject-all behavior
      await page.evaluate(() => window.__TEST_HOST__.setPermissionBehavior('reject-all'));

      // Product requests permission — gets rejected
      const permResult = await product.evaluate(() => window.__TEST_PRODUCT__.requestTransactionSubmit());
      expect(permResult.ok).toBe(true); // request succeeded, but...
      // approved could be false depending on result shape

      // Signing should still fail since permission was rejected
      const signResult = await product.evaluate(() => window.__TEST_PRODUCT__.trySignRaw());
      expect(signResult.ok).toBe(false);

      // Permission log shows rejection
      const log = await page.evaluate(() => window.__TEST_HOST__.getPermissionLog());
      expect(log.some((e: any) => e.tag === 'TransactionSubmit' && !e.approved)).toBe(true);
    } finally {
      await host.close();
    }
  });
});

// ── Device permission handling ──────────────────────────────────────

test.describe('Device permissions', () => {

  test('device permission request is tracked and approved by default', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      const result = await product.evaluate(() => window.__TEST_PRODUCT__.requestDevicePermission('Camera'));
      expect(result.ok).toBe(true);

      // Verify it was logged
      const log = await page.evaluate(() => window.__TEST_HOST__.getPermissionLog());
      expect(log.some((e: any) => e.tag === 'Camera' && e.approved)).toBe(true);

      // Verify it's in granted set
      const granted = await page.evaluate(() => window.__TEST_HOST__.getGrantedPermissions());
      expect(granted).toContain('Camera');
    } finally {
      await host.close();
    }
  });

  test('device permission is rejected when behavior is reject-all', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      await page.evaluate(() => window.__TEST_HOST__.setPermissionBehavior('reject-all'));

      const result = await product.evaluate(() => window.__TEST_PRODUCT__.requestDevicePermission('Microphone'));
      expect(result.ok).toBe(true); // request completed, check approved field

      const log = await page.evaluate(() => window.__TEST_HOST__.getPermissionLog());
      expect(log.some((e: any) => e.tag === 'Microphone' && !e.approved)).toBe(true);

      const granted = await page.evaluate(() => window.__TEST_HOST__.getGrantedPermissions());
      expect(granted).not.toContain('Microphone');
    } finally {
      await host.close();
    }
  });

  test('ExternalRequest permission is tracked', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['alice'],
    });

    try {
      const product = await loadHostAndProduct(page, host.url, productServer.url);

      const result = await product.evaluate(() =>
        window.__TEST_PRODUCT__.requestExternalRequest('https://example.com')
      );
      expect(result.ok).toBe(true);

      const log = await page.evaluate(() => window.__TEST_HOST__.getPermissionLog());
      expect(log.some((e: any) => e.tag === 'ExternalRequest' && e.approved)).toBe(true);
    } finally {
      await host.close();
    }
  });
});

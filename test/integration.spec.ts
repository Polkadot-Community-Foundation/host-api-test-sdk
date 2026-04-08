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

/** Read the public key hex that the test product received from the host. */
async function getProductPublicKey(page: import('@playwright/test').Page, hostUrl: string): Promise<string> {
  await page.goto(hostUrl);
  await page.waitForFunction(() => !!window.__TEST_HOST__, { timeout: 15_000 });

  const pkLocator = page.frameLocator('#product-frame').locator('#public-key[data-ready="true"]');
  await expect(pkLocator).toBeVisible({ timeout: 15_000 });

  return (await pkLocator.textContent())!;
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

  test('by default, product account is the same keypair as //Bob', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob'],
    });

    try {
      const bobBaseKey = u8aToHex(keyring.addFromUri('//Bob').publicKey);
      const productKey = await getProductPublicKey(page, host.url);

      expect(productKey).toBe(bobBaseKey);
    } finally {
      await host.close();
    }
  });

  test('with deriveProductAccounts=true, product account is a different keypair', async ({ page }) => {
    const host = await createTestHostServer({
      productUrl: productServer.url,
      accounts: ['bob'],
      deriveProductAccounts: true,
    });

    try {
      const bobBaseKey = u8aToHex(keyring.addFromUri('//Bob').publicKey);
      // The product calls getProductAccount("test-product", 0),
      // so the derived path is //Bob//test-product/0
      const bobDerivedKey = u8aToHex(keyring.addFromUri('//Bob//test-product/0').publicKey);
      const productKey = await getProductPublicKey(page, host.url);

      expect(productKey).toBe(bobDerivedKey);
      expect(productKey).not.toBe(bobBaseKey);
    } finally {
      await host.close();
    }
  });
});

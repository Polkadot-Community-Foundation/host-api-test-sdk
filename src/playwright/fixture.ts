import type { Page, FrameLocator } from '@playwright/test';
import { createTestHostServer } from '../server.js';
import { DEFAULT_CHAIN } from '../chains.js';
import type { CreateTestHostOptions, DevAccountName, PermissionBehavior, PermissionLogEntry, SigningLogEntry, TestHostAPI } from '../types.js';

export interface TestHost {
  /** The host page (contains the iframe) */
  page: Page;

  /** FrameLocator for the embedded product iframe */
  productFrame(): FrameLocator;

  /** Dispose container and recreate with a single account (iframe reloads) */
  switchAccount(name: DevAccountName): Promise<void>;

  /** Dispose container and recreate with multiple accounts (iframe reloads) */
  setAccounts(names: DevAccountName[]): Promise<void>;

  /** All auto-signed payloads since last clear */
  getSigningLog(): Promise<SigningLogEntry[]>;

  /** Clear the signing log */
  clearSigningLog(): Promise<void>;

  /** Set how the host responds to remote permission requests */
  setPermissionBehavior(behavior: PermissionBehavior): Promise<void>;

  /** Get the log of all permission requests and their outcomes */
  getPermissionLog(): Promise<PermissionLogEntry[]>;

  /** Clear the permission log */
  clearPermissionLog(): Promise<void>;

  /** Wait until the product-sdk has connected to the host container */
  waitForConnection(timeout?: number): Promise<void>;
}

export interface TestHostFixtureOptions {
  /** URL of the product to test */
  productUrl: string;
  /** Initial accounts — dev names or custom { name, uri } (default: ['alice']) */
  accounts?: CreateTestHostOptions['accounts'];
  /** Chain config (default: PASEO_ASSET_HUB) */
  chain?: CreateTestHostOptions['chain'];
  /** Map product account requests to specific accounts (see CreateTestHostOptions.productAccounts) */
  productAccounts?: CreateTestHostOptions['productAccounts'];
}

export function createTestHostFixture(defaults: TestHostFixtureOptions) {
  return {
    testHost: async ({ page }: { page: Page }, use: (fixture: TestHost) => Promise<void>) => {
      const server = await createTestHostServer({
        productUrl: defaults.productUrl,
        accounts: defaults.accounts ?? ['alice'],
        chain: defaults.chain ?? DEFAULT_CHAIN,
        productAccounts: defaults.productAccounts,
      });

      await page.goto(server.url);

      // Wait for browser runtime to finish async init (cryptoWaitReady + container setup)
      await page.waitForFunction(() => !!window.__TEST_HOST__, { timeout: 30_000 });

      const testHost: TestHost = {
        page,

        productFrame() {
          return page.frameLocator('#product-frame');
        },

        async switchAccount(name: DevAccountName) {
          await page.evaluate((n) => window.__TEST_HOST__.switchAccount(n), name);
          // Wait for iframe to reload
          await page.frameLocator('#product-frame').locator('body').waitFor({ state: 'attached' });
        },

        async setAccounts(names: DevAccountName[]) {
          await page.evaluate((n) => window.__TEST_HOST__.setAccounts(n), names);
          await page.frameLocator('#product-frame').locator('body').waitFor({ state: 'attached' });
        },

        async getSigningLog() {
          return page.evaluate(() => window.__TEST_HOST__.getSigningLog());
        },

        async clearSigningLog() {
          await page.evaluate(() => window.__TEST_HOST__.clearSigningLog());
        },

        async setPermissionBehavior(behavior: PermissionBehavior) {
          await page.evaluate((b) => window.__TEST_HOST__.setPermissionBehavior(b), behavior);
        },

        async getPermissionLog() {
          return page.evaluate(() => window.__TEST_HOST__.getPermissionLog());
        },

        async clearPermissionLog() {
          await page.evaluate(() => window.__TEST_HOST__.clearPermissionLog());
        },

        async waitForConnection(timeout = 30_000) {
          await page.waitForFunction(
            () => window.__TEST_HOST__?.getConnectionStatus() === 'connected',
            { timeout },
          );
        },
      };

      await use(testHost);

      // Cleanup
      await page.evaluate(() => window.__TEST_HOST__?.dispose());
      await server.close();
    },
  };
}

// Augment Window type for Playwright evaluate calls
declare global {
  interface Window {
    __TEST_HOST__: TestHostAPI;
  }
}

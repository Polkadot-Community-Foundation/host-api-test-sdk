/**
 * Minimal product page for integration tests.
 *
 * Connects to the host via product-sdk, requests both product and
 * non-product accounts, and exposes the public keys in the DOM.
 *
 * Also exposes window.__TEST_PRODUCT__ with methods for permission
 * and signing E2E tests.
 */

import { createAccountsProvider, hostApi, sandboxTransport } from '@novasamatech/product-sdk';
import { enumValue } from '@novasamatech/host-api';
import { u8aToHex } from '@polkadot/util';

const DOTNS_ID = 'test-product.dot';
const DERIVATION_INDEX = 0;

interface TestResult {
  ok: boolean;
  approved?: boolean;
  signature?: string;
  error?: string;
}

/** Extract a readable error string from versioned protocol results. */
function extractError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as any;
  // Versioned: { tag: 'v1', value: { tag: 'Unknown', value: { reason: '...' } } }
  const inner = e.value ?? e;
  if (inner?.value?.reason) return inner.value.reason;
  if (inner?.reason) return inner.reason;
  if (typeof inner === 'string') return inner;
  return JSON.stringify(err);
}

declare global {
  interface Window {
    __TEST_PRODUCT__: {
      rootAddress: string | null;
      trySignRaw(): Promise<TestResult>;
      requestTransactionSubmit(): Promise<TestResult>;
      requestExternalRequest(url: string): Promise<TestResult>;
      requestDevicePermission(type: string): Promise<TestResult>;
    };
  }
}

async function init() {
  const el = document.getElementById('status')!;
  const pkEl = document.getElementById('product-key')!;
  const rootEl = document.getElementById('root-keys')!;

  try {
    const accountsProvider = createAccountsProvider(sandboxTransport);

    // Fetch product account
    const result = await accountsProvider.getProductAccount(DOTNS_ID, DERIVATION_INDEX);

    result.match(
      (acct: { publicKey: Uint8Array; name: string | undefined }) => {
        pkEl.textContent = u8aToHex(acct.publicKey);
        pkEl.dataset.ready = 'true';
        el.textContent = 'connected';
      },
      () => {
        el.textContent = 'no-account';
      },
    );

    // Fetch non-product (root) accounts
    let firstRootAddress: string | null = null;
    const rootResult = await accountsProvider.getNonProductAccounts();

    rootResult.match(
      (accounts: Array<{ publicKey: Uint8Array; name: string | undefined }>) => {
        const keys = accounts.map(a => u8aToHex(a.publicKey));
        rootEl.textContent = JSON.stringify(keys);
        rootEl.dataset.ready = 'true';
        if (keys.length > 0) firstRootAddress = keys[0];
      },
      () => {},
    );

    // Expose test actions for E2E permission/signing tests
    window.__TEST_PRODUCT__ = {
      rootAddress: firstRootAddress,

      async trySignRaw(): Promise<TestResult> {
        if (!firstRootAddress) return { ok: false, error: 'no address' };
        try {
          const r = await hostApi.signRaw(enumValue('v1', {
            address: firstRootAddress,
            data: { tag: 'Bytes' as const, value: new TextEncoder().encode('test-payload') },
          }));
          if (r.isOk()) {
            const val = r.value;
            return { ok: true, signature: val.value.signature };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async requestTransactionSubmit(): Promise<TestResult> {
        try {
          const r = await hostApi.permission(enumValue('v1', {
            tag: 'TransactionSubmit' as const,
            value: undefined,
          }));
          if (r.isOk()) {
            return { ok: true, approved: r.value.value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async requestExternalRequest(url: string): Promise<TestResult> {
        try {
          const r = await hostApi.permission(enumValue('v1', {
            tag: 'ExternalRequest' as const,
            value: url,
          }));
          if (r.isOk()) {
            return { ok: true, approved: r.value.value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async requestDevicePermission(type: string): Promise<TestResult> {
        try {
          const r = await hostApi.devicePermission(
            enumValue('v1', type as 'Camera' | 'Microphone' | 'Bluetooth' | 'Location'),
          );
          if (r.isOk()) {
            return { ok: true, approved: r.value.value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },
    };
  } catch (err) {
    el.textContent = `error: ${err}`;
  }
}

init();

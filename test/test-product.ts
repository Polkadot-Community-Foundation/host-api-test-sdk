/**
 * Minimal product page for integration tests.
 *
 * Connects to the host via product-sdk, requests both product and
 * non-product accounts, and exposes the public keys in the DOM.
 */

import { createAccountsProvider, sandboxTransport } from '@novasamatech/product-sdk';
import { u8aToHex } from '@polkadot/util';

const DOTNS_ID = 'test-product.dot';
const DERIVATION_INDEX = 0;

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
    const rootResult = await accountsProvider.getNonProductAccounts();

    rootResult.match(
      (accounts: Array<{ publicKey: Uint8Array; name: string | undefined }>) => {
        const keys = accounts.map(a => u8aToHex(a.publicKey));
        rootEl.textContent = JSON.stringify(keys);
        rootEl.dataset.ready = 'true';
      },
      () => {},
    );
  } catch (err) {
    el.textContent = `error: ${err}`;
  }
}

init();

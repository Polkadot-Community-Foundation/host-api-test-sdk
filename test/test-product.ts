/**
 * Minimal product page for integration tests.
 *
 * Connects to the host via product-sdk, requests a product account,
 * and exposes the public key in the DOM for Playwright assertions.
 */

import { createAccountsProvider, sandboxTransport } from '@novasamatech/product-sdk';
import { u8aToHex } from '@polkadot/util';

const DOTNS_ID = 'test-product';
const DERIVATION_INDEX = 0;

async function init() {
  const el = document.getElementById('status')!;
  const pkEl = document.getElementById('public-key')!;

  try {
    const accountsProvider = createAccountsProvider(sandboxTransport);

    const result = await accountsProvider.getProductAccount(DOTNS_ID, DERIVATION_INDEX);

    result.match(
      (acct: { publicKey: Uint8Array; name: string | undefined }) => {
        const hex = u8aToHex(acct.publicKey);
        pkEl.textContent = hex;
        pkEl.dataset.ready = 'true';
        el.textContent = 'connected';
      },
      () => {
        el.textContent = 'no-account';
      },
    );
  } catch (err) {
    el.textContent = `error: ${err}`;
  }
}

init();

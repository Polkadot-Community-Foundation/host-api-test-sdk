# @parity/host-api-test-sdk

[![CI](https://github.com/paritytech/host-api-test-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/paritytech/host-api-test-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@parity/host-api-test-sdk)](https://www.npmjs.com/package/@parity/host-api-test-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Lightweight test host for E2E testing embedded Polkadot dapps that use the Spektr host-container protocol (`@novasamatech/host-container`).

## Why

Products built with `@novasamatech/host-api-wrapper` (formerly `@novasamatech/product-sdk`) run inside an iframe and communicate with the host via `postMessage`. The SDK injects `window.injectedWeb3.spektr` only when it detects a real parent frame running `@novasamatech/host-container`.

To E2E test a product today you'd need the full triangle-web-host running — Next.js, React, wallet UI, DotNS, Service Workers. That's heavy and unnecessary for product tests.

This package gives you a **thin host page** that:

- Embeds your product in an iframe with the real Spektr protocol
- Injects dev accounts (Alice, Bob, ...) with known keypairs
- Auto-signs all extrinsic and raw signing requests — no popups
- Proxies chain RPC via WebSocket
- Exposes a control API for Playwright assertions (signing log, account switching)
- Handles remote permission requests (auto-approve by default, configurable per test)

No Docker, no React, no wallet UI. Just `pnpm add -D` and write tests.

## Install

```bash
pnpm add -D @parity/host-api-test-sdk
```

Both ESM (`import`) and CommonJS (`require`) are supported.

## Quick start with Playwright

```ts
// e2e/setup.ts
import { test as base, expect } from "@playwright/test";
import {
  createTestHostFixture,
  PASEO_ASSET_HUB,
} from "@parity/host-api-test-sdk/playwright";

const { testHost } = createTestHostFixture({
  productUrl: "http://localhost:3000",
  accounts: ["alice"],
  chain: PASEO_ASSET_HUB,
});

export const test = base.extend({ testHost });
export { expect };
```

```ts
// e2e/transfer.spec.ts
import { test, expect } from "./setup";

test("transfer flow", async ({ testHost }) => {
  const frame = testHost.productFrame();

  // Product receives Alice's account via Spektr protocol
  await expect(frame.getByText("Alice")).toBeVisible();

  // Interact with the product UI
  await frame.getByRole("button", { name: "Transfer" }).click();

  // Signing happens automatically — verify it was requested
  const log = await testHost.getSigningLog();
  expect(log).toHaveLength(1);
  expect(log[0].type).toBe("payload");
});

test("multi-account", async ({ testHost }) => {
  await testHost.switchAccount("bob");
  const frame = testHost.productFrame();
  await expect(frame.getByText("Bob")).toBeVisible();
});
```

## Usage without Playwright

The core server works with any test framework or manual browser testing:

```ts
import { createTestHostServer } from "@parity/host-api-test-sdk";

const server = await createTestHostServer({
  productUrl: "http://localhost:3000",
  accounts: ["alice", "bob"],
});

console.log("Open in browser:", server.url);
// → http://127.0.0.1:43210

// Cleanup when done
await server.close();
```

## Custom chain config

For public testnets, use the built-in chain configs:

```ts
import { PASEO_ASSET_HUB, PREVIEWNET } from "@parity/host-api-test-sdk";

const server = await createTestHostServer({
  productUrl: "http://localhost:3000",
  chain: PASEO_ASSET_HUB,
});
```

For local networks where the genesis hash changes on each restart, construct a `ChainConfig` directly:

```ts
import { createTestHostServer } from "@parity/host-api-test-sdk";
import type { ChainConfig } from "@parity/host-api-test-sdk";

const chain: ChainConfig = {
  id: "local-asset-hub",
  name: "Local Asset Hub",
  genesisHash: process.env.GENESIS_HASH as `0x${string}`,
  rpcUrl: "ws://127.0.0.1:9944",
  tokenSymbol: "WND",
  tokenDecimals: 12,
};

const server = await createTestHostServer({
  productUrl: "http://localhost:3000",
  chain,
});
```

## Permission testing

The test host auto-approves all remote permission requests by default. You can change this per test to verify your product handles rejections correctly:

```ts
test("handles permission rejection", async ({ testHost }) => {
  // Reject all permission requests
  await testHost.setPermissionBehavior("reject-all");

  const frame = testHost.productFrame();
  await frame.getByRole("button", { name: "Connect external" }).click();

  // Product should show an error or fallback UI
  await expect(frame.getByText("Permission denied")).toBeVisible();

  // Verify the request was made and rejected
  const log = await testHost.getPermissionLog();
  expect(log).toHaveLength(1);
  expect(log[0].tag).toBe("Remote");
  expect(log[0].approved).toBe(false);
});

test("selective permissions", async ({ testHost }) => {
  // Custom logic: approve ChainSubmit, reject Remote
  await testHost.setPermissionBehavior(
    (tag) => tag === "ChainSubmit"
  );

  // ... test product behavior ...
});
```

Without the Playwright fixture, use `page.evaluate` directly:

```ts
await page.evaluate(() =>
  window.__TEST_HOST__.setPermissionBehavior("reject-all")
);

const log = await page.evaluate(() =>
  window.__TEST_HOST__.getPermissionLog()
);
```

### What `permissionLog` records (and what it doesn't)

The permission log is narrower than the name suggests. It records **only explicit `hostApi.permission(...)` calls** — RemotePermission requests the product makes before signing or accessing a feature. It does **not** record:

- **Signing requests** (`hostApi.signPayload` / `signRaw`). Signing is not gated behind a permission at the test-sdk level — that's a deliberate match with real hosts (the previous "ChainSubmit gates signing" behavior was reverted in 0.7.1). Use `getSigningLog()` as the oracle for "did signing happen".
- **Transaction broadcast denials.** `ChainSubmit` is enforced inside `host-container` at the `transaction_broadcast` level, after signing. The container handles this internally; it never reaches the test-sdk's `handlePermission`, so it doesn't land in `permissionLog`. The current canonical oracle for "broadcast was denied" is whatever error your product surfaces in the UI; there's no test-sdk observable for it yet.

A typical flow:

```
product → hostApi.permission(ChainSubmit) → handlePermission → permissionLog ✅
product → hostApi.signPayload(...)        → handleSignPayload → signingLog   ✅
product → submit signed bytes              → container's broadcast gate       ❌ invisible
```

If your test is asserting "permission rejected mid-session prevented submission", check the product's error UI rather than the permission log.

## How it works

```
Playwright test
  → createTestHostServer() starts a Node HTTP server
  → serves a single HTML page with an inlined browser bundle
  → the page creates an <iframe src="productUrl">
  → host-container establishes Spektr postMessage channel
  → registers handlers: accounts, signing, chain RPC, localStorage

Product (in iframe)
  → host-api-wrapper detects iframe parent
  → injects window.injectedWeb3.spektr
  → gets accounts (Alice/Bob with real sr25519 public keys)
  → signing requests → host auto-signs with dev keypair → returns signature
```

The browser bundle (~780KB minified) includes `@novasamatech/host-container`, `@polkadot/keyring`, `@polkadot/types`, and WASM crypto. It's pre-built and inlined — consumers have zero build-time dependencies.

## API reference

### Fixture API (`@parity/host-api-test-sdk/playwright`)

| Method | Description |
|--------|-------------|
| `testHost.productFrame()` | Playwright `FrameLocator` for the product iframe |
| `testHost.switchAccount(name)` | Recreate container with a single account (iframe reloads) |
| `testHost.setAccounts(names)` | Recreate container with multiple accounts |
| `testHost.getSigningLog()` | All auto-signed payloads since last clear |
| `testHost.clearSigningLog()` | Reset the signing log |
| `testHost.setPermissionBehavior(behavior)` | Set permission response: `'approve-all'`, `'reject-all'`, or `(tag, value) => boolean` |
| `testHost.getPermissionLog()` | All permission requests and outcomes since last clear |
| `testHost.clearPermissionLog()` | Reset the permission log |
| `testHost.waitForConnection(timeout?)` | Wait for host-api-wrapper to connect |

### Dev accounts

| Name | URI | SS58 (generic) |
|------|-----|-----------------|
| `alice` | `//Alice` | `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY` |
| `bob` | `//Bob` | `5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty` |
| `charlie` | `//Charlie` | `5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y` |
| `dave` | `//Dave` | `5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy` |
| `eve` | `//Eve` | `5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw` |
| `ferdie` | `//Ferdie` | `5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSneWj6JDfPN` |

These are standard Substrate dev accounts (sr25519, ss58Format=42). Products may re-encode them to a different SS58 prefix — the host matches by public key.

Both `accounts` and `productAccounts` accept dev account names or custom `{ name, uri }` objects. The `uri` is any [Substrate URI](https://polkadot-js.github.io/docs/keyring/start/suri/) — dev paths, mnemonics, or hex seeds:

```ts
createTestHostFixture({
  productUrl: 'http://localhost:3000',
  accounts: [
    'bob',
    { name: 'From mnemonic', uri: 'word1 word2 word3 ... word12' },
    { name: 'Derived', uri: '//Alice//custom/0' },
  ],
});
```

> **Product accounts**: In production, `host-api-wrapper` derives a unique keypair per product via `getProductAccount(dotnsId, index)`. By default the test host does the same derivation. Use `productAccounts` to map specific identities to funded dev accounts:
>
> ```ts
> createTestHostFixture({
>   productUrl: 'http://localhost:3000',
>   accounts: ['bob'],
>   productAccounts: {
>     'myapp.dot/0': 'bob',      // main account → //Bob (funded)
>     'myapp.dot/2': 'charlie',  // secondary → //Charlie (funded)
>     'myapp.dot/5': { name: 'Custom', uri: '//My//Custom' },
>   },
> });
> ```
>
> Unmapped identities fall back to production-style derivation (`//Bob//dotnsId/index`). If `accounts: []` (unsigned host), unmapped `getProductAccount` / `getProductAccountAlias` calls return `err(RequestCredentialsErr.NotConnected)`, matching `polkadot-desktop`. Pre-mapped entries in `productAccounts` are still served.

### Built-in chains

| Chain | Export |
|-------|--------|
| Paseo Asset Hub | `PASEO_ASSET_HUB` |
| Previewnet | `PREVIEWNET` |
| Previewnet Asset Hub | `PREVIEWNET_ASSET_HUB` |

### Account switching

Product-sdk's `accounts.subscribe()` is one-shot. Changing accounts requires disposing the container and recreating it, which reloads the iframe. This matches how production hosts work. For multi-actor tests, prefer `setAccounts(['alice', 'bob'])` upfront and use the product's own account selector.

## Contributing

Contributions are welcome! Please open an issue first if you want to discuss a larger change.

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 10

### Development

```bash
# Install dependencies
pnpm install

# Build everything (browser bundle + TypeScript + CJS bundles)
pnpm run build

# Run tests (ESM + CJS export verification)
pnpm test

# Typecheck without emitting
pnpm run typecheck
```

### Project structure

```
src/
├── index.ts                  # Main entry point
├── types.ts                  # Shared type definitions
├── server.ts                 # Node HTTP server
├── accounts.ts               # Dev account definitions
├── chains.ts                 # Built-in chain configs
├── host-page.ts              # HTML page generation
├── browser/
│   └── host-runtime.ts       # Browser runtime (bundled into IIFE)
└── playwright/
    ├── index.ts              # Playwright entry point
    └── fixture.ts            # Playwright test fixture
```

The build produces three outputs:

1. **Browser bundle** (`dist/host-bundle.js`) — IIFE built with esbuild, inlined into the host page at runtime
2. **ESM modules** (`dist/*.js`) — TypeScript compiled with `tsc`
3. **CJS bundles** (`dist/*.cjs`) — bundled with esbuild for CommonJS compatibility

## Migrating from 0.1.x to 0.2.x

The env file utilities (`loadChainFromEnv`, `parseEnvFile`, `loadEnvFiles`) have been removed. If you used them, construct a `ChainConfig` directly:

```diff
-import { createTestHostServer, loadChainFromEnv } from "@parity/host-api-test-sdk";
-const chain = loadChainFromEnv({ envFiles: [".env.local"], ... });
+import { createTestHostServer } from "@parity/host-api-test-sdk";
+import type { ChainConfig } from "@parity/host-api-test-sdk";
+const chain: ChainConfig = {
+  id: "local-asset-hub",
+  name: "Local Asset Hub",
+  genesisHash: process.env.GENESIS_HASH as `0x${string}`,
+  rpcUrl: "ws://127.0.0.1:9944",
+  tokenSymbol: "WND",
+  tokenDecimals: 12,
+};
```

If you only used built-in chains (`PASEO_ASSET_HUB`, etc.) and `createTestHostFixture` — no changes needed.

## License

[MIT](./LICENSE)

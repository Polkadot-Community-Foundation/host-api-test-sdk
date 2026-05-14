# Changelog

## 0.8.0

### Breaking changes

- **`handleCreateTransaction` request shape** — upstream `0.7.9-x` rewrote `host_create_transaction`. The request is now a flat `ProductAccountTransaction` object instead of a `[ProductAccountId, VersionedPublicTxPayload]` tuple, with no versioned envelope around the inner payload:

  ```ts
  // 0.7.6 (old)
  container.handleCreateTransaction(([[dotnsId, idx], payload], { ok }) => ok(payload.callData));

  // 0.8.0 (new)
  container.handleCreateTransaction((params, { ok }) => ok(params.callData));
  // params: { signer: [dotnsId, idx], genesisHash: Uint8Array, callData: Uint8Array,
  //          extensions: { id, extra: Uint8Array, additionalSigned: Uint8Array }[], txExtVersion }
  ```

  The `context` field (`metadata`, `tokenSymbol`, `tokenDecimals`, `bestBlockHeight`) is gone — `genesisHash` replaces it as the only top-level chain hint. All hex fields are now `Uint8Array`.

- **`handleCreateTransactionWithLegacyAccount` request shape** — same flattening. `params.signer` is now `Uint8Array` (a 32-byte AccountId) instead of an SS58 string.

- **Removed exports** — upstream removed `VersionedPublicTxPayload` / `TxPayloadV1Public`. New types: `LegacyTransaction`, `ProductAccountTransaction`.

### Changed

- **Dependencies** — `@novasamatech/host-api`, `host-container`, `product-sdk` → `0.7.9-4` (pinned, not caret, because `^0.7.9-4` would float through subsequent prereleases). Upstream did not publish a `CHANGELOG.md` entry for any `0.7.9-N`; this entry was reconstructed from the commit log.

### Other upstream changes (no SDK-facing impact)

- `feat: Remove attestation service and simplify auth flow` — SSO auth simplification on the paired-app side.
- `fix: backward-compatibility flag in product-sdk accounts provider`.
- `Rename product-sdk to host-api-wrapper (#169)` — internal package rename. `@novasamatech/product-sdk@0.7.9-4` still ships under the old name; `0.7.9-5` is the last prerelease and switches to `@novasamatech/host-api-wrapper`.

## 0.7.6

### Fixed

- **`PASEO_ASSET_HUB`** — `genesisHash` and `rpcUrl` updated to Paseo Asset Hub v2. The previous values pointed at Paseo Next v1, deprecated 2026-05-20.
- **`PREVIEWNET`** and **`PREVIEWNET_ASSET_HUB`** — `genesisHash` refreshed against live RPC. The previous values were stale from prior redeployments and no longer matched what the chains return.

All three values verified live via `chain_getBlockHash[0]`. The downstream `paritytech/product-sdk` e2e suite went from 9 failures (`chain-client-demo`, `contracts-demo`, `tx-demo`) to all green after the bump.

## 0.7.5

### Added

- **`handleCreateTransaction`** — creates transactions for product accounts. Returns the call data for test assertions.
- **`handleAccountCreateProof`** — creates Ring VRF proofs for product accounts. Signs the message with sr25519 for test purposes.
- **Integration tests** — 12 new tests covering theme subscribe, entropy derivation, login/getUserId, resource allocation, feature check, local storage, statement store proof, create transaction, and account create proof. Total: 46 integration tests (up from 34).

### Changed

- **Dependencies** — `@novasamatech/host-api`, `host-container`, `product-sdk` → ^0.7.8 (identity fixes, bulletin package).

## 0.7.4

### Added

- **`handleRequestResourceAllocation`** (RFC-0010) — products can request resource allowances (StatementStoreAllowance, BulletInAllowance, SmartContractAllowance, AutoSigning). The test host auto-allocates all requested resources.
- **`handleStatementStoreCreateProofAuthorized`** — creates statement proofs using the host-internal allowance account (no product account required). Uses the first configured account.

### Changed

- **Dependencies** — `@novasamatech/host-api`, `host-container`, `product-sdk` → ^0.7.7. Upstream changes include RFC-0010 resource allocation, authorized statement proofs, SSO signer fixes, and reconnect improvements.

## 0.7.3

### Breaking changes

- **`handleAccountGetRoot` replaced by `handleGetUserId`** — upstream 0.7.4 renamed this method (RFC-0014: Get User Primary DotNS Name). Returns `{ primaryUsername: string }` instead of `{ publicKey, name }`. Error type changed from `RequestCredentialsErr` to `GetUserIdErr`.

### Changed

- **Dependencies** — `@novasamatech/host-api`, `host-container`, `product-sdk` → ^0.7.4. Upstream changes include the `host_get_user_id` method (RFC-0014), sign method ABI ordering fix, and transport message parsing optimization.
- **CI runners** — `parity-default` with `corepack enable`.

## 0.7.2

### Fixed

- **Permission handler uses single `RemotePermission`** — upstream 0.7.2 refined the spec to use a single `RemotePermission` per request (not batched array). The test host now matches.

### Changed

- **Dependencies** — `@novasamatech/host-api`, `host-container`, `product-sdk` → ^0.7.2. Upstream changes include ABI-stable method ordering, notification permission gate, and restored deprecated JSON-RPC methods for backward compatibility.

## 0.7.1

### Fixed

- **Signing no longer gated behind `ChainSubmit` permission** — in v0.7.0 the test host incorrectly required `ChainSubmit` before signing. Real Spektr hosts don't do this — `ChainSubmit` is enforced by the container at the `transaction_broadcast` level, not at signing. Signing now works without any prior permission request, matching production behavior.

### Changed

- **CI runners** — switched to `parity-default`, added `corepack enable` for pnpm.

## 0.7.0

### Breaking changes

- **Permission renames** — `TransactionSubmit` → `ChainSubmit`, `ExternalRequest` → `Remote`. Signing enforcement now checks `ChainSubmit`. `handlePermission` receives `RemotePermission[]` (batched) instead of a single permission.
- **Signing uses `ProductAccountId`** — `handleSignPayload` and `handleSignRaw` receive `{ account: [dotnsId, derivationIndex], payload }` instead of `{ address, data }`.
- **Legacy account rename** — `handleGetNonProductAccounts` → `handleGetLegacyAccounts`. New handlers: `handleSignPayloadWithLegacyAccount`, `handleSignRawWithLegacyAccount`, `handleCreateTransactionWithLegacyAccount`.
- **Statement store subscribe** — takes `TopicFilter` (`{ tag: 'MatchAll' | 'MatchAny', value: Topic[] }`) instead of `Topic[]`. Delivers `SignedStatementsPage` (`{ statements, isComplete }`) instead of raw arrays.
- **Device permissions expanded** — 9 variants: Camera, Microphone, Location, Bluetooth, Notifications, NFC, Clipboard, OpenUrl, Biometrics.
- **polkadot-api v2** — `polkadot-api/ws-provider` import changed to `polkadot-api/ws`.

### Migration from 0.6.x

Permission names:
```diff
-await testHost.grantPermission('TransactionSubmit');
+await testHost.grantPermission('ChainSubmit');
```

Permission log assertions:
```diff
-expect(log.some(e => e.tag === 'TransactionSubmit')).toBe(true);
+expect(log.some(e => e.tag === 'ChainSubmit')).toBe(true);
```

### Added

#### Theme (RFC-0007)
- `handleThemeSubscribe` — products subscribe to host theme changes (`'light'` / `'dark'`).
- `getTheme()` / `setTheme(theme)` — test controls.

#### Entropy derivation (RFC-0007)
- `handleDeriveEntropy` — deterministic 32-byte entropy from a caller key, using the three-layer BLAKE2b-256 scheme via `deriveProductEntropy` from `@novasamatech/host-container`.

#### Root account access (RFC-0010)
- `handleAccountGetRoot` — returns the first configured account as the root DotNS-linked account.

#### Login flow (RFC-0009)
- `handleRequestLogin` — products trigger the host login flow. Simulates auth state.
- `setLoginBehavior(behavior)` — `'success'` / `'reject'` / custom function.
- `getIsAuthenticated()` / `simulateDisconnect()` / `simulateReconnect()` — test controls.

#### Payment API (RFC-0006)
- `handlePaymentBalanceSubscribe`, `handlePaymentTopUp`, `handlePaymentRequest`, `handlePaymentStatusSubscribe` — in-memory payment state.
- `setPaymentBalance(amount)` / `getPaymentLog()` / `clearPaymentLog()` / `simulatePaymentStatus(id, status)` — test controls.

#### Types
- **New exported types**: `LoginBehavior`, `PaymentLogEntry`

### Changed

- **Dependencies** — `@novasamatech/host-api`, `host-container`, `product-sdk` → 0.7.0; `polkadot-api` → ^2.0.0.
- **Integration tests updated** — all 36 tests pass against the v0.7 protocol.

## 0.6.0

### Added

#### Navigation, notifications, account alias
- **Navigation handler** — `handleNavigateTo` records `hostApi.navigateTo(url)` calls in a log without actually navigating. Inspect via `getNavigationLog()` / `clearNavigationLog()`.
- **Push notification handler** — `handlePushNotification` records `hostApi.pushNotification({ text, deeplink })` calls. Inspect via `getNotificationLog()` / `clearNotificationLog()`.
- **Account alias handler** — `handleAccountGetAlias` returns a deterministic `(context, alias)` pair derived from the account public key via BLAKE2b-256. Stable across runs for a given account.

#### Chat
- **Chat handlers** — `handleChatCreateRoom`, `handleChatBotRegistration`, `handleChatListSubscribe`, `handleChatPostMessage`, `handleChatActionSubscribe`. In-memory rooms/bots/messages. Inspect via `getChatRooms()`, `getChatBots()`, `getChatMessageLog()`.
- `injectChatAction({ roomId, peer, payload })` — simulate an incoming message from a peer.
- `clearChatState()` — wipe all chat state.

#### Preimage store
- **Preimage handlers** — `handlePreimageSubmit` stores the value and returns its BLAKE2b-256 key. `handlePreimageLookupSubscribe` delivers the value (or `null`) when queried, and notifies subscribers when a new preimage matching their key is submitted.
- `seedPreimage(value)` — pre-populate the store from tests; returns the computed key.
- `getPreimages()` / `clearPreimages()` — inspect or reset the store.

#### Statement store
- **Statement store handlers** — `handleStatementStoreSubscribe`, `handleStatementStoreCreateProof`, `handleStatementStoreSubmit`. In-memory statement storage with topic-based subscription filtering. Product accounts sign via sr25519 for `createProof`.
- `getSubmittedStatements()` — log of what the product has submitted.
- `injectStatement(statement)` — deliver a statement to matching subscribers without going through submit.
- `clearStatements()` — reset all statement state.

#### Types
- **New exported types**: `NavigationLogEntry`, `NotificationLogEntry`, `ChatRoom`, `ChatBot`, `ChatMessageLogEntry`, `PreimageEntry`, `StatementSubmissionLogEntry`

### Changed

- **Per-session state reset** — permission grants, navigation log, notification log, chat state, preimages, and statement store are now cleared on container recreation (e.g. `setAccounts`), matching real host session behavior.

## 0.5.0

### Breaking changes

- **Signing now requires `TransactionSubmit` permission** — matching real host behavior (polkadot-desktop, dot.li). Products must call `hostApi.permission({ tag: 'TransactionSubmit' })` before signing, otherwise the signing request will fail with a clear error. This catches products that skip the permission step — tests that passed before may now fail if the product wasn't requesting permission correctly.
- **Device permissions now handled** — `handleDevicePermission` responds to Camera, Microphone, Location, and Bluetooth requests. When granted, the iframe `allow` attribute is updated with the corresponding Permissions Policy directive (matching dot.li). Products that don't request device permissions before using browser APIs will be blocked by the browser itself.

### Migration from 0.4.x

If your product already requests `TransactionSubmit` permission before signing, no changes needed.

If your tests break, you have two options:

**Option A** — fix the product (recommended): ensure your product calls `hostApi.permission({ tag: 'TransactionSubmit' })` before signing. This is what real hosts require.

**Option B** — opt out of enforcement temporarily:
```ts
// In Playwright fixture
await testHost.setEnforcePermissions(false);

// Or via page.evaluate
await page.evaluate(() => window.__TEST_HOST__.setEnforcePermissions(false));
```

### Added

- `grantPermission(tag)` / `revokePermission(tag)` — pre-grant or revoke permissions from tests without the product requesting them
- `getGrantedPermissions()` — inspect currently granted permissions
- `setEnforcePermissions(enforce)` — enable/disable permission enforcement on signing

## 0.4.0

### Added

- **`productAccounts` option** — maps product account requests (`"dotnsId/index"`) to specific accounts. Lets you point derived product accounts at funded dev accounts without changing the derivation logic. Unmapped identities fall back to production-style derivation (`//Bob//dotnsId/index`).
  ```ts
  productAccounts: {
    'myapp.dot/0': 'bob',
    'myapp.dot/2': { name: 'Custom', uri: '//My//Path' },
  }
  ```
- **Custom accounts everywhere** — `accounts` (root) and `productAccounts` now accept `{ name, uri }` objects in addition to dev account names, so you can use arbitrary Substrate URIs (derivation paths, mnemonics, hex seeds).
  ```ts
  accounts: ['bob', { name: 'From mnemonic', uri: 'word1 word2 ... word12' }]
  ```
- **Playwright integration tests** — verifies product account derivation and `productAccounts` mapping end-to-end with a real product in an iframe.

## 0.3.0

### Added

- **Permission handling** — the test host now handles `remote_permission` requests from the product. By default all permissions are auto-approved, matching the existing auto-sign behavior. Products can control this with:
  - `setPermissionBehavior('approve-all' | 'reject-all' | fn)` — configure approve/reject/custom logic
  - `getPermissionLog()` — inspect permission requests and their outcomes
  - `clearPermissionLog()` — reset the log between tests
- **New exported types**: `PermissionBehavior`, `PermissionLogEntry`

### Changed

- **Updated `@novasamatech/host-api` and `@novasamatech/host-container`** from `0.6.6-1` to `0.6.15`

## 0.2.0

### Breaking changes

- **Removed `loadChainFromEnv`, `parseEnvFile`, `loadEnvFiles`** — env file utilities have been removed. Construct a `ChainConfig` object directly using your project's own env loading (`process.env`, Vite, dotenv, etc.). See the [Custom chain config](./README.md#custom-chain-config) section in the README.
- **`HexString` is now re-exported from `@novasamatech/host-api`** — structurally identical (`0x${string}`), no code changes needed.
- **`@novasamatech/host-api` moved to `dependencies`** — installed automatically, no action required.

### Added

- **`TestHostAPI` type** — exported from both `.` and `./playwright` entry points. Describes the `window.__TEST_HOST__` control API shape.

### Fixed

- `chainStatus` now correctly starts as `'idle'` and transitions to `'connected'` when the chain handler is actually called (was incorrectly set to `'connected'` immediately on provider creation).

### Migration from 0.1.x

If you used env utilities, replace them with your own env loading:

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

## 0.1.0

Initial release.

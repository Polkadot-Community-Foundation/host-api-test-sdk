# host-api-test-sdk 0.4.0

## Product account mapping

New `productAccounts` option maps `getProductAccount(dotnsId, index)` requests to specific accounts. Unmapped identities use production-style derivation.

```ts
createTestHostFixture({
  productUrl: "http://localhost:3000",
  accounts: ["bob"],
  productAccounts: {
    "myapp.dot/0": "bob", // → //Bob (funded)
    "myapp.dot/2": "charlie", // → //Charlie (funded)
    "myapp.dot/5": { name: "Custom", uri: "//My//Path" },
  },
});
```

## Custom accounts

`accounts` (root) and `productAccounts` now accept `{ name, uri }` objects — any Substrate URI that `@polkadot/keyring.addFromUri()` supports (dev paths, mnemonics, hex seeds).

```ts
createTestHostFixture({
  productUrl: "http://localhost:3000",
  accounts: [
    "bob",
    { name: "From mnemonic", uri: "word1 word2 word3 ... word12" },
  ],
});
```

## Integration tests

Added Playwright tests that verify product account derivation and mapping end-to-end with a real product in an iframe.

---

# host-api-test-sdk 0.5.0

## Permission enforcement (breaking change)

The test host previously auto-approved all permission requests silently. This meant products that forgot to call `hostApi.permission()` before signing would pass E2E tests but fail in production — real hosts (polkadot-desktop, dot.li) require `TransactionSubmit` to be granted before signing works.

Now the test host enforces this too. Signing without a prior `TransactionSubmit` permission grant fails with `SigningErr::PermissionDenied`.

Products that already request permissions correctly are unaffected. For tests that don't exercise the permission flow, there's an escape hatch:

```ts
await testHost.setEnforcePermissions(false);
```

## Device permissions

The test host now handles `handleDevicePermission` requests (Camera, Microphone, Location, Bluetooth). When granted, the iframe `allow` attribute is updated with the corresponding Permissions Policy directive, matching how dot.li enforces device access at the browser level.

## Permission control API

Tests can pre-grant, revoke, and inspect permissions:

```ts
// Pre-grant without product requesting
await testHost.grantPermission("TransactionSubmit");

// Revoke a grant
await testHost.revokePermission("TransactionSubmit");

// Inspect granted set
const granted = await testHost.getGrantedPermissions();

// Reject all permission requests
await testHost.setPermissionBehavior("reject-all");

// Check what was requested
const log = await testHost.getPermissionLog();
```

## Updated dependencies

`@novasamatech/host-api`, `@novasamatech/host-container`, and `@novasamatech/product-sdk` updated to `0.6.17`.

---

# host-api-test-sdk 0.6.0

Most of the Spektr host surface is now testable. Product authors can write E2E tests that exercise the full product-to-host protocol without mocking — the test host answers each protocol call and records what happened for assertions.

## What's newly testable

**Navigation** — when a product calls `hostApi.navigateTo(url)` (opening another product, external link, or a deeplink), the test host records it instead of navigating. Tests can assert exactly what the product tried to navigate to.

**Push notifications** — `hostApi.pushNotification({ text, deeplink })` is recorded with its text and optional deeplink. Useful for testing flows that notify the user after an action completes.

**Account alias (Ring VRF)** — `hostApi.accountGetAlias(dotnsId, index)` returns a stable, deterministic alias per account. Same account → same alias across test runs, different accounts → different aliases.

**Chat** — create rooms, register bots, post messages, subscribe to the room list, and subscribe to incoming actions. All backed by an in-memory store. Tests can inspect rooms/bots/messages and inject incoming peer messages to exercise reception flows.

**Preimages** — products can submit preimages (they get back the blake2b-256 key) and subscribe to lookup a preimage by key. Tests can seed the store ahead of time or observe what products submit.

**Statement store** — products can subscribe to statements filtered by topics, create proofs signed with their product account (real sr25519 signatures), and submit signed statements. Tests can inject statements to simulate incoming activity and inspect what products submitted.

## Cleaner state between tests

Permission grants, activity logs (navigation, notifications), chat state, preimages, and statement store entries are now all cleared whenever the container is recreated (e.g. when a test switches accounts). Each session starts fresh, matching real host behavior.

---

# host-api-test-sdk 0.7.0

Follows `@novasamatech/*` 0.7.0 release. This is a **breaking change** release — test code that references the old permission names or signing API will need updating.

## Breaking changes

**Permission renames** — `TransactionSubmit` is now `ChainSubmit`. The test host enforces `ChainSubmit` for signing. If your tests pre-grant or assert `TransactionSubmit`, rename it:

```ts
// before
await testHost.grantPermission("TransactionSubmit");
// after
await testHost.grantPermission("ChainSubmit");
```

`ExternalRequest` is replaced by `Remote` — the host API now accepts batched permission requests with domain patterns instead of single URLs.

**Legacy account rename** — `getNonProductAccounts` and friends are now `getLegacyAccounts`, `getLegacyAccountSigner`, `createTransactionWithLegacyAccount`. The test host handler is `handleGetLegacyAccounts`.

**Signing uses ProductAccountId** — `handleSignPayload` and `handleSignRaw` now receive `{ account: [dotnsId, derivationIndex], payload: ... }` instead of `{ address: string, data: ... }`. Legacy address-based signing is available via the new `handleSignPayloadWithLegacyAccount` and `handleSignRawWithLegacyAccount` handlers.

**Statement store subscribe** — the subscribe API now takes a `TopicFilter` (`{ matchAll: Topic[] }` or `{ matchAny: Topic[] }`) instead of a flat `Topic[]` array, and delivers `SignedStatementsPage` objects (`{ statements, isComplete }`) instead of raw arrays.

**Device permissions expanded** — 9 variants now: Camera, Microphone, Location, Bluetooth, Notifications, NFC, Clipboard, OpenUrl, Biometrics.

## New features

**Theme** — products can subscribe to host theme changes (light/dark). Tests can drive it:

```ts
// switch theme and verify the product reacts
await testHost.setTheme("dark");
const theme = await testHost.getTheme(); // "dark"

// product side (via product-sdk)
const themeProvider = createThemeProvider();
themeProvider.subscribeTheme((theme) => {
  document.body.className = theme; // "light" | "dark"
});
```

**Entropy derivation (RFC-0007)** — deterministic 32-byte entropy from a caller key, product-scoped. Same key always produces the same output on any conforming host. Useful for deriving stable keypairs (e.g. X25519 for encrypted messaging) without storing secrets product-side.

```ts
// product side
import { deriveEntropy } from "@novasamatech/product-sdk";

const key = new TextEncoder().encode("my-x25519-key");
const result = await deriveEntropy(key);
result.match(
  (entropy) => console.log("32 bytes:", entropy), // Uint8Array(32)
  (err) => console.error(err),
);

// test side — entropy is deterministic, so you can derive the expected
// value and assert the product used it correctly
```

**Root account access (RFC-0010)** — products can request the user's primary DotNS-linked account. The test host returns the first configured account. Uses JIT permission — the host prompts the user on first call.

```ts
// product side
const accountsProvider = createAccountsProvider();
const root = await accountsProvider.getRootAccount();
root.match(
  (account) => console.log(account.name, toHex(account.publicKey)),
  (err) => console.error(err), // Rejected | NotConnected
);
```

**Login flow (RFC-0009)** — products can load without requiring login, then trigger it explicitly when the user wants to act. The test host simulates auth state so you can test both unauthenticated and authenticated flows:

```ts
// simulate unauthenticated state
await testHost.simulateDisconnect();

// product calls requestLogin — test host can approve or reject
await testHost.setLoginBehavior("success");
// or reject:  await testHost.setLoginBehavior("reject");
// or custom:  await testHost.setLoginBehavior((reason) => reason === "purchase");

// product side
const result = await accountsProvider.requestLogin("Please sign in to purchase");
// result: "success" | "alreadyConnected" | "rejected"

// restore auth
await testHost.simulateReconnect();
```

**Payment API (RFC-0006)** — balance subscribe, top-up, payment request, and status tracking. All backed by in-memory state with test controls:

```ts
// seed a balance before the product loads
await testHost.setPaymentBalance(1_000_000_000_000n);

// product side
const pm = createPaymentManager();

pm.subscribeBalance((balance) => {
  console.log("Available:", balance.available); // bigint
});

await pm.topUp(500_000_000_000n, {
  type: "productAccount",
  dotNsIdentifier: "myapp.dot",
  derivationIndex: 0,
});

const receipt = await pm.requestPayment(100_000_000_000n, destinationAccountId);
console.log("Payment ID:", receipt.id);

// test side — inspect what happened
const log = await testHost.getPaymentLog();
// [{ type: "top-up", amount: 500000000000n, ... }, { type: "request", amount: 100000000000n, paymentId: "pay-1", ... }]

// simulate a payment failure for edge-case testing
await testHost.simulatePaymentStatus("pay-1", { tag: "Failed", value: "insufficient gas" });
```

## Updated dependencies

- `@novasamatech/host-api`, `host-container`, `product-sdk` → 0.7.0
- `polkadot-api` → ^2.0.0

---

# host-api-test-sdk 0.7.1 – 0.7.3

Follow-up fixes tracking upstream `@novasamatech/*` 0.7.1–0.7.4 changes.

## 0.7.1 — Signing permission fix

Signing (`handleSignPayload`, `handleSignRaw`) was incorrectly gated behind `ChainSubmit` permission. Real Spektr hosts don't do this — `ChainSubmit` is enforced by the container at the `transaction_broadcast` level, not at signing. Fixed: signing now works without any prior permission request.

## 0.7.2 — Permission format fix

Upstream 0.7.2 changed `handlePermission` from batched (`RemotePermission[]`) back to a single `RemotePermission` per request. The test host now matches.

## 0.7.3 — User identity (RFC-0014)

Upstream 0.7.4 replaced `handleAccountGetRoot` with `handleGetUserId` (RFC-0014: Get User Primary DotNS Name). The new method returns `{ primaryUsername: string }` instead of `{ publicKey, name }`.

```ts
// The test host returns the first account's name as primaryUsername
// Product side:
const result = await accountsProvider.getUserId();
result.match(
  (id) => console.log(id.primaryUsername), // e.g. "Alice"
  (err) => console.error(err),
);
```

Updated dependencies: `@novasamatech/*` → ^0.7.4.

---

# host-api-test-sdk 0.7.4

## Resource allocation (RFC-0010)

Products can now request resource allowances from the host — statement store, bulletin, smart contract, and auto-signing. The test host auto-allocates all requested resources.

```ts
// product side
const result = await hostApi.requestResourceAllocation({
  tag: "v1",
  value: [
    { tag: "StatementStoreAllowance", value: undefined },
    { tag: "BulletInAllowance", value: undefined },
    { tag: "SmartContractAllowance", value: 0 },  // derivation index
    { tag: "AutoSigning", value: undefined },
  ],
});
// Each resource gets an outcome: Allocated | Rejected | NotAvailable
```

## Authorized statement proofs

`handleStatementStoreCreateProofAuthorized` creates statement proofs using the host's internal allowance account — no product account ID required. Useful for products that obtained a StatementStoreAllowance via resource allocation.

## Updated dependencies

`@novasamatech/*` → ^0.7.7.

---

# host-api-test-sdk 0.7.5

## Full handler coverage

Two previously missing handlers are now implemented:

- **`handleCreateTransaction`** — product accounts can create transactions. The test host returns the call data as-is for assertions.
- **`handleAccountCreateProof`** — Ring VRF proof creation. The test host signs the message with the product account's sr25519 key as a stand-in for actual ring VRF.

The only remaining unimplemented handler is `renderChatCustomMessage` (custom chat renderer callback).

## Comprehensive integration tests

12 new integration tests bring the total from 34 to **46**, covering every major handler:

- Theme subscribe (host→product theme changes)
- Entropy derivation (deterministic, same-key-same-result)
- Login flow (authenticated, rejected, disconnect/reconnect)
- User identity (`getUserId` returns `primaryUsername`)
- Resource allocation (all 4 resource types allocated)
- Feature check (configured chain matches, unknown chain doesn't)
- Local storage (write, read, clear round-trip)
- Statement store proof creation
- Create transaction for product accounts
- Account create proof (Ring VRF)

## Updated dependencies

`@novasamatech/*` → ^0.7.8.

---

# host-api-test-sdk 0.7.6

## Refreshed chain constants

`PASEO_ASSET_HUB` previously pointed at Paseo Next v1, which was deprecated on 2026-05-20. Both its `genesisHash` and `rpcUrl` are now updated to Paseo Asset Hub v2:

```ts
import { PASEO_ASSET_HUB } from "@parity/host-api-test-sdk";

// Now resolves to the v2 chain — no code change needed on your side.
createTestHostFixture({
  productUrl: "http://localhost:3000",
  chain: PASEO_ASSET_HUB,
});
```

While verifying the v2 values live, we also found `PREVIEWNET` and `PREVIEWNET_ASSET_HUB` carrying genesis hashes from prior redeployments that no longer matched what those chains return. Both refreshed in the same release.

All three values were queried live via `chain_getBlockHash[0]`. If your product was hitting genesis-hash mismatches against any of these chains, upgrade to 0.7.6 and the failures will clear without any code change.

If you hardcoded the literal hash strings anywhere in your tests, update them — the constants are the source of truth.

_Thanks to [@TarikGul](https://github.com/TarikGul) for spotting and fixing this in [#20](https://github.com/paritytech/host-api-test-sdk/pull/20)._

---

# host-api-test-sdk 0.8.1

Bumps `@novasamatech/*` to `0.7.9-4` and fixes `handleCreateTransaction` to return a real signed v4 extrinsic. In `0.8.0` it echoed `params.callData` back — fine for `result.ok === true` checks, broken the moment a product tried to submit the bytes.

## What changed

- **`handleCreateTransaction` / `handleCreateTransactionWithLegacyAccount`** — the request is now a flat object (`signer`, `genesisHash`, `callData`, `extensions`, `txExtVersion`); no more tuple wrapping, no `context` block, all fields are `Uint8Array`. Exports `VersionedPublicTxPayload` / `TxPayloadV1Public` are gone — use `ProductAccountTransaction` / `LegacyTransaction`.
- The handler now signs `callData || extras || additionalSigned` sr25519 and returns a v4 signed-extrinsic frame: `[0x84][MultiAddress::Id + AccountId32][Sr25519 + sig][extras][callData]`. v5 is not emitted yet (paseo-asset-hub-next runs `extrinsic.version: [4]` only).
- Upstream also removed the attestation service and simplified SSO; `@novasamatech/product-sdk` is being renamed to `@novasamatech/host-api-wrapper` (`0.7.9-5+` is under the new name; we stay on `product-sdk@0.7.9-4` for this release).

## What you need to do

- Upgrade to `0.8.1`. No product-side code change required — the wrapper API didn't move.
- If you constructed `createTransaction` requests by hand, switch to the flat `ProductAccountTransaction` shape and include `genesisHash`.
- If your tests asserted on the bytes being equal to `callData`, drop that assumption and decode the response as a v4 extrinsic instead.
- If your runtime negotiates v5 general extrinsics, file an issue — v5 support is a follow-up.

`0.8.0` is deprecated on npm; upgrade.

---

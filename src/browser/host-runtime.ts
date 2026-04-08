/**
 * Browser-side host runtime — bundled by esbuild into a single IIFE.
 *
 * Reads config from window.__TEST_HOST_CONFIG__, initialises crypto,
 * derives dev keypairs, creates a Spektr host-container for the product
 * iframe, and registers all required handlers (accounts, signing,
 * chain RPC, localStorage).
 *
 * Exposes window.__TEST_HOST__ for Playwright control.
 */

import { SigningErr } from "@novasamatech/host-api";
import type { Container } from "@novasamatech/host-container";
import {
  createContainer,
  createIframeProvider,
} from "@novasamatech/host-container";
import { Keyring } from "@polkadot/keyring";
import type { KeyringPair } from "@polkadot/keyring/types";
import { TypeRegistry } from "@polkadot/types";
import { u8aToHex } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { ResultAsync } from "neverthrow";
import { getWsProvider } from "polkadot-api/ws-provider";

import type {
  PermissionBehavior,
  PermissionLogEntry,
  SigningLogEntry,
  TestHostAPI,
} from "../types.js";

// ── Types ──────────────────────────────────────────────────────────

interface AccountConfig {
  name: string;
  uri: string;
}

interface ChainRuntimeConfig {
  genesisHash: string;
  rpcUrl: string;
  name: string;
}

interface HostConfig {
  productUrl: string;
  accounts: AccountConfig[];
  chain: ChainRuntimeConfig;
  /** When true, product accounts are derived as //Bob//identity1/identity2 (unique per product). Default: false (use base dev account). */
  deriveProductAccounts?: boolean;
}

// ── Globals ────────────────────────────────────────────────────────

declare global {
  interface Window {
    __TEST_HOST_CONFIG__: HostConfig;
    __TEST_HOST__: TestHostAPI;
  }
}

// ── State ──────────────────────────────────────────────────────────

const signingLog: SigningLogEntry[] = [];
const permissionLog: PermissionLogEntry[] = [];
let permissionBehavior: PermissionBehavior = "approve-all";
let connectionStatus = "connecting";
let chainStatus = "connecting";
let currentContainer: Container | null = null;
let keyring: Keyring;
const pairsByUri = new Map<string, KeyringPair>();
const urisByPair = new Map<KeyringPair, string>();

// ── Helpers ────────────────────────────────────────────────────────

/** Normalize a genesis hash for comparison — handles different types and casing */
function normalizeHash(value: unknown): string {
  const str = String(value).toLowerCase().trim();
  return str.startsWith("0x") ? str : `0x${str}`;
}

function getPair(uri: string): KeyringPair {
  let pair = pairsByUri.get(uri);
  if (!pair) {
    pair = keyring.addFromUri(uri);
    pairsByUri.set(uri, pair);
    urisByPair.set(pair, uri);
  }
  return pair;
}

function getPairByAddress(address: string): KeyringPair | undefined {
  for (const pair of pairsByUri.values()) {
    if (pair.address === address) return pair;
  }
  // Try matching by public key hex (product-sdk sends 0x + hex(publicKey))
  const normalized = address.toLowerCase();
  for (const pair of pairsByUri.values()) {
    if (u8aToHex(pair.publicKey).toLowerCase() === normalized) return pair;
  }
  // Try matching by SS58 re-encoding (address might be in different SS58 format)
  for (const pair of pairsByUri.values()) {
    try {
      if (keyring.encodeAddress(pair.publicKey) === address) return pair;
    } catch {
      // ignore decoding errors
    }
  }
  return undefined;
}

// ── Container setup ────────────────────────────────────────────────

function setupContainer(
  iframe: HTMLIFrameElement,
  config: HostConfig,
  accountsOverride?: AccountConfig[],
): Container {
  const provider = createIframeProvider({ iframe, url: config.productUrl });
  const container = createContainer(provider);

  // Derive keypairs for all requested accounts
  const accounts = accountsOverride ?? config.accounts;
  const pairs = accounts.map((acc) => {
    const pair = getPair(acc.uri);
    return { pair, name: acc.name };
  });

  // ── Feature support ──────────────────────────────────────────

  container.handleFeatureSupported((params, { ok }) => {
    if (params.tag === "Chain") {
      const requested = normalizeHash(params.value);
      const configured = normalizeHash(config.chain.genesisHash);
      const supported = requested === configured;
      if (!supported) {
        console.warn(
          `[test-host] Chain feature check MISMATCH:\n` +
            `  requested: ${String(params.value)} (type: ${typeof params.value})\n` +
            `  configured: ${config.chain.genesisHash}\n` +
            `  normalized: ${requested} vs ${configured}`,
        );
      }
      return ok(supported);
    }
    return ok(false);
  });

  // ── Permissions (auto-approve in test environment) ──────────

  container.handlePermission((params, { ok }) => {
    let approved: boolean;
    if (permissionBehavior === "approve-all") {
      approved = true;
    } else if (permissionBehavior === "reject-all") {
      approved = false;
    } else {
      approved = permissionBehavior(params.tag, params.value);
    }

    permissionLog.push({
      tag: params.tag,
      value: params.value,
      approved,
      timestamp: Date.now(),
    });

    console.log(
      `[test-host] Permission ${approved ? "approved" : "rejected"}:`,
      params.tag,
    );
    return ok(approved);
  });

  // ── Chain connection ─────────────────────────────────────────

  chainStatus = "idle";
  const chainProvider = getWsProvider(config.chain.rpcUrl);

  container.handleChainConnection((requestedGenesisHash) => {
    const requested = normalizeHash(requestedGenesisHash);
    const configured = normalizeHash(config.chain.genesisHash);
    if (requested === configured) {
      chainStatus = "connected";
      console.log(
        "[test-host] Chain connection established for",
        config.chain.name,
      );
      return chainProvider;
    }
    console.warn(
      "[test-host] Unsupported chain requested:",
      requestedGenesisHash,
    );
    return null;
  });

  // ── Accounts ─────────────────────────────────────────────────

  container.handleGetNonProductAccounts((_, { ok }) => {
    return ok(
      pairs.map(({ pair, name }) => ({
        publicKey: pair.publicKey,
        name,
      })),
    );
  });

  // Product accounts: by default, return the base dev account directly.
  //
  // In production, product-sdk derives a unique keypair per product
  // (e.g. //Bob//myapp.dot/0). In the test environment we skip this
  // derivation by default and return the well-known dev account so that:
  //   1. The account already has funds on public testnets (no funding step)
  //   2. The address is deterministic and matches what faucets/scripts fund
  //   3. Tests don't depend on a specific DotNS identifier
  //
  // Set deriveProductAccounts: true to get the production derivation behavior.
  container.handleAccountGet((params, { ok }) => {
    const selectedPair = pairs[0];

    if (config.deriveProductAccounts) {
      const selectedAccUri = urisByPair.get(selectedPair.pair);
      const productPair = getPair(`${selectedAccUri}//${params[0]}/${params[1]}`);
      return ok({
        publicKey: productPair.publicKey,
        name: undefined,
      });
    }

    return ok({
      publicKey: selectedPair.pair.publicKey,
      name: selectedPair.name,
    });
  });

  container.handleAccountConnectionStatusSubscribe((_, send) => {
    send(pairs.length > 0 ? "connected" : "disconnected");
    // No dynamic updates — static test accounts
    return () => {};
  });

  // ── Sign payload (extrinsic) ─────────────────────────────────

  container.handleSignPayload((params, { ok, err }) => {
    const pair = getPairByAddress(params.address);
    if (!pair) {
      return err(
        new SigningErr.Unknown({
          reason: `No keypair for address: ${params.address}`,
        }),
      );
    }

    signingLog.push({
      type: "payload",
      payload: params,
      timestamp: Date.now(),
    });

    return ResultAsync.fromPromise(
      (async () => {
        const registry = new TypeRegistry();
        registry.setSignedExtensions(params.signedExtensions);
        const extrinsicPayload = registry.createType(
          "ExtrinsicPayload",
          params,
          { version: params.version },
        );

        // extrinsicPayload.sign() returns { signature: HexString } — already hex-encoded.
        // Do NOT apply u8aToHex() again (that would double-encode).
        const { signature } = extrinsicPayload.sign(pair);
        return {
          signature: signature as `0x${string}`,
          signedTransaction: undefined,
        };
      })(),
      (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[test-host] Sign error:", msg);
        return new SigningErr.Unknown({ reason: msg });
      },
    );
  });

  // ── Sign raw ─────────────────────────────────────────────────

  container.handleSignRaw((params, { ok, err }) => {
    const pair = getPairByAddress(params.address);
    if (!pair) {
      return err(
        new SigningErr.Unknown({
          reason: `No keypair for address: ${params.address}`,
        }),
      );
    }

    signingLog.push({ type: "raw", payload: params, timestamp: Date.now() });

    let dataToSign: Uint8Array;
    if (params.data.tag === "Bytes") {
      dataToSign = params.data.value;
    } else {
      // Payload string — encode as UTF-8 bytes
      dataToSign = new TextEncoder().encode(params.data.value);
    }

    const signature = pair.sign(dataToSign);
    return ok({
      signature: u8aToHex(signature) as `0x${string}`,
      signedTransaction: undefined,
    });
  });

  // ── Local storage (scoped per test) ──────────────────────────

  container.handleLocalStorageRead((key, { ok }) => {
    const storageKey = `test-host:${key}`;
    const raw = localStorage.getItem(storageKey);
    return ok(raw !== null ? new TextEncoder().encode(raw) : undefined);
  });

  container.handleLocalStorageWrite(([key, value], { ok }) => {
    const storageKey = `test-host:${key}`;
    localStorage.setItem(storageKey, new TextDecoder().decode(value));
    return ok(undefined);
  });

  container.handleLocalStorageClear((key, { ok }) => {
    const storageKey = `test-host:${key}`;
    localStorage.removeItem(storageKey);
    return ok(undefined);
  });

  // ── Connection status ────────────────────────────────────────

  container.subscribeProductConnectionStatus((status) => {
    connectionStatus = status;
  });

  return container;
}

// ── Init ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const config = window.__TEST_HOST_CONFIG__;
  if (!config) {
    console.error("[test-host] No __TEST_HOST_CONFIG__ found");
    return;
  }

  // Wait for WASM crypto (sr25519 signing)
  await cryptoWaitReady();

  keyring = new Keyring({ type: "sr25519", ss58Format: 42 });

  const iframe = document.getElementById("product-frame") as HTMLIFrameElement;

  currentContainer = setupContainer(iframe, config);

  // Forward the host page's path/search/hash to the product iframe so that
  // deep links like /n?id=...#key=... work when navigating via the test host URL.
  // Must come after setupContainer so createIframeProvider does not overwrite it.
  iframe.src = new URL(
    window.location.pathname + window.location.search + window.location.hash,
    config.productUrl,
  ).href;

  // ── Control API for Playwright ─────────────────────────────

  window.__TEST_HOST__ = {
    async switchAccount(name: string) {
      await this.setAccounts([name]);
    },

    async setAccounts(names: string[]) {
      const accounts = names.map((n) => ({
        name: n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(),
        uri: `//${n.charAt(0).toUpperCase()}${n.slice(1).toLowerCase()}`,
      }));

      // Dispose current container
      if (currentContainer) {
        currentContainer.dispose();
        currentContainer = null;
      }

      // Recreate container with new accounts (triggers iframe reload)
      const iframe = document.getElementById(
        "product-frame",
      ) as HTMLIFrameElement;
      iframe.src = config.productUrl;

      currentContainer = setupContainer(iframe, config, accounts);
    },

    getSigningLog() {
      return [...signingLog];
    },

    clearSigningLog() {
      signingLog.length = 0;
    },

    getConnectionStatus() {
      return connectionStatus;
    },

    getChainStatus() {
      return chainStatus;
    },

    setPermissionBehavior(behavior: PermissionBehavior) {
      permissionBehavior = behavior;
    },

    getPermissionLog() {
      return [...permissionLog];
    },

    clearPermissionLog() {
      permissionLog.length = 0;
    },

    dispose() {
      if (currentContainer) {
        currentContainer.dispose();
        currentContainer = null;
      }
    },
  };

  console.log(
    "[test-host] Initialized:",
    "\n  chain:",
    config.chain.name,
    "(" + config.chain.genesisHash.slice(0, 18) + "...)",
    "\n  rpc:",
    config.chain.rpcUrl,
    "\n  accounts:",
    config.accounts.map((a) => a.name).join(", "),
  );
}

init().catch((err) => {
  console.error("[test-host] Init failed:", err);
});

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

import {
  ChatMessagePostingErr,
  DeriveEntropyErr,
  LoginErr,
  NavigateToErr,
  PaymentRequestErr,
  PaymentTopUpErr,
  PreimageSubmitErr,
  RequestCredentialsErr,
  SigningErr,
} from "@novasamatech/host-api";
import type { Container } from "@novasamatech/host-container";
import {
  createContainer,
  createIframeProvider,
  deriveProductEntropy,
} from "@novasamatech/host-container";
import { Keyring } from "@polkadot/keyring";
import type { KeyringPair } from "@polkadot/keyring/types";
import { TypeRegistry } from "@polkadot/types";
import { u8aToHex } from "@polkadot/util";
import { blake2AsHex, blake2AsU8a, cryptoWaitReady } from "@polkadot/util-crypto";
import { ResultAsync } from "neverthrow";
import { getWsProvider } from "polkadot-api/ws";

import type {
  ChatBot,
  ChatMessageLogEntry,
  ChatRoom,
  HexString,
  LoginBehavior,
  NavigationLogEntry,
  NotificationLogEntry,
  PaymentLogEntry,
  PermissionBehavior,
  PermissionLogEntry,
  PreimageEntry,
  SigningLogEntry,
  StatementSubmissionLogEntry,
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
  /** Maps "dotnsId/index" → { name, uri } for product account overrides. */
  productAccounts?: Record<string, AccountConfig>;
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
const navigationLog: NavigationLogEntry[] = [];
const notificationLog: NotificationLogEntry[] = [];
const grantedPermissions = new Set<string>();
const chatRooms = new Map<string, ChatRoom>();
const chatBots = new Map<string, ChatBot>();
const chatMessageLog: ChatMessageLogEntry[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chatActionSubscribers = new Set<(payload: any) => void>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chatListSubscribers = new Set<(room: any) => void>();
let chatMessageCounter = 0;
/** preimages: hex key → entry */
const preimages = new Map<string, PreimageEntry>();
/** key → set of subscriber callbacks waiting for that preimage */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const preimageSubscribers = new Map<string, Set<(value: any) => void>>();
const statementStore: unknown[] = [];
const submittedStatements: StatementSubmissionLogEntry[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statementSubscribers = new Set<{ filter: { tag: string; value: Uint8Array[] }; send: (s: any) => void }>();
const paymentLog: PaymentLogEntry[] = [];
let paymentBalance: bigint = 0n;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paymentBalanceSubscribers = new Set<(balance: any) => void>();
const paymentStatuses = new Map<string, { tag: string; value?: string }>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paymentStatusSubscribers = new Map<string, Set<(status: any) => void>>();
let paymentCounter = 0;
let currentTheme: "light" | "dark" = "light";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const themeSubscribers = new Set<(theme: any) => void>();
let loginBehavior: LoginBehavior = "success";
let isAuthenticated = true;
let permissionBehavior: PermissionBehavior = "approve-all";
let enforcePermissions = true;
let connectionStatus = "connecting";
let chainStatus = "connecting";
let currentContainer: Container | null = null;
let keyring: Keyring;
const pairsByUri = new Map<string, KeyringPair>();
const urisByPair = new Map<KeyringPair, string>();

// ── Constants ─────────────────────────────────────────────────────

/** Maps host-api device permission names to Permissions Policy directives (matching dot.li). */
const DEVICE_PERMISSION_POLICY: Record<string, string> = {
  Camera: "camera",
  Microphone: "microphone",
  Location: "geolocation",
  Bluetooth: "bluetooth",
  NFC: "nfc",
  Clipboard: "clipboard-read",
  Biometrics: "publickey-credentials-get",
};

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

/** Resolve a product account [dotnsId, derivationIndex] to a keypair. */
function getPairForProductAccount(
  config: HostConfig,
  pairs: { pair: KeyringPair; name: string }[],
  dotnsId: string,
  idx: number,
): KeyringPair | undefined {
  const key = `${dotnsId}/${idx}`;
  const override = config.productAccounts?.[key];
  if (override) {
    return getPair(override.uri);
  }
  if (pairs.length === 0) return undefined;
  const selectedAccUri = urisByPair.get(pairs[0].pair);
  return getPair(`${selectedAccUri}//${dotnsId}/${idx}`);
}

/**
 * Build the iframe `allow` attribute from granted device permissions.
 * Always includes clipboard directives; adds Permissions Policy directives
 * for each granted device permission — matching dot.li's buildAllowAttribute.
 */
function buildAllowAttribute(): string {
  const policies = ["clipboard-read", "clipboard-write"];
  for (const tag of grantedPermissions) {
    const directive = DEVICE_PERMISSION_POLICY[tag];
    if (directive) {
      policies.push(directive);
    }
  }
  return policies.join("; ");
}

/** Update the product iframe's `allow` attribute from current granted device permissions. */
function updateIframeAllow(): void {
  const iframeEl = document.getElementById("product-frame") as HTMLIFrameElement;
  if (iframeEl) {
    iframeEl.allow = buildAllowAttribute();
  }
}

// ── Container setup ────────────────────────────────────────────────

function setupContainer(
  iframe: HTMLIFrameElement,
  config: HostConfig,
  accountsOverride?: AccountConfig[],
): Container {
  // Reset permission and activity logs on container recreation — matches real
  // hosts where permissions are per-session, not carried across reconnects.
  grantedPermissions.clear();
  permissionLog.length = 0;
  navigationLog.length = 0;
  notificationLog.length = 0;
  chatRooms.clear();
  chatBots.clear();
  chatMessageLog.length = 0;
  chatActionSubscribers.clear();
  chatListSubscribers.clear();
  chatMessageCounter = 0;
  preimages.clear();
  preimageSubscribers.clear();
  statementStore.length = 0;
  submittedStatements.length = 0;
  statementSubscribers.clear();
  paymentLog.length = 0;
  paymentBalance = 0n;
  paymentBalanceSubscribers.clear();
  paymentStatuses.clear();
  paymentStatusSubscribers.clear();
  paymentCounter = 0;
  themeSubscribers.clear();

  const provider = createIframeProvider({ iframe, url: config.productUrl });
  const container = createContainer(provider);

  // Derive keypairs for all requested accounts
  const accounts = accountsOverride ?? config.accounts;
  const pairs = accounts.map((acc) => {
    const pair = getPair(acc.uri);
    return { pair, name: acc.name };
  });

  // Also derive keypairs for product account overrides so signing works
  if (config.productAccounts) {
    for (const acc of Object.values(config.productAccounts)) {
      getPair(acc.uri); // registers in pairsByUri for signing lookups
    }
  }

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

  // ── Permissions ─────────────────────────────────────────────
  // Matches real host behavior: product must request permission
  // before gated operations (e.g. signing requires TransactionSubmit).

  container.handlePermission((params, { ok }) => {
    // params is now RemotePermission[] (batched). Approve if all pass.
    let allApproved = true;
    for (const perm of params) {
      let approved: boolean;
      if (permissionBehavior === "approve-all") {
        approved = true;
      } else if (permissionBehavior === "reject-all") {
        approved = false;
      } else {
        approved = permissionBehavior(perm.tag, perm.value);
      }

      if (approved) {
        grantedPermissions.add(perm.tag);
      } else {
        allApproved = false;
      }

      permissionLog.push({
        tag: perm.tag,
        value: perm.value,
        approved,
        timestamp: Date.now(),
      });

      console.log(
        `[test-host] Permission ${approved ? "granted" : "denied"}:`,
        perm.tag,
      );
    }
    return ok(allApproved);
  });

  // ── Device permissions ─────────────────────────────────────────
  // Matches real host behavior: product must request device permissions
  // (Camera, Microphone, Location, Bluetooth). When granted, the iframe
  // `allow` attribute is updated and the iframe reloads (matching dot.li).

  container.handleDevicePermission((permission, { ok }) => {
    let approved: boolean;
    if (permissionBehavior === "approve-all") {
      approved = true;
    } else if (permissionBehavior === "reject-all") {
      approved = false;
    } else {
      approved = permissionBehavior(permission, undefined);
    }

    if (approved) {
      grantedPermissions.add(permission);
    }

    permissionLog.push({
      tag: permission,
      value: undefined,
      approved,
      timestamp: Date.now(),
    });

    console.log(
      `[test-host] Device permission ${approved ? "granted" : "denied"}:`,
      permission,
    );

    if (approved) {
      // Update iframe allow attribute. In dot.li the iframe reloads for the
      // new Permissions Policy to take effect; here we update the attribute
      // so it applies on the next navigation or container recreation.
      updateIframeAllow();
    }

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

  container.handleGetLegacyAccounts((_, { ok }) => {
    return ok(
      pairs.map(({ pair, name }) => ({
        publicKey: pair.publicKey,
        name,
      })),
    );
  });

  // Product accounts: when the product calls getProductAccount(dotnsId, index),
  // look up "dotnsId/index" in the productAccounts map. If found, return that
  // account. Otherwise derive as production: //Bob//dotnsId/index.
  //
  // This lets tests map product accounts to funded dev accounts:
  //   productAccounts: { 'myapp.dot/0': 'bob' }
  //   → getProductAccount("myapp.dot", 0) returns //Bob's keypair
  container.handleAccountGet((params, { ok }) => {
    const key = `${params[0]}/${params[1]}`;
    const override = config.productAccounts?.[key];

    if (override) {
      const pair = getPair(override.uri);
      return ok({
        publicKey: pair.publicKey,
        name: override.name,
      });
    }

    // Default: derive from the selected account (production behavior)
    const selectedPair = pairs[0];
    const selectedAccUri = urisByPair.get(selectedPair.pair);
    const productPair = getPair(`${selectedAccUri}//${params[0]}/${params[1]}`);
    return ok({
      publicKey: productPair.publicKey,
      name: undefined,
    });
  });

  container.handleAccountConnectionStatusSubscribe((_, send) => {
    send(pairs.length > 0 ? "connected" : "disconnected");
    // No dynamic updates — static test accounts
    return () => {};
  });

  // Ring VRF alias: real hosts derive a context-specific alias via
  // session.getRingVrfAlias(). For test purposes, return a deterministic
  // (context, alias) pair derived from the product account — stable across
  // runs so tests can assert exact values if needed.
  container.handleAccountGetAlias((params, { ok }) => {
    const key = `${params[0]}/${params[1]}`;
    const override = config.productAccounts?.[key];
    const pair = override
      ? getPair(override.uri)
      : getPair(`${urisByPair.get(pairs[0].pair)}//${params[0]}/${params[1]}`);

    // Deterministic 32-byte context and alias from the account's public key.
    const context = blake2AsU8a(
      new Uint8Array([...pair.publicKey, ...new TextEncoder().encode("context")]),
      256,
    );
    const alias = blake2AsU8a(
      new Uint8Array([...pair.publicKey, ...new TextEncoder().encode("alias")]),
      256,
    );
    return ok({ context, alias });
  });

  // ── Sign payload (extrinsic) ─────────────────────────────────

  container.handleSignPayload((params, { ok, err }) => {
    // params.account is [dotnsId, derivationIndex]
    const [dotnsId, idx] = params.account;
    const pair = getPairForProductAccount(config, pairs, dotnsId, idx);
    if (!pair) {
      return err(
        new SigningErr.Unknown({
          reason: `No keypair for product account: ${dotnsId}/${idx}`,
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
        registry.setSignedExtensions(params.payload.signedExtensions);
        const extrinsicPayload = registry.createType(
          "ExtrinsicPayload",
          params.payload,
          { version: params.payload.version },
        );

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
    // params.account is [dotnsId, derivationIndex]
    const [dotnsId, idx] = params.account;
    const pair = getPairForProductAccount(config, pairs, dotnsId, idx);
    if (!pair) {
      return err(
        new SigningErr.Unknown({
          reason: `No keypair for product account: ${dotnsId}/${idx}`,
        }),
      );
    }

    signingLog.push({ type: "raw", payload: params, timestamp: Date.now() });

    let dataToSign: Uint8Array;
    if (params.payload.tag === "Bytes") {
      dataToSign = params.payload.value;
    } else {
      dataToSign = new TextEncoder().encode(params.payload.value);
    }

    const signature = pair.sign(dataToSign);
    return ok({
      signature: u8aToHex(signature) as `0x${string}`,
      signedTransaction: undefined,
    });
  });

  // ── Sign with legacy account (address-based) ───────────────

  container.handleSignPayloadWithLegacyAccount((params, { ok, err }) => {
    const pair = getPairByAddress(params.signer);
    if (!pair) {
      return err(
        new SigningErr.Unknown({
          reason: `No keypair for signer: ${params.signer}`,
        }),
      );
    }

    signingLog.push({ type: "payload", payload: params, timestamp: Date.now() });

    return ResultAsync.fromPromise(
      (async () => {
        const registry = new TypeRegistry();
        registry.setSignedExtensions(params.payload.signedExtensions);
        const extrinsicPayload = registry.createType(
          "ExtrinsicPayload",
          params.payload,
          { version: params.payload.version },
        );
        const { signature } = extrinsicPayload.sign(pair);
        return {
          signature: signature as `0x${string}`,
          signedTransaction: undefined,
        };
      })(),
      (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        return new SigningErr.Unknown({ reason: msg });
      },
    );
  });

  container.handleSignRawWithLegacyAccount((params, { ok, err }) => {
    const pair = getPairByAddress(params.signer);
    if (!pair) {
      return err(
        new SigningErr.Unknown({
          reason: `No keypair for signer: ${params.signer}`,
        }),
      );
    }

    signingLog.push({ type: "raw", payload: params, timestamp: Date.now() });

    let dataToSign: Uint8Array;
    if (params.payload.tag === "Bytes") {
      dataToSign = params.payload.value;
    } else {
      dataToSign = new TextEncoder().encode(params.payload.value);
    }

    const signature = pair.sign(dataToSign);
    return ok({
      signature: u8aToHex(signature) as `0x${string}`,
      signedTransaction: undefined,
    });
  });

  // ── Create transaction with legacy account ──────────────────

  container.handleCreateTransactionWithLegacyAccount((params, { ok, err }) => {
    // For test purposes, just return the call data as-is
    return ok(params.callData);
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

  // ── Navigation ───────────────────────────────────────────────
  // Real hosts parse dot.li URLs and route within the app or open externally.
  // The test host records intents so tests can assert what the product tried
  // to navigate to, without actually navigating.

  container.handleNavigateTo((url, { ok, err }) => {
    if (typeof url !== "string" || url.length === 0) {
      return err(new NavigateToErr.Unknown({ reason: "Empty URL" }));
    }
    navigationLog.push({ url, timestamp: Date.now() });
    console.log("[test-host] Navigation requested:", url);
    return ok(undefined);
  });

  // ── Push notifications ───────────────────────────────────────
  // Real hosts surface system notifications with optional deeplink click handlers.
  // The test host records notifications so tests can assert what was sent.

  container.handlePushNotification((params, { ok }) => {
    notificationLog.push({
      text: params.text,
      deeplink: params.deeplink,
      timestamp: Date.now(),
    });
    console.log(
      "[test-host] Notification:",
      params.text,
      params.deeplink ? `(deeplink: ${params.deeplink})` : "",
    );
    return ok(undefined);
  });

  // ── Chat ─────────────────────────────────────────────────────
  // In-memory chat implementation: tracks product-created rooms and bots,
  // logs posted messages, and allows tests to inject incoming actions
  // through `injectChatAction`. Real hosts back these via Matrix.

  container.handleChatCreateRoom((params, { ok }) => {
    const exists = chatRooms.has(params.roomId);
    if (!exists) {
      const room: ChatRoom = {
        roomId: params.roomId,
        name: params.name,
        icon: params.icon,
        participatingAs: "RoomHost",
      };
      chatRooms.set(params.roomId, room);
      for (const subscriber of chatListSubscribers) {
        subscriber({
          roomId: room.roomId,
          participatingAs: room.participatingAs,
        });
      }
    }
    return ok({ status: exists ? "Exists" : "New" });
  });

  container.handleChatBotRegistration((params, { ok }) => {
    const exists = chatBots.has(params.botId);
    if (!exists) {
      chatBots.set(params.botId, {
        botId: params.botId,
        name: params.name,
        icon: params.icon,
      });
    }
    return ok({ status: exists ? "Exists" : "New" });
  });

  container.handleChatListSubscribe((_, send) => {
    // Send current rooms on subscribe
    for (const room of chatRooms.values()) {
      send({ roomId: room.roomId, participatingAs: room.participatingAs });
    }
    chatListSubscribers.add(send);
    return () => {
      chatListSubscribers.delete(send);
    };
  });

  container.handleChatPostMessage((params, { ok, err }) => {
    if (!chatRooms.has(params.roomId)) {
      return err(
        new ChatMessagePostingErr.Unknown({
          reason: `Room does not exist: ${params.roomId}`,
        }),
      );
    }
    chatMessageCounter += 1;
    const messageId = `msg-${chatMessageCounter}`;
    chatMessageLog.push({
      roomId: params.roomId,
      messageId,
      payload: params.payload,
      timestamp: Date.now(),
    });
    return ok({ messageId });
  });

  container.handleChatActionSubscribe((_, send) => {
    chatActionSubscribers.add(send);
    return () => {
      chatActionSubscribers.delete(send);
    };
  });

  // ── Preimage store ───────────────────────────────────────────
  // In-memory preimage storage. Key = blake2b-256(value), matching how
  // preimages are identified on Polkadot. Real hosts submit via Bulletin
  // chain + fetch via IPFS; this is a simple lookup table.

  container.handlePreimageLookupSubscribe((key, send) => {
    const keyStr = String(key).toLowerCase();
    const existing = preimages.get(keyStr);
    send(existing ? existing.value : null);

    let subs = preimageSubscribers.get(keyStr);
    if (!subs) {
      subs = new Set();
      preimageSubscribers.set(keyStr, subs);
    }
    subs.add(send);

    return () => {
      const s = preimageSubscribers.get(keyStr);
      if (s) {
        s.delete(send);
        if (s.size === 0) preimageSubscribers.delete(keyStr);
      }
    };
  });

  container.handlePreimageSubmit((value, { ok, err }) => {
    try {
      const key = blake2AsHex(value, 256) as HexString;
      const entry: PreimageEntry = {
        key,
        value,
        fromProduct: true,
        timestamp: Date.now(),
      };
      preimages.set(key.toLowerCase(), entry);

      // Notify any subscribers waiting for this key
      const subs = preimageSubscribers.get(key.toLowerCase());
      if (subs) {
        for (const subscriber of subs) subscriber(value);
      }

      return ok(key);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return err(new PreimageSubmitErr.Unknown({ reason }));
    }
  });

  // ── Statement store ──────────────────────────────────────────
  // In-memory statement storage. Topics are Uint8Array[]; a statement
  // matches a subscription if the subscription topics are a subset of the
  // statement's topics (simple filter). Real hosts back this via the
  // @novasamatech/statement-store SDK.

  container.handleStatementStoreSubscribe((topicFilter, send) => {
    // topicFilter: { tag: 'MatchAll' | 'MatchAny', value: Uint8Array[] }
    const matchesFilter = (statement: unknown): boolean => {
      const filterTopics = topicFilter.value;
      if (filterTopics.length === 0) return true;
      const stmt = statement as { topics?: Uint8Array[] };
      if (!stmt.topics) return false;
      const stmtTopicsHex = stmt.topics.map((t) => u8aToHex(t));
      if (topicFilter.tag === "MatchAll") {
        return filterTopics.every((ft) =>
          stmtTopicsHex.includes(u8aToHex(ft)),
        );
      }
      // MatchAny
      return filterTopics.some((ft) =>
        stmtTopicsHex.includes(u8aToHex(ft)),
      );
    };

    // Send as SignedStatementsPage { statements, isComplete }
    const pageSend = (statement: unknown) => {
      send({ statements: [statement], isComplete: true } as never);
    };

    // Send current matching statements as initial dump
    const current = statementStore.filter(matchesFilter);
    send({ statements: current, isComplete: true } as never);

    const subscriber = { filter: topicFilter, send: pageSend };
    statementSubscribers.add(subscriber);

    return () => {
      statementSubscribers.delete(subscriber);
    };
  });

  container.handleStatementStoreCreateProof((params, { ok }) => {
    // Resolve the product account's keypair, then sign the raw statement
    // data with sr25519. This produces a valid Sr25519 proof shape that
    // downstream verification can check.
    const [[dotnsId, idx], statement] = params;
    const key = `${dotnsId}/${idx}`;
    const override = config.productAccounts?.[key];
    const pair = override
      ? getPair(override.uri)
      : getPair(`${urisByPair.get(pairs[0].pair)}//${dotnsId}/${idx}`);

    // Canonical message: for test purposes, sign the data field (or empty).
    const dataToSign =
      (statement as { data?: Uint8Array }).data ?? new Uint8Array();
    const signature = pair.sign(dataToSign);

    return ok({
      tag: "Sr25519",
      value: {
        signature,
        signer: pair.publicKey,
      },
    });
  });

  container.handleStatementStoreSubmit((statement, { ok }) => {
    statementStore.push(statement);
    submittedStatements.push({
      statement,
      timestamp: Date.now(),
    });

    // Deliver to matching subscribers using TopicFilter semantics
    const stmt = statement as { topics?: Uint8Array[] };
    const stmtTopicsHex = (stmt.topics ?? []).map((t) => u8aToHex(t));
    for (const sub of statementSubscribers) {
      const filterTopics = sub.filter.value;
      let matches: boolean;
      if (filterTopics.length === 0) {
        matches = true;
      } else if (sub.filter.tag === "MatchAll") {
        matches = filterTopics.every((t) => stmtTopicsHex.includes(u8aToHex(t)));
      } else {
        matches = filterTopics.some((t) => stmtTopicsHex.includes(u8aToHex(t)));
      }
      if (matches) sub.send(statement as never);
    }

    return ok(undefined);
  });

  // ── Theme ────────────────────────────────────────────────────

  container.handleThemeSubscribe((_, send) => {
    send(currentTheme);
    themeSubscribers.add(send);
    return () => {
      themeSubscribers.delete(send);
    };
  });

  // ── Entropy derivation (RFC-0007) ───────────────────────────

  container.handleDeriveEntropy((key, { ok, err }) => {
    try {
      // Use the first account's mini-secret as the root entropy source.
      // Real hosts use BIP-39 entropy; for test purposes, derive from the
      // account's raw seed (which is stable for dev accounts).
      const rootPair = pairs[0]?.pair;
      if (!rootPair) {
        return err(new DeriveEntropyErr.Unknown({ reason: "No accounts available" }));
      }
      // Use the public key as a stable stand-in for root account secret
      // (real hosts use BIP-39 entropy, but test dev accounts don't have it)
      const entropy = deriveProductEntropy(rootPair.publicKey, "test-product", key);
      return ok(entropy);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return err(new DeriveEntropyErr.Unknown({ reason }));
    }
  });

  // ── Root account (RFC-0010) ─────────────────────────────────

  container.handleAccountGetRoot((_, { ok, err }) => {
    if (!isAuthenticated) {
      return err(new RequestCredentialsErr.NotConnected());
    }
    if (pairs.length === 0) {
      return err(new RequestCredentialsErr.NotConnected());
    }
    // Return the first account as the root account
    const rootPair = pairs[0];
    return ok({
      publicKey: rootPair.pair.publicKey,
      name: rootPair.name,
    });
  });

  // ── Login (RFC-0009) ────────────────────────────────────────

  container.handleRequestLogin((reason, { ok, err }) => {
    if (isAuthenticated) {
      return ok("alreadyConnected" as const);
    }

    let result: "success" | "rejected";
    if (loginBehavior === "success") {
      result = "success";
    } else if (loginBehavior === "reject") {
      result = "rejected";
    } else {
      result = loginBehavior(reason) ? "success" : "rejected";
    }

    if (result === "success") {
      isAuthenticated = true;
    }

    return ok(result as never);
  });

  // ── Payments (RFC-0006) ─────────────────────────────────────

  container.handlePaymentBalanceSubscribe((_, send) => {
    send({ available: paymentBalance });
    paymentBalanceSubscribers.add(send);
    return () => {
      paymentBalanceSubscribers.delete(send);
    };
  });

  container.handlePaymentTopUp((params, { ok, err }) => {
    paymentLog.push({
      type: "top-up",
      amount: params.amount,
      source: params.source,
      timestamp: Date.now(),
    });
    paymentBalance += params.amount;
    // Notify balance subscribers
    for (const sub of paymentBalanceSubscribers) {
      sub({ available: paymentBalance });
    }
    return ok(undefined);
  });

  container.handlePaymentRequest((params, { ok, err }) => {
    if (params.amount > paymentBalance) {
      return err(new PaymentRequestErr.InsufficientBalance());
    }

    paymentCounter += 1;
    const paymentId = `pay-${paymentCounter}`;
    paymentBalance -= params.amount;

    paymentLog.push({
      type: "request",
      amount: params.amount,
      destination: params.destination,
      paymentId,
      timestamp: Date.now(),
    });

    // Notify balance subscribers
    for (const sub of paymentBalanceSubscribers) {
      sub({ available: paymentBalance });
    }

    // Auto-complete the payment
    paymentStatuses.set(paymentId, { tag: "Completed" });

    return ok({ id: paymentId });
  });

  container.handlePaymentStatusSubscribe((paymentId, send) => {
    const status = paymentStatuses.get(paymentId);
    if (status) {
      send(status as never);
    } else {
      send({ tag: "Processing", value: undefined } as never);
    }

    let subs = paymentStatusSubscribers.get(paymentId);
    if (!subs) {
      subs = new Set();
      paymentStatusSubscribers.set(paymentId, subs);
    }
    subs.add(send);

    return () => {
      const s = paymentStatusSubscribers.get(paymentId);
      if (s) {
        s.delete(send);
        if (s.size === 0) paymentStatusSubscribers.delete(paymentId);
      }
    };
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

    grantPermission(tag: string) {
      grantedPermissions.add(tag);
      if (DEVICE_PERMISSION_POLICY[tag]) updateIframeAllow();
    },

    revokePermission(tag: string) {
      grantedPermissions.delete(tag);
      if (DEVICE_PERMISSION_POLICY[tag]) updateIframeAllow();
    },

    getGrantedPermissions() {
      return [...grantedPermissions];
    },

    setEnforcePermissions(enforce: boolean) {
      enforcePermissions = enforce;
    },

    getPermissionLog() {
      return [...permissionLog];
    },

    clearPermissionLog() {
      permissionLog.length = 0;
    },

    getNavigationLog() {
      return [...navigationLog];
    },

    clearNavigationLog() {
      navigationLog.length = 0;
    },

    getNotificationLog() {
      return [...notificationLog];
    },

    clearNotificationLog() {
      notificationLog.length = 0;
    },

    getChatRooms() {
      return [...chatRooms.values()];
    },

    getChatBots() {
      return [...chatBots.values()];
    },

    getChatMessageLog() {
      return [...chatMessageLog];
    },

    clearChatState() {
      chatRooms.clear();
      chatBots.clear();
      chatMessageLog.length = 0;
      chatActionSubscribers.clear();
      chatListSubscribers.clear();
      chatMessageCounter = 0;
    },

    injectChatAction(action: { roomId: string; peer: string; payload: unknown }) {
      for (const subscriber of chatActionSubscribers) {
        subscriber(action);
      }
    },

    getPreimages() {
      return [...preimages.values()];
    },

    seedPreimage(value: Uint8Array) {
      const key = blake2AsHex(value, 256) as HexString;
      preimages.set(key.toLowerCase(), {
        key,
        value,
        fromProduct: false,
        timestamp: Date.now(),
      });
      const subs = preimageSubscribers.get(key.toLowerCase());
      if (subs) {
        for (const s of subs) s(value);
      }
      return key;
    },

    clearPreimages() {
      preimages.clear();
    },

    getSubmittedStatements() {
      return [...submittedStatements];
    },

    injectStatement(statement: unknown) {
      statementStore.push(statement);
      const stmt = statement as { topics?: Uint8Array[] };
      const stmtTopicsHex = (stmt.topics ?? []).map((t) => u8aToHex(t));
      for (const sub of statementSubscribers) {
        const filterTopics = sub.filter.value;
        let matches: boolean;
        if (filterTopics.length === 0) {
          matches = true;
        } else if (sub.filter.tag === "MatchAll") {
          matches = filterTopics.every((t) => stmtTopicsHex.includes(u8aToHex(t)));
        } else {
          matches = filterTopics.some((t) => stmtTopicsHex.includes(u8aToHex(t)));
        }
        if (matches) sub.send(statement as never);
      }
    },

    clearStatements() {
      statementStore.length = 0;
      submittedStatements.length = 0;
    },

    // ── Theme control ──────────────────────────────────────────

    getTheme() {
      return currentTheme;
    },

    setTheme(theme: "light" | "dark") {
      currentTheme = theme;
      for (const sub of themeSubscribers) {
        sub(theme);
      }
    },

    // ── Login / auth control ───────────────────────────────────

    setLoginBehavior(behavior: LoginBehavior) {
      loginBehavior = behavior;
    },

    getIsAuthenticated() {
      return isAuthenticated;
    },

    simulateDisconnect() {
      isAuthenticated = false;
    },

    simulateReconnect() {
      isAuthenticated = true;
    },

    // ── Payment control ────────────────────────────────────────

    setPaymentBalance(amount: bigint) {
      paymentBalance = amount;
      for (const sub of paymentBalanceSubscribers) {
        sub({ available: paymentBalance });
      }
    },

    getPaymentLog() {
      return [...paymentLog];
    },

    clearPaymentLog() {
      paymentLog.length = 0;
    },

    simulatePaymentStatus(paymentId: string, status: { tag: string; value?: string }) {
      paymentStatuses.set(paymentId, status);
      const subs = paymentStatusSubscribers.get(paymentId);
      if (subs) {
        for (const sub of subs) sub(status as never);
      }
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

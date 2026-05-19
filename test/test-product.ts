/**
 * Minimal product page for integration tests.
 *
 * Connects to the host via product-sdk, requests both product and
 * non-product accounts, and exposes the public keys in the DOM.
 *
 * Also exposes window.__TEST_PRODUCT__ with methods for permission
 * and signing E2E tests.
 */

import { createAccountsProvider, hostApi, sandboxTransport } from '@novasamatech/host-api-wrapper';
import { enumValue } from '@novasamatech/host-api';
import { hexToU8a, u8aToHex } from '@polkadot/util';

const DOTNS_ID = 'test-product.dot';
const DERIVATION_INDEX = 0;

interface TestResult {
  ok: boolean;
  approved?: boolean;
  signature?: string;
  signedHex?: string;
  notificationId?: number;
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
      requestChainSubmit(): Promise<TestResult>;
      requestRemote(url: string): Promise<TestResult>;
      requestDevicePermission(type: string): Promise<TestResult>;
      navigateTo(url: string): Promise<TestResult>;
      pushNotification(text: string, deeplink?: string, scheduledAt?: number): Promise<TestResult>;
      pushNotificationCancel(id: number): Promise<TestResult>;
      getAccountAlias(dotnsId: string, index: number): Promise<TestResult & { context?: string; alias?: string }>;
      chatCreateRoom(room: { roomId: string; name: string; icon: string }): Promise<TestResult & { status?: string }>;
      chatRegisterBot(bot: { botId: string; name: string; icon: string }): Promise<TestResult & { status?: string }>;
      chatPostTextMessage(roomId: string, text: string): Promise<TestResult & { messageId?: string }>;
      subscribeChatActions(): { unsubscribe(): void };
      getReceivedChatActions(): Array<unknown>;
      clearReceivedChatActions(): void;
      preimageSubmit(value: number[]): Promise<TestResult & { key?: string }>;
      preimageLookup(key: string): Promise<TestResult & { value?: number[] | null }>;
      statementSubmit(topicsHex: string[], dataHex: string): Promise<TestResult>;
      statementCreateProof(dotnsId: string, index: number, dataHex: string): Promise<TestResult & { proof?: unknown }>;
      statementSubscribe(topicsHex: string[]): { unsubscribe(): void };
      getReceivedStatements(): Array<unknown>;
      clearReceivedStatements(): void;
      // v0.7+ additions
      subscribeTheme(): { unsubscribe(): void };
      getReceivedThemes(): string[];
      deriveEntropy(keyHex: string): Promise<TestResult & { entropyHex?: string }>;
      requestLogin(reason?: string): Promise<TestResult & { loginResult?: string }>;
      getUserId(): Promise<TestResult & { primaryUsername?: string }>;
      requestResourceAllocation(resources: Array<{ tag: string; value?: unknown }>): Promise<TestResult & { outcomes?: Array<{ tag: string }> }>;
      featureSupported(tag: string, value: unknown): Promise<TestResult & { supported?: boolean }>;
      localStorageWrite(key: string, value: string): Promise<TestResult>;
      localStorageRead(key: string): Promise<TestResult & { value?: string | null }>;
      localStorageClear(key: string): Promise<TestResult>;
      createTransaction(dotnsId: string, index: number): Promise<TestResult>;
      accountCreateProof(dotnsId: string, index: number): Promise<TestResult & { proofHex?: string }>;
    };
  }
}

const receivedChatActions: unknown[] = [];
const receivedStatements: unknown[] = [];
const receivedThemes: string[] = [];

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

    // Fetch legacy (root) accounts
    let firstRootAddress: string | null = null;
    const rootResult = await accountsProvider.getLegacyAccounts();

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
        try {
          const r = await hostApi.signRawWithLegacyAccount(enumValue('v1', {
            signer: firstRootAddress ?? '',
            payload: { tag: 'Bytes' as const, value: new TextEncoder().encode('test-payload') },
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

      async requestChainSubmit(): Promise<TestResult> {
        try {
          const r = await hostApi.permission(enumValue('v1',
            { tag: 'ChainSubmit' as const, value: undefined },
          ));
          if (r.isOk()) {
            return { ok: true, approved: r.value.value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async requestRemote(url: string): Promise<TestResult> {
        try {
          const r = await hostApi.permission(enumValue('v1',
            { tag: 'Remote' as const, value: [url] },
          ));
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
            enumValue('v1', type as 'Camera' | 'Microphone' | 'Bluetooth' | 'Location' | 'Notifications' | 'NFC' | 'Clipboard' | 'OpenUrl' | 'Biometrics'),
          );
          if (r.isOk()) {
            return { ok: true, approved: r.value.value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async navigateTo(url: string): Promise<TestResult> {
        try {
          const r = await hostApi.navigateTo(enumValue('v1', url));
          if (r.isOk()) {
            return { ok: true };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async pushNotification(text: string, deeplink?: string, scheduledAt?: number): Promise<TestResult> {
        try {
          const r = await hostApi.pushNotification(
            enumValue('v1', { text, deeplink, scheduledAt: scheduledAt !== undefined ? BigInt(scheduledAt) : undefined }),
          );
          if (r.isOk()) {
            return { ok: true, notificationId: (r.value as { tag: string; value: number }).value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async pushNotificationCancel(id: number): Promise<TestResult> {
        try {
          const r = await hostApi.pushNotificationCancel(enumValue('v1', id));
          if (r.isOk()) return { ok: true };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async getAccountAlias(dotnsId: string, index: number): Promise<TestResult & { context?: string; alias?: string }> {
        try {
          const r = await hostApi.accountGetAlias(enumValue('v1', [dotnsId, index]));
          if (r.isOk()) {
            return {
              ok: true,
              context: u8aToHex(r.value.value.context),
              alias: u8aToHex(r.value.value.alias),
            };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async chatCreateRoom(room: { roomId: string; name: string; icon: string }): Promise<TestResult & { status?: string }> {
        try {
          const r = await hostApi.chatCreateRoom(enumValue('v1', room));
          if (r.isOk()) {
            return { ok: true, status: r.value.value.status };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async chatRegisterBot(bot: { botId: string; name: string; icon: string }): Promise<TestResult & { status?: string }> {
        try {
          const r = await hostApi.chatRegisterBot(enumValue('v1', bot));
          if (r.isOk()) {
            return { ok: true, status: r.value.value.status };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async chatPostTextMessage(roomId: string, text: string): Promise<TestResult & { messageId?: string }> {
        try {
          const r = await hostApi.chatPostMessage(enumValue('v1', {
            roomId,
            payload: { tag: 'Text' as const, value: text },
          }));
          if (r.isOk()) {
            return { ok: true, messageId: r.value.value.messageId };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      subscribeChatActions() {
        const sub = hostApi.chatActionSubscribe(enumValue('v1', undefined), (payload: unknown) => {
          // Unwrap the versioned envelope { tag: 'v1', value }
          const p = payload as { tag?: string; value?: unknown };
          receivedChatActions.push(p?.tag === 'v1' ? p.value : payload);
        });
        return {
          unsubscribe() {
            sub.unsubscribe();
          },
        };
      },

      getReceivedChatActions() {
        return [...receivedChatActions];
      },

      clearReceivedChatActions() {
        receivedChatActions.length = 0;
      },

      async preimageSubmit(value: number[]): Promise<TestResult & { key?: string }> {
        try {
          const r = await hostApi.preimageSubmit(enumValue('v1', new Uint8Array(value)));
          if (r.isOk()) {
            return { ok: true, key: r.value.value };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      preimageLookup(key: string): Promise<TestResult & { value?: number[] | null }> {
        return new Promise((resolve) => {
          let resolved = false;
          const sub = hostApi.preimageLookupSubscribe(
            enumValue('v1', key as `0x${string}`),
            (payload: unknown) => {
              if (resolved) return;
              resolved = true;
              // Unwrap version envelope
              const p = payload as { tag?: string; value?: unknown };
              const v = p?.tag === 'v1' ? p.value : payload;
              sub.unsubscribe();
              resolve({
                ok: true,
                value: v === null ? null : v === undefined ? null : Array.from(v as Uint8Array),
              });
            },
          );
          // Safety timeout
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              sub.unsubscribe();
              resolve({ ok: false, error: 'timeout' });
            }
          }, 5000);
        });
      },

      async statementSubmit(topicsHex: string[], dataHex: string): Promise<TestResult> {
        try {
          const topics = topicsHex.map(h => hexToU8a(h));
          const data = hexToU8a(dataHex);
          const pk = firstRootAddress ? hexToU8a(firstRootAddress) : new Uint8Array(32);
          // Minimal signed statement; signature is a placeholder 64-byte zero
          const statement = {
            proof: {
              tag: 'Sr25519' as const,
              value: { signature: new Uint8Array(64), signer: pk },
            },
            decryptionKey: undefined,
            expiry: 0n,
            channel: undefined,
            topics,
            data,
          };
          const r = await hostApi.statementStoreSubmit(enumValue('v1', statement));
          if (r.isOk()) return { ok: true };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      statementSubscribe(topicsHex: string[]) {
        const topics = topicsHex.map(h => hexToU8a(h));
        // v0.7: TopicFilter enum — use MatchAll for backward compat
        const filter = { tag: 'MatchAll' as const, value: topics };
        const sub = hostApi.statementStoreSubscribe(
          enumValue('v1', filter),
          (payload: unknown) => {
            // Unwrap version envelope → SignedStatementsPage { statements, isComplete }
            const p = payload as { tag?: string; value?: unknown };
            const unwrapped = p?.tag === 'v1' ? p.value : payload;
            const page = unwrapped as { statements?: unknown[]; isComplete?: boolean };
            if (page?.statements && Array.isArray(page.statements)) {
              for (const s of page.statements) receivedStatements.push(s);
            } else if (Array.isArray(unwrapped)) {
              for (const s of unwrapped) receivedStatements.push(s);
            } else {
              receivedStatements.push(unwrapped);
            }
          },
        );
        return { unsubscribe() { sub.unsubscribe(); } };
      },

      getReceivedStatements() {
        return [...receivedStatements];
      },

      clearReceivedStatements() {
        receivedStatements.length = 0;
      },

      // ── Statement create proof ────────────────────────────────
      async statementCreateProof(dotnsId: string, index: number, dataHex: string) {
        try {
          const data = hexToU8a(dataHex);
          const statement = {
            proof: undefined,
            decryptionKey: undefined,
            expiry: undefined,
            channel: undefined,
            topics: [],
            data,
          };
          const r = await hostApi.statementStoreCreateProof(enumValue('v1', [[dotnsId, index], statement]));
          if (r.isOk()) return { ok: true, proof: r.value.value };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Theme ─────────────────────────────────────────────────
      subscribeTheme() {
        const sub = hostApi.themeSubscribe(enumValue('v1', undefined), (payload: unknown) => {
          const p = payload as { tag?: string; value?: unknown };
          if (p?.tag === 'v1') receivedThemes.push(String(p.value));
        });
        return { unsubscribe() { sub.unsubscribe(); } };
      },

      getReceivedThemes() {
        return [...receivedThemes];
      },

      // ── Entropy ───────────────────────────────────────────────
      async deriveEntropy(keyHex: string) {
        try {
          const key = hexToU8a(keyHex);
          const r = await hostApi.deriveEntropy(enumValue('v1', key));
          if (r.isOk()) return { ok: true, entropyHex: u8aToHex(r.value.value) };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Login / getUserId ─────────────────────────────────────
      async requestLogin(reason?: string) {
        try {
          const r = await hostApi.requestLogin(enumValue('v1', reason));
          if (r.isOk()) return { ok: true, loginResult: String(r.value.value) };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async getUserId() {
        try {
          const r = await hostApi.getUserId(enumValue('v1', undefined));
          if (r.isOk()) return { ok: true, primaryUsername: r.value.value.primaryUsername };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Resource allocation ───────────────────────────────────
      async requestResourceAllocation(resources: Array<{ tag: string; value?: unknown }>) {
        try {
          const r = await hostApi.requestResourceAllocation(enumValue('v1', resources));
          if (r.isOk()) {
            const outcomes = (r.value.value as Array<{ tag: string }>).map(o => ({ tag: o.tag }));
            return { ok: true, outcomes };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Feature check ─────────────────────────────────────────
      async featureSupported(tag: string, value: unknown) {
        try {
          const r = await hostApi.featureSupported(enumValue('v1', { tag, value }));
          if (r.isOk()) return { ok: true, supported: r.value.value };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Local storage ─────────────────────────────────────────
      async localStorageWrite(key: string, value: string) {
        try {
          const r = await hostApi.localStorageWrite(enumValue('v1', [key, new TextEncoder().encode(value)]));
          if (r.isOk()) return { ok: true };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async localStorageRead(key: string) {
        try {
          const r = await hostApi.localStorageRead(enumValue('v1', key));
          if (r.isOk()) {
            const bytes = r.value.value;
            return { ok: true, value: bytes ? new TextDecoder().decode(bytes) : null };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      async localStorageClear(key: string) {
        try {
          const r = await hostApi.localStorageClear(enumValue('v1', key));
          if (r.isOk()) return { ok: true };
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Create transaction ────────────────────────────────────
      async createTransaction(dotnsId: string, index: number) {
        try {
          const payload = {
            signer: [dotnsId, index] as [string, number],
            genesisHash: new Uint8Array(32),
            callData: new Uint8Array([0, 0]),
            extensions: [] as Array<{ id: string; extra: Uint8Array; additionalSigned: Uint8Array }>,
            txExtVersion: 0,
          };
          const r = await hostApi.createTransaction(enumValue('v1', payload));
          if (r.isOk()) {
            const inner = (r.value as { tag: string; value: Uint8Array }).value;
            return { ok: true, signedHex: u8aToHex(inner) };
          }
          return { ok: false, error: extractError(r.error) };
        } catch (err) {
          return { ok: false, error: extractError(err) };
        }
      },

      // ── Account create proof ──────────────────────────────────
      async accountCreateProof(dotnsId: string, index: number) {
        try {
          const message = new TextEncoder().encode('test-proof');
          const location = {
            genesisHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
            ringRootHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
            hints: undefined,
          };
          const r = await hostApi.accountCreateProof(enumValue('v1', [[dotnsId, index], location, message]));
          if (r.isOk()) return { ok: true, proofHex: u8aToHex(r.value.value) };
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

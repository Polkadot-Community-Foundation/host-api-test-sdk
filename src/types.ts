import type { HexString } from '@novasamatech/host-api';

export type { HexString } from '@novasamatech/host-api';

export interface ChainConfig {
  id: string;
  name: string;
  genesisHash: HexString;
  rpcUrl: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

export type DevAccountName = 'alice' | 'bob' | 'charlie' | 'dave' | 'eve' | 'ferdie';

export interface DevAccountInfo {
  name: string;
  /**
   * Substrate URI — passed to `@polkadot/keyring.addFromUri()`.
   *
   * Examples:
   *  - `'//Alice'` — dev account
   *  - `'//Alice//myapp/0'` — derivation from dev seed
   *  - `'word1 word2 ... word12'` — mnemonic
   *  - `'word1 word2 ... word12//hard/soft'` — mnemonic + derivation
   *  - `'0xabcdef...'` — hex seed
   */
  uri: string;
}

export interface TestHostServer {
  /** URL of the test host page (e.g. http://localhost:43210) */
  url: string;
  /** Stop the server */
  close(): Promise<void>;
}

/** A named dev account ('alice') or a custom account with a display name and Substrate URI. */
export type Account = DevAccountName | DevAccountInfo;

export interface CreateTestHostOptions {
  /** URL of the product to embed (e.g. http://localhost:3001) */
  productUrl: string;
  /** Accounts to provide (used for getLegacyAccounts and signing) */
  accounts?: Account[];
  /** Chain config (default: PASEO_ASSET_HUB) */
  chain?: ChainConfig;
  /** Port to listen on (default: 0 = random available port) */
  port?: number;
  /**
   * Map product account requests to specific accounts.
   *
   * Keys are `"dotnsId/derivationIndex"` (e.g. `"myapp.dot/0"`).
   * Values are dev account names or custom `{ name, uri }` objects.
   *
   * When a product calls `getProductAccount(dotnsId, index)`:
   *   - If `productAccounts` has a matching key → return that account
   *   - Otherwise → derive as production: `//Bob//dotnsId/index`
   *
   * This lets you map product accounts to funded dev accounts while
   * keeping different derivation indices distinct:
   *
   * ```ts
   * productAccounts: {
   *   'myapp.dot/0': 'bob',      // main account → //Bob (funded)
   *   'myapp.dot/2': 'charlie',  // secondary → //Charlie (funded)
   *   'myapp.dot/5': { name: 'Custom', uri: '//My//Custom' },
   * }
   * ```
   */
  productAccounts?: Record<string, Account>;
}

export interface SigningLogEntry {
  type: 'payload' | 'raw' | 'createTransaction';
  payload: unknown;
  timestamp: number;
}

export interface PermissionLogEntry {
  tag: string;
  value: unknown;
  approved: boolean;
  timestamp: number;
}

export interface NavigationLogEntry {
  url: string;
  timestamp: number;
}

export interface NotificationLogEntry {
  text: string;
  deeplink: string | undefined;
  timestamp: number;
}

export interface ChatRoom {
  roomId: string;
  name: string;
  icon: string;
  participatingAs: 'RoomHost' | 'Bot';
}

export interface ChatBot {
  botId: string;
  name: string;
  icon: string;
}

export interface ChatMessageLogEntry {
  roomId: string;
  messageId: string;
  /** Unmodified payload as received from the product. */
  payload: unknown;
  timestamp: number;
}

export interface PreimageEntry {
  /** Hex-encoded blake2b-256 hash of the value. */
  key: HexString;
  value: Uint8Array;
  /** When true, this preimage was submitted by the product via hostApi.preimageSubmit. */
  fromProduct: boolean;
  timestamp: number;
}

export interface StatementSubmissionLogEntry {
  /** The signed statement as submitted, unmodified. */
  statement: unknown;
  timestamp: number;
}

export interface PaymentLogEntry {
  type: 'top-up' | 'request';
  amount: bigint;
  source?: unknown;
  destination?: unknown;
  paymentId?: string;
  timestamp: number;
}

/**
 * Controls how the test host responds to remote permission requests.
 * - `'approve-all'` — auto-approve every request (default)
 * - `'reject-all'` — auto-reject every request
 * - `(tag: string, value: unknown) => boolean` — custom per-request decision
 */
export type PermissionBehavior = 'approve-all' | 'reject-all' | ((tag: string, value: unknown) => boolean);

/**
 * Controls how the test host responds to login requests (RFC-0009).
 * - `'success'` — auto-approve login (default)
 * - `'reject'` — auto-reject login
 * - `(reason?: string) => boolean` — custom per-request decision
 */
export type LoginBehavior = 'success' | 'reject' | ((reason: string | undefined) => boolean);

/** Shape of window.__TEST_HOST__ — shared between browser bundle and Playwright fixture. */
export interface TestHostAPI {
  switchAccount(name: string): Promise<void>;
  setAccounts(names: string[]): Promise<void>;
  getSigningLog(): SigningLogEntry[];
  clearSigningLog(): void;
  getConnectionStatus(): string;
  getChainStatus(): string;
  /** Set how the host responds to remote permission requests. */
  setPermissionBehavior(behavior: PermissionBehavior): void;
  /** Pre-grant a permission without the product requesting it. */
  grantPermission(tag: string): void;
  /** Revoke a previously granted permission. */
  revokePermission(tag: string): void;
  /** List currently granted permissions. */
  getGrantedPermissions(): string[];
  /**
   * Enable or disable permission enforcement on signing.
   * When enabled (default), signing requires ChainSubmit to have been
   * granted — matching real host behavior. Disable for legacy tests that
   * don't exercise the permission flow.
   */
  setEnforcePermissions(enforce: boolean): void;
  /** Get the log of all permission requests and their outcomes. */
  getPermissionLog(): PermissionLogEntry[];
  /** Clear the permission log. */
  clearPermissionLog(): void;
  /** Get the log of navigation attempts (hostApi.navigateTo) from the product. */
  getNavigationLog(): NavigationLogEntry[];
  /** Clear the navigation log. */
  clearNavigationLog(): void;
  /** Get the log of push notifications (hostApi.pushNotification) from the product. */
  getNotificationLog(): NotificationLogEntry[];
  /** Clear the notification log. */
  clearNotificationLog(): void;
  /** List chat rooms the product has created in the current session. */
  getChatRooms(): ChatRoom[];
  /** List chat bots the product has registered in the current session. */
  getChatBots(): ChatBot[];
  /** Get the log of messages the product has posted to chat rooms. */
  getChatMessageLog(): ChatMessageLogEntry[];
  /** Clear chat state: rooms, bots, messages, and subscribers. */
  clearChatState(): void;
  /**
   * Inject an incoming chat action (e.g. peer message) into the product.
   * Any subscribers registered via `chatActionSubscribe` will receive it.
   */
  injectChatAction(action: { roomId: string; peer: string; payload: unknown }): void;
  /** List all preimages known to the test host (submitted by product + seeded by test). */
  getPreimages(): PreimageEntry[];
  /**
   * Seed the test host with a preimage value. The key is derived as
   * blake2b-256 of the value and returned. Any active `preimageLookup`
   * subscriptions for that key will be notified.
   */
  seedPreimage(value: Uint8Array): HexString;
  /** Clear all preimages. */
  clearPreimages(): void;
  /** Get the log of statements submitted by the product via `hostApi.statementStoreSubmit`. */
  getSubmittedStatements(): StatementSubmissionLogEntry[];
  /**
   * Inject a statement into the statement store so it is delivered to
   * active subscribers whose topic filter matches.
   */
  injectStatement(statement: unknown): void;
  /** Clear the submitted-statements log and any seeded statements. */
  clearStatements(): void;

  // ── Theme ──────────────────────────────────────────────────
  /** Get the current theme. */
  getTheme(): 'light' | 'dark';
  /** Set the theme and notify subscribers. */
  setTheme(theme: 'light' | 'dark'): void;

  // ── Login / auth ───────────────────────────────────────────
  /** Set how the host responds to login requests (RFC-0009). */
  setLoginBehavior(behavior: LoginBehavior): void;
  /** Whether the product is currently authenticated. */
  getIsAuthenticated(): boolean;
  /** Simulate user disconnect (unauthenticated state). */
  simulateDisconnect(): void;
  /** Simulate user reconnect (authenticated state). */
  simulateReconnect(): void;

  // ── Payments ───────────────────────────────────────────────
  /** Set the mock payment balance (in smallest unit). */
  setPaymentBalance(amount: bigint): void;
  /** Get the log of payment operations (top-ups, requests). */
  getPaymentLog(): PaymentLogEntry[];
  /** Clear the payment log. */
  clearPaymentLog(): void;
  /** Manually set a payment's status and notify subscribers. */
  simulatePaymentStatus(paymentId: string, status: { tag: string; value?: string }): void;

  dispose(): void;
}

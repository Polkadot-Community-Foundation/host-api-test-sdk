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
  /** Accounts to provide (used for getNonProductAccounts and signing) */
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
  type: 'payload' | 'raw';
  payload: unknown;
  timestamp: number;
}

export interface PermissionLogEntry {
  tag: string;
  value: unknown;
  approved: boolean;
  timestamp: number;
}

/**
 * Controls how the test host responds to remote permission requests.
 * - `'approve-all'` — auto-approve every request (default)
 * - `'reject-all'` — auto-reject every request
 * - `(tag: string, value: unknown) => boolean` — custom per-request decision
 */
export type PermissionBehavior = 'approve-all' | 'reject-all' | ((tag: string, value: unknown) => boolean);

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
  /** Get the log of all permission requests and their outcomes. */
  getPermissionLog(): PermissionLogEntry[];
  /** Clear the permission log. */
  clearPermissionLog(): void;
  dispose(): void;
}

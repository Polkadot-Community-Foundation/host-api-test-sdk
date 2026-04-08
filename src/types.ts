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
  /** Accounts to provide */
  accounts?: Account[];
  /** Chain config (default: PASEO_ASSET_HUB) */
  chain?: ChainConfig;
  /** Port to listen on (default: 0 = random available port) */
  port?: number;
  /**
   * Derive unique product accounts per DotNS identifier (production behavior).
   *
   * When `false` (default), product account requests return the base dev
   * account directly (e.g. `//Bob`). This means the test account has the
   * same address as the well-known dev account — already funded on public
   * testnets, no extra setup needed.
   *
   * When `true`, product accounts are derived as `//Bob//dotnsId/index`,
   * producing a unique keypair per product. Useful for testing multi-product
   * isolation, but requires funding the derived accounts separately.
   */
  deriveProductAccounts?: boolean;
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

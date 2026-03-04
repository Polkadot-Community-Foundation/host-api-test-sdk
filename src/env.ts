import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChainConfig, HexString } from './types.js';

/**
 * Parse a dotenv-style file into key-value pairs.
 * Handles comments, blank lines, and inline values.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return vars;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Merge multiple env files (later files override earlier ones).
 * Paths can be absolute or relative to `cwd`.
 */
export function loadEnvFiles(
  filePaths: string[],
  cwd?: string,
): Record<string, string> {
  const base = cwd ?? process.cwd();
  const merged: Record<string, string> = {};
  for (const fp of filePaths) {
    const abs = fp.startsWith('/') ? fp : resolve(base, fp);
    Object.assign(merged, parseEnvFile(abs));
  }
  return merged;
}

export interface LoadChainFromEnvOptions {
  /**
   * Env files to load (merged in order, later overrides earlier).
   * Example: ['.env.ppn', '.env.ppn.local']
   */
  envFiles: string[];
  /** Working directory for resolving relative paths (default: process.cwd()) */
  cwd?: string;
  /** Chain ID for the ChainConfig (e.g. 'ppn-asset-hub') */
  chainId: string;
  /** Display name (e.g. 'PPN Asset Hub') */
  chainName: string;
  /** Env var name for genesis hash (default: 'VITE_GENESIS_HASH') */
  genesisHashKey?: string;
  /** WebSocket RPC URL for the test host to connect to */
  rpcUrl: string;
  /** Token symbol (e.g. 'WND', 'PAS') */
  tokenSymbol: string;
  /** Token decimals (e.g. 12, 10) */
  tokenDecimals: number;
}

/**
 * Build a ChainConfig by loading the genesis hash from env files.
 * Throws if the genesis hash is not found.
 *
 * This is the recommended way for products to configure their test chain
 * without hardcoding genesis hashes (which change when local networks restart).
 *
 * @example
 * ```ts
 * const chain = loadChainFromEnv({
 *   envFiles: ['.env.ppn', '.env.ppn.local'],
 *   cwd: path.join(__dirname, '..'),
 *   chainId: 'ppn-asset-hub',
 *   chainName: 'PPN Asset Hub',
 *   rpcUrl: 'ws://127.0.0.1:10020',
 *   tokenSymbol: 'WND',
 *   tokenDecimals: 12,
 * });
 * ```
 */
export function loadChainFromEnv(options: LoadChainFromEnvOptions): ChainConfig {
  const {
    envFiles,
    cwd,
    chainId,
    chainName,
    genesisHashKey = 'VITE_GENESIS_HASH',
    rpcUrl,
    tokenSymbol,
    tokenDecimals,
  } = options;

  const env = loadEnvFiles(envFiles, cwd);
  const genesisHash = env[genesisHashKey];

  if (!genesisHash) {
    throw new Error(
      `${genesisHashKey} not found in env files: ${envFiles.join(', ')}.\n` +
        `Make sure your contract is deployed and the env file has been written.`,
    );
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(genesisHash)) {
    throw new Error(
      `${genesisHashKey} has invalid format: "${genesisHash}". ` +
        `Expected a 0x-prefixed 64-char hex string.`,
    );
  }

  return {
    id: chainId,
    name: chainName,
    genesisHash: genesisHash as HexString,
    rpcUrl,
    tokenSymbol,
    tokenDecimals,
  };
}

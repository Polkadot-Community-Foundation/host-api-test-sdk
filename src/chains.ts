import type { ChainConfig, HexString } from './types.js';

export const PASEO_ASSET_HUB: ChainConfig = {
  id: 'paseo-asset-hub',
  name: 'Paseo Asset Hub',
  genesisHash: '0x173cea9df45656cf612c8b8ece56e04e9a693c69cfaac47d3628dae735067af8' as HexString,
  rpcUrl: 'wss://paseo-asset-hub-next-rpc.polkadot.io',
  tokenSymbol: 'PAS',
  tokenDecimals: 10,
};

export const PREVIEWNET: ChainConfig = {
  id: 'previewnet',
  name: 'Previewnet',
  genesisHash: '0x477dd87a881ae4d8072030073406be59de42215b4a7c4c337ce1a25727912525' as HexString,
  rpcUrl: 'wss://previewnet.substrate.dev/relay/alice',
  tokenSymbol: 'UNIT',
  tokenDecimals: 12,
};

export const PREVIEWNET_ASSET_HUB: ChainConfig = {
  id: 'previewnet-asset-hub',
  name: 'Previewnet Asset Hub',
  genesisHash: '0x860d75a890388e2ad02c54aa451264d04af89765773a51cd56868b4293c7867c' as HexString,
  rpcUrl: 'wss://previewnet.substrate.dev/asset-hub',
  tokenSymbol: 'UNIT',
  tokenDecimals: 12,
};

export const DEFAULT_CHAIN = PASEO_ASSET_HUB;

export const SUPPORTED_CHAINS: ChainConfig[] = [
  PASEO_ASSET_HUB,
  PREVIEWNET,
  PREVIEWNET_ASSET_HUB,
];

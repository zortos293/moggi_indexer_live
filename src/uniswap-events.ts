import { EventSignature } from './event-decoder';

// ============================================
// UNISWAP V2 EVENTS
// ============================================

export const UNISWAP_V2_EVENTS: Record<string, EventSignature> = {
  // PairCreated(address indexed token0, address indexed token1, address pair, uint)
  '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9': {
    name: 'PairCreated',
    signature: 'PairCreated(address,address,address,uint256)',
    standard: 'UniswapV2',
    params: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'pair', type: 'address', indexed: false },
      { name: 'pairCount', type: 'uint256', indexed: false },
    ],
  },

  // Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': {
    name: 'Swap',
    signature: 'Swap(address,uint256,uint256,uint256,uint256,address)',
    standard: 'UniswapV2',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0In', type: 'uint256', indexed: false },
      { name: 'amount1In', type: 'uint256', indexed: false },
      { name: 'amount0Out', type: 'uint256', indexed: false },
      { name: 'amount1Out', type: 'uint256', indexed: false },
      { name: 'to', type: 'address', indexed: true },
    ],
  },

  // Mint(address indexed sender, uint amount0, uint amount1)
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': {
    name: 'Mint',
    signature: 'Mint(address,uint256,uint256)',
    standard: 'UniswapV2',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  // Burn(address indexed sender, uint amount0, uint amount1, address indexed to)
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496': {
    name: 'Burn',
    signature: 'Burn(address,uint256,uint256,address)',
    standard: 'UniswapV2',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'to', type: 'address', indexed: true },
    ],
  },

  // Sync(uint112 reserve0, uint112 reserve1)
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': {
    name: 'Sync',
    signature: 'Sync(uint112,uint112)',
    standard: 'UniswapV2',
    params: [
      { name: 'reserve0', type: 'uint112', indexed: false },
      { name: 'reserve1', type: 'uint112', indexed: false },
    ],
  },
};

// ============================================
// UNISWAP V3 EVENTS
// ============================================

export const UNISWAP_V3_EVENTS: Record<string, EventSignature> = {
  // PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
  '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118': {
    name: 'PoolCreated',
    signature: 'PoolCreated(address,address,uint24,int24,address)',
    standard: 'UniswapV3',
    params: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
    ],
  },

  // Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': {
    name: 'Swap',
    signature: 'Swap(address,address,int256,int256,uint160,uint128,int24)',
    standard: 'UniswapV3',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount0', type: 'int256', indexed: false },
      { name: 'amount1', type: 'int256', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },

  // Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
  '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde': {
    name: 'Mint',
    signature: 'Mint(address,address,int24,int24,uint128,uint256,uint256)',
    standard: 'UniswapV3',
    params: [
      { name: 'sender', type: 'address', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'tickLower', type: 'int24', indexed: true },
      { name: 'tickUpper', type: 'int24', indexed: true },
      { name: 'amount', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  // Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
  '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c': {
    name: 'Burn',
    signature: 'Burn(address,int24,int24,uint128,uint256,uint256)',
    standard: 'UniswapV3',
    params: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'tickLower', type: 'int24', indexed: true },
      { name: 'tickUpper', type: 'int24', indexed: true },
      { name: 'amount', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  // Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)
  '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0': {
    name: 'Collect',
    signature: 'Collect(address,address,int24,int24,uint128,uint128)',
    standard: 'UniswapV3',
    params: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: false },
      { name: 'tickLower', type: 'int24', indexed: true },
      { name: 'tickUpper', type: 'int24', indexed: true },
      { name: 'amount0', type: 'uint128', indexed: false },
      { name: 'amount1', type: 'uint128', indexed: false },
    ],
  },

  // IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
  '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f': {
    name: 'IncreaseLiquidity',
    signature: 'IncreaseLiquidity(uint256,uint128,uint256,uint256)',
    standard: 'UniswapV3',
    params: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  // DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
  '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4': {
    name: 'DecreaseLiquidity',
    signature: 'DecreaseLiquidity(uint256,uint128,uint256,uint256)',
    standard: 'UniswapV3',
    params: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  // Flash(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1)
  '0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633': {
    name: 'Flash',
    signature: 'Flash(address,address,uint256,uint256,uint256,uint256)',
    standard: 'UniswapV3',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'paid0', type: 'uint256', indexed: false },
      { name: 'paid1', type: 'uint256', indexed: false },
    ],
  },
};

// ============================================
// UNISWAP V4 EVENTS
// ============================================

export const UNISWAP_V4_EVENTS: Record<string, EventSignature> = {
  // Initialize(bytes32 indexed id, Currency indexed currency0, Currency indexed currency1, uint24 fee, int24 tickSpacing, IHooks hooks)
  // Note: V4 uses PoolKey instead of separate params, this is a simplified version
  '0x0000000000000000000000000000000000000000000000000000000000000000': {
    name: 'Initialize',
    signature: 'Initialize(bytes32,address,address,uint24,int24,address)',
    standard: 'UniswapV4',
    params: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'currency0', type: 'address', indexed: true },
      { name: 'currency1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'hooks', type: 'address', indexed: false },
    ],
  },
};

// Combined Uniswap events
export const UNISWAP_EVENTS: Record<string, EventSignature> = {
  ...UNISWAP_V2_EVENTS,
  ...UNISWAP_V3_EVENTS,
  ...UNISWAP_V4_EVENTS,
};

// Helper to identify which Uniswap version an event belongs to
export function getUniswapVersion(eventSignature: string): 'V2' | 'V3' | 'V4' | null {
  if (UNISWAP_V2_EVENTS[eventSignature]) return 'V2';
  if (UNISWAP_V3_EVENTS[eventSignature]) return 'V3';
  if (UNISWAP_V4_EVENTS[eventSignature]) return 'V4';
  return null;
}

// Helper to check if an event is a Uniswap event
export function isUniswapEvent(eventSignature: string): boolean {
  return eventSignature in UNISWAP_EVENTS;
}

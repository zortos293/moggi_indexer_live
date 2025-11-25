import { EventSignature } from './event-decoder';
import { Interface } from 'ethers';

// Platform-specific event signatures for Monad ecosystem

// ============================================
// KURU CONTRACT ADDRESSES (Mainnet)
// ============================================
export const KURU_CONTRACTS = {
  // Entry point of the Kuru Flow aggregator
  KuruFlowEntryPoint: '0xb3e6778480b2E488385E8205eA05E20060B813cb',
  KuruFlowRouter: '0x465D06d4521ae9Ce724E0c182Daad5D8a2Ff7040',
  // Kuru DEX router and market factory
  Router: '0xd651346d7c789536ebf06dc72aE3C8502cd695CC',
  // Margin account for all liquidity on Kuru
  MarginAccount: '0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5',
  KuruForwarder: '0x974E61BBa9C4704E8Bcc1923fdC3527B41323FAA',
  // One step token deployment and market bootstrapping contract
  MonadDeployer: '0xe29309e308af3EE3B1a414E97c37A58509f27D1E',
} as const;

// Helper to check if an address is a Kuru contract
export function isKuruContract(address: string): boolean {
  const normalizedAddress = address.toLowerCase();
  return Object.values(KURU_CONTRACTS).some(
    addr => addr.toLowerCase() === normalizedAddress
  );
}

// ============================================
// UNISWAP CONTRACT ADDRESSES (Mainnet)
// V2, V3, and V4 deployments
// ============================================
export const UNISWAP_CONTRACTS = {
  // Uniswap V2
  UniswapV2Factory: '0x182a927119d56008d921126764bf884221b10f59',
  UniswapV2Router02: '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804',

  // Uniswap V3 Core
  UniswapV3Factory: '0x204faca1764b154221e35c0d20abb3c525710498',
  NonfungiblePositionManager: '0x7197e214c0b767cfb76fb734ab638e2c192f4e53',
  SwapRouter: '0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40',
  SwapRouter02: '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900',
  V3Migrator: '0x7078c4537c04c2b2e52ddba06074dbdacf23ca15',

  // Uniswap V3 Periphery
  QuoterV2: '0x661e93cca42afacb172121ef892830ca3b70f08d',
  Quoter: '0x2d01411773c8c24805306e89a41f7855c3c4fe65',
  TickLens: '0xf025e0fe9e331a0ef05c2ad3c4e9c64b625cda6f',
  NFTDescriptor: '0x2e9d45bb7b30549f5216813ada9a6b7982c5b3ed',
  NonfungibleTokenPositionDescriptor: '0x315e413a11ab0df498ef83873012430ca36638ae',
  MixedRouteQuoterV2: '0xdcd9f4e8972f619b325b0c3109412dfc4d184734',

  // Uniswap V4
  PoolManager: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
  PositionManager: '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016',
  PositionDescriptor: '0x5770d2914355a6d0a39a70aeea9bcce55df4201b',
  V4Quoter: '0xa222dd357a9076d1091ed6aa2e16c9742dd26891',
  StateView: '0x77395f3b2e73ae90843717371294fa97cc419d64',
  WETHHook: '0x3fad8a7205f943528915e67cf94fc792c8fce888',

  // Universal & Utilities
  UniversalRouter: '0x0d97dc33264bfc1c226207428a79b26757fb9dc3',
  UniswapInterfaceMulticall: '0xd1b797d92d87b688193a2b976efc8d577d204343',
  FeeOnTransferDetector: '0x5c834b6cac4173bfe288c5722a38e04b9e366e30',
  CaliburEntry: '0x000000009b1d0af20d8c6d0a44e162d11f9b8f00',
} as const;

// Helper to check if an address is a Uniswap contract
export function isUniswapContract(address: string): boolean {
  const normalizedAddress = address.toLowerCase();
  return Object.values(UNISWAP_CONTRACTS).some(
    addr => addr.toLowerCase() === normalizedAddress
  );
}

// Helper to identify which platform a contract belongs to
export function getPlatform(address: string): 'Kuru' | 'Uniswap' | 'Naddotfun' | null {
  if (isKuruContract(address)) return 'Kuru';
  if (isUniswapContract(address)) return 'Uniswap';
  return null;
}

// ============================================
// NADDOTFUN (Bonding Curve Platform) EVENTS
// ============================================

export const NADDOTFUN_EVENTS: Record<string, EventSignature> = {
  // CurveBuy(address indexed sender, address indexed token, uint256 amountIn, uint256 amountOut)
  '0x9b244be412f267ea06fa5eb4edd33e1fe88f5c6dbcc4967b5aa0fd4e0c087a9e': {
    name: 'CurveBuy',
    signature: 'CurveBuy(address,address,uint256,uint256)',
    standard: 'Naddotfun',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },

  // CurveSell(address indexed sender, address indexed token, uint256 amountIn, uint256 amountOut)
  '0x8f5e7c0f6aa05fa88ed1c91e16def5e9c5f6c8c0b7c8c8d6e0f6e1c3e9a0b6c1': {
    name: 'CurveSell',
    signature: 'CurveSell(address,address,uint256,uint256)',
    standard: 'Naddotfun',
    params: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },

  // CurveCreate(address indexed creator, address indexed token, address indexed pool, string name, string symbol, string tokenURI, uint256 virtualMon, uint256 virtualToken, uint256 targetTokenAmount)
  '0x7c1e7d7e6c1f3e2b8a5c3d4f6e7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5': {
    name: 'CurveCreate',
    signature: 'CurveCreate(address,address,address,string,string,string,uint256,uint256,uint256)',
    standard: 'Naddotfun',
    params: [
      { name: 'creator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
      { name: 'virtualMon', type: 'uint256', indexed: false },
      { name: 'virtualToken', type: 'uint256', indexed: false },
      { name: 'targetTokenAmount', type: 'uint256', indexed: false },
    ],
  },

  // CurveGraduate(address indexed token, address indexed pool)
  '0x1e5c1f0f0e1d2c3b4a5960728394a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2': {
    name: 'CurveGraduate',
    signature: 'CurveGraduate(address,address)',
    standard: 'Naddotfun',
    params: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
    ],
  },

  // CurveSync(address indexed token, uint256 realMonReserve, uint256 realTokenReserve, uint256 virtualMonReserve, uint256 virtualTokenReserve)
  '0x2e6d8b7c9a0f1e3d4c5b6a7980c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9': {
    name: 'CurveSync',
    signature: 'CurveSync(address,uint256,uint256,uint256,uint256)',
    standard: 'Naddotfun',
    params: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'realMonReserve', type: 'uint256', indexed: false },
      { name: 'realTokenReserve', type: 'uint256', indexed: false },
      { name: 'virtualMonReserve', type: 'uint256', indexed: false },
      { name: 'virtualTokenReserve', type: 'uint256', indexed: false },
    ],
  },

  // CurveTokenLocked(address indexed token)
  '0x3f7e8c9d0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7': {
    name: 'CurveTokenLocked',
    signature: 'CurveTokenLocked(address)',
    standard: 'Naddotfun',
    params: [
      { name: 'token', type: 'address', indexed: true },
    ],
  },
};

// ============================================
// KURU (DEX/OrderBook Platform) EVENTS
// ============================================

export const KURU_EVENTS: Record<string, EventSignature> = {
  // OrderBook Events (from Kuru SDK)
  // OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)
  '0xb81bbaf150467ef3096ed6220cb963abc169bffd2eb88f26c47359ef344cf94c': {
    name: 'OrderCreated',
    signature: 'OrderCreated(uint40,address,uint96,uint32,bool)',
    standard: 'Kuru',
    params: [
      { name: 'orderId', type: 'uint40', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'size', type: 'uint96', indexed: false },
      { name: 'price', type: 'uint32', indexed: false },
      { name: 'isBuy', type: 'bool', indexed: false },
    ],
  },

  // Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)
  '0xf16924fba1c18c108912fcacaac7450c98eb3f2d8c0a3cdf3df7066c08f21581': {
    name: 'Trade',
    signature: 'Trade(uint40,address,bool,uint256,uint96,address,address,uint96)',
    standard: 'Kuru',
    params: [
      { name: 'orderId', type: 'uint40', indexed: false },
      { name: 'makerAddress', type: 'address', indexed: false },
      { name: 'isBuy', type: 'bool', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'updatedSize', type: 'uint96', indexed: false },
      { name: 'takerAddress', type: 'address', indexed: false },
      { name: 'txOrigin', type: 'address', indexed: false },
      { name: 'filledSize', type: 'uint96', indexed: false },
    ],
  },

  // OrdersCanceled(uint40[] orderId, address owner)
  '0x386974f41b61738b510019ccd5a3524a43eccf0d136929e09d524e87aeeca2c4': {
    name: 'OrdersCanceled',
    signature: 'OrdersCanceled(uint40[],address)',
    standard: 'Kuru',
    params: [
      { name: 'orderId', type: 'uint40[]', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
    ],
  },

  // FlipOrderCreated(uint40 orderId, uint40 flippedId, address owner, uint96 size, uint32 price, uint32 flippedPrice, bool isBuy)
  '0xf81d3fdea8a7ee9c5c09179882e1bce1c513a741146e453167d9e8912c8eb3aa': {
    name: 'FlipOrderCreated',
    signature: 'FlipOrderCreated(uint40,uint40,address,uint96,uint32,uint32,bool)',
    standard: 'Kuru',
    params: [
      { name: 'orderId', type: 'uint40', indexed: false },
      { name: 'flippedId', type: 'uint40', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'size', type: 'uint96', indexed: false },
      { name: 'price', type: 'uint32', indexed: false },
      { name: 'flippedPrice', type: 'uint32', indexed: false },
      { name: 'isBuy', type: 'bool', indexed: false },
    ],
  },

  // FlipOrderUpdated(uint40 orderId, uint96 size)
  '0xb74e966bc873b8c144fab39c9981210f50130885e89caf4556c0840cec741dcd': {
    name: 'FlipOrderUpdated',
    signature: 'FlipOrderUpdated(uint40,uint96)',
    standard: 'Kuru',
    params: [
      { name: 'orderId', type: 'uint40', indexed: false },
      { name: 'size', type: 'uint96', indexed: false },
    ],
  },

  // FlipOrdersCanceled(uint40[] orderIds, address owner)
  '0x5f815e5292cf3b123df58ad6d4531c085d94d5717a3b02740369a04273fde96c': {
    name: 'FlipOrdersCanceled',
    signature: 'FlipOrdersCanceled(uint40[],address)',
    standard: 'Kuru',
    params: [
      { name: 'orderIds', type: 'uint40[]', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
    ],
  },

  // FlippedOrderCreated(uint40 orderId, uint40 flippedId, address owner, uint96 size, uint32 price, uint32 flippedPrice, bool isBuy)
  '0x49496a41b922bdba3ff7f57bb0992ab1a1a3ee95b5ae5bd7271c67861f018352': {
    name: 'FlippedOrderCreated',
    signature: 'FlippedOrderCreated(uint40,uint40,address,uint96,uint32,uint32,bool)',
    standard: 'Kuru',
    params: [
      { name: 'orderId', type: 'uint40', indexed: false },
      { name: 'flippedId', type: 'uint40', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'size', type: 'uint96', indexed: false },
      { name: 'price', type: 'uint32', indexed: false },
      { name: 'flippedPrice', type: 'uint32', indexed: false },
      { name: 'isBuy', type: 'bool', indexed: false },
    ],
  },

  // Deposit(address owner, address token, uint256 amount)
  '0x5548c837ab068cf56a2c2479df0882a4922fd203edb7517321831d95078c5f62': {
    name: 'Deposit',
    signature: 'Deposit(address,address,uint256)',
    standard: 'Kuru',
    params: [
      { name: 'owner', type: 'address', indexed: false },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },

  // Withdrawal(address owner, address token, uint256 amount)
  '0x2717ead6b9200dd235aad468c9809ea400fe33ac69b5bfaa6d3e90fc922b6398': {
    name: 'Withdrawal',
    signature: 'Withdrawal(address,address,uint256)',
    standard: 'Kuru',
    params: [
      { name: 'owner', type: 'address', indexed: false },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },

  // OwnershipHandoverCanceled(address indexed pendingOwner)
  '0xfa7b8eab7da67f412cc9575ed43464468f9bfbae89d1675917346ca6d8fe3c92': {
    name: 'OwnershipHandoverCanceled',
    signature: 'OwnershipHandoverCanceled(address)',
    standard: 'Kuru',
    params: [
      { name: 'pendingOwner', type: 'address', indexed: true },
    ],
  },

  // OwnershipHandoverRequested(address indexed pendingOwner)
  '0xdbf36a107da19e49527a7176a1babf963b4b0ff8cde35ee35d6cd8f1f9ac7e1d': {
    name: 'OwnershipHandoverRequested',
    signature: 'OwnershipHandoverRequested(address)',
    standard: 'Kuru',
    params: [
      { name: 'pendingOwner', type: 'address', indexed: true },
    ],
  },

  // Upgraded(address indexed implementation)
  '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b': {
    name: 'Upgraded',
    signature: 'Upgraded(address)',
    standard: 'Kuru',
    params: [
      { name: 'implementation', type: 'address', indexed: true },
    ],
  },

  // Initialized(uint64 version)
  '0xc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d2': {
    name: 'Initialized',
    signature: 'Initialized(uint64)',
    standard: 'Kuru',
    params: [
      { name: 'version', type: 'uint64', indexed: false },
    ],
  },
};

// Helper function to compute event signature hash from ABI
export function computeEventSignature(eventAbi: any): string {
  const iface = new Interface([eventAbi]);
  const eventFragment = iface.getEvent(eventAbi.name);
  return eventFragment!.topicHash;
}

// Extract events from full ABI JSON
export function extractEventsFromABI(abi: any[]): Record<string, EventSignature> {
  const events: Record<string, EventSignature> = {};

  for (const item of abi) {
    if (item.type === 'event') {
      try {
        // Compute the actual topic hash
        const iface = new Interface([item]);
        const eventFragment = iface.getEvent(item.name);
        const topicHash = eventFragment!.topicHash;

        // Build signature
        const paramTypes = item.inputs.map((input: any) => input.type).join(',');
        const signature = `${item.name}(${paramTypes})`;

        // Extract parameters
        const params = item.inputs.map((input: any) => ({
          name: input.name || 'unknown',
          type: input.type,
          indexed: input.indexed || false,
        }));

        events[topicHash] = {
          name: item.name,
          signature,
          standard: 'Platform', // Default, can be overridden
          params,
        };
      } catch (error) {
        console.error(`Failed to process event ${item.name}:`, error);
      }
    }
  }

  return events;
}

// Combined platform events
export const PLATFORM_EVENTS: Record<string, EventSignature> = {
  ...NADDOTFUN_EVENTS,
  ...KURU_EVENTS,
};
